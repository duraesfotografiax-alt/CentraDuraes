// Tráfego pago: lê as contas de anúncio no Meta (usuário do sistema) e grava um resumo no Firestore.
// Também avisa quando uma campanha é reprovada/tem problema, quando a conta trava ou quando uma campanha está para acabar.
const VERSAO = process.env.META_API_VERSION || 'v22.0';
const BASE = `https://graph.facebook.com/${VERSAO}`;

const STATUS_CONTA = { 1: 'ativa', 2: 'desativada', 3: 'pagamento pendente', 7: 'em análise', 8: 'acerto pendente', 9: 'período de carência', 100: 'encerrando', 101: 'encerrada', 201: 'ativa', 202: 'encerrada' };
const PROBLEMA = ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'];
// Ordem de preferência para "resultado" de uma campanha
const RESULTADOS = [
  ['onsite_conversion.messaging_conversation_started_7d', 'conversas'],
  ['lead', 'cadastros'],
  ['onsite_conversion.lead_grouped', 'cadastros'],
  ['offsite_conversion.fb_pixel_purchase', 'compras'],
  ['offsite_conversion.fb_pixel_lead', 'cadastros no site'],
  ['link_click', 'cliques no link'],
  ['video_view', 'visualizações de vídeo'],
  ['post_engagement', 'engajamentos'],
];

async function g(caminho, token) {
  const url = `${BASE}/${caminho}${caminho.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error((j.error && j.error.message) || `Meta respondeu ${r.status}`);
  return j;
}
async function todos(caminho, token) {
  let out = [], j = await g(caminho, token);
  out = out.concat(j.data || []);
  let n = 0;
  while (j.paging && j.paging.next && n++ < 20) {
    const r = await fetch(j.paging.next); j = await r.json(); out = out.concat(j.data || []);
  }
  return out;
}
function resultado(actions) {
  const a = Object.fromEntries((actions || []).map((x) => [x.action_type, Number(x.value) || 0]));
  for (const [k, nome] of RESULTADOS) if (a[k]) return { n: a[k], tipo: nome };
  return { n: 0, tipo: '' };
}
const centavos = (v) => (v == null || v === '' ? null : Math.round(Number(v)) / 100);
// "Saldo disponível (R$1.234,56 BRL)" / "Available balance (R$1,234.56 BRL)" -> 1234.56
function valorTexto(t) {
  const x = String(t || '').match(/(?:R\$|BRL)\s?([\d.,]+)/) || String(t || '').match(/([\d][\d.,]*)/);
  if (!x) return null;
  let s = x[1];
  const ld = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (ld >= 0 && s.length - ld - 1 === 2) s = s.slice(0, ld).replace(/[.,]/g, '') + '.' + s.slice(ld + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function sincronizarMeta({ db, usuarios, enviar, jaFoi, marcar, ehAdm, hoje, agoraIso }) {
  const token = process.env.META_TOKEN;
  if (!token) return;
  const contas = await todos('me/adaccounts?fields=id,account_id,name,account_status,currency,business_name,amount_spent,balance,disable_reason&limit=100', token);
  console.log(`Meta: ${contas.length} conta(s) de anúncio`);
  const socios = usuarios.filter((u) => ehAdm(u) || u.financeiro === true);
  const amanhaIso = new Date(Date.now() + 36 * 3600e3).toISOString();
  const vistos = [];

  for (const c of contas) {
    const id = c.account_id;
    try {
      const camp = await todos(`act_${id}/campaigns?fields=id,name,effective_status,daily_budget,lifetime_budget,start_time,stop_time,objective,updated_time&limit=200&effective_status=${encodeURIComponent(JSON.stringify(['ACTIVE', 'PAUSED', 'WITH_ISSUES', 'DISAPPROVED', 'PENDING_REVIEW', 'IN_PROCESS', 'PENDING_BILLING_INFO', 'PREAPPROVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']))}`, token);
      const ins = async (preset, campos) => Object.fromEntries((await todos(`act_${id}/insights?level=campaign&date_preset=${preset}&fields=campaign_id,${campos}&limit=500`, token)).map((x) => [x.campaign_id, x]));
      const [hojeI, semI, mesI] = await Promise.all([ins('today', 'spend'), ins('last_7d', 'spend,actions,impressions,clicks,reach'), ins('this_month', 'spend')]);
      // guarda só campanhas ativas, com problema, ou que gastaram no mês/semana (as pausadas antigas não interessam)
      const lista = camp.map((k) => {
        const r7 = resultado((semI[k.id] || {}).actions);
        return {
          id: k.id, nome: k.name, status: k.effective_status, objetivo: k.objective || '',
          orcDia: centavos(k.daily_budget), orcTotal: centavos(k.lifetime_budget),
          inicio: k.start_time || '', fim: k.stop_time || '',
          gastoHoje: Number((hojeI[k.id] || {}).spend || 0), gasto7: Number((semI[k.id] || {}).spend || 0), gastoMes: Number((mesI[k.id] || {}).spend || 0),
          res7: r7.n, resTipo: r7.tipo, alcance7: Number((semI[k.id] || {}).reach || 0), cliques7: Number((semI[k.id] || {}).clicks || 0),
        };
      }).filter((k) => k.status === 'ACTIVE' || PROBLEMA.includes(k.status) || k.gastoMes > 0 || k.gasto7 > 0 || k.status === 'PENDING_REVIEW' || k.status === 'IN_PROCESS')
        .sort((a, b) => (a.status === 'ACTIVE' ? 0 : 1) - (b.status === 'ACTIVE' ? 0 : 1) || b.gastoMes - a.gastoMes);

      const ref = db.collection('anuncios').doc(id);
      const antes = (await ref.get()).data() || {};
      const doc = {
        conta: id, nome: c.name || id, empresa: c.business_name || '', moeda: c.currency || 'BRL',
        statusConta: c.account_status, statusContaTx: STATUS_CONTA[c.account_status] || String(c.account_status),
        saldo: centavos(c.balance), atualizadoEm: agoraIso, campanhas: lista,
        loja: antes.loja || '',
      };
      // ---- saldo / forma de pagamento (separado: se falhar não derruba o resto) ----
      try {
        const f = await g(`act_${id}?fields=funding_source_details,spend_cap,amount_spent,is_prepay_account`, token);
        const fs = f.funding_source_details || {};
        doc.pagamentoTx = fs.display_string || '';
        doc.prepago = !!f.is_prepay_account || /saldo|balance|pr[eé]-?pag/i.test(fs.display_string || '');
        doc.saldoDisp = doc.prepago ? valorTexto(fs.display_string) : null;
        const cap = Number(f.spend_cap || 0), gasto = Number(f.amount_spent || 0);
        doc.limiteRest = cap > 0 ? Math.max(0, (cap - gasto) / 100) : null;
      } catch (e) { console.error(`Meta: saldo de ${c.name}: ${e.message}`); }
      // ---- anúncios que rodaram hoje ----
      try {
        const adsH = (await todos(`act_${id}/insights?level=ad&date_preset=today&fields=ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,reach,actions&limit=200`, token))
          .filter((x) => Number(x.impressions || 0) > 0)
          .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0)).slice(0, 15);
        let cri = {};
        if (adsH.length) {
          try { cri = await g(`?ids=${adsH.map((x) => x.ad_id).join(',')}&fields=effective_status,creative{thumbnail_url,image_url,instagram_permalink_url}`, token); } catch (_) {}
        }
        doc.hoje = adsH.map((x) => {
          const r = resultado(x.actions), cr = ((cri[x.ad_id] || {}).creative) || {};
          return { id: x.ad_id, nome: x.ad_name || '', camp: x.campaign_name || '', gasto: Number(x.spend || 0), imp: Number(x.impressions || 0), alcance: Number(x.reach || 0), cliques: Number(x.clicks || 0), res: r.n, resTipo: r.tipo, status: (cri[x.ad_id] || {}).effective_status || '', thumb: cr.thumbnail_url || cr.image_url || '', ig: cr.instagram_permalink_url || '' };
        });
      } catch (e) { console.error(`Meta: anúncios de hoje de ${c.name}: ${e.message}`); doc.hoje = antes.hoje || []; }
      await ref.set(doc);
      vistos.push(id);

      // ---- avisos ----
      const quem = socios;
      if (doc.prepago && doc.saldoDisp != null && lista.some((k) => k.status === 'ACTIVE')) {
        const porDia = lista.filter((k) => k.status === 'ACTIVE').reduce((s, k) => s + (k.orcDia || 0), 0);
        const minimo = Math.max(30, porDia * 2);
        if (doc.saldoDisp < minimo) {
          const chave = `meta_saldo_${id}_${hoje}`;
          if (!(await jaFoi(chave))) { for (const u of quem) await enviar(u, `Saldo baixo: ${doc.nome}`, `Restam R$ ${doc.saldoDisp.toFixed(2).replace('.', ',')} na conta de anúncio. Coloque crédito para os anúncios não pararem.`); await marcar(chave); }
        }
      }
      if (c.account_status !== 1 && c.account_status !== 201) {
        const chave = `meta_conta_${id}_${c.account_status}`;
        if (!(await jaFoi(chave))) { for (const u of quem) await enviar(u, `Conta de anúncio com problema: ${doc.nome}`, `Situação no Meta: ${doc.statusContaTx}. Os anúncios dessa conta podem estar parados.`); await marcar(chave); }
      }
      for (const k of lista) {
        if (PROBLEMA.includes(k.status)) {
          const chave = `meta_camp_${k.id}_${k.status}`;
          if (!(await jaFoi(chave))) {
            const tx = k.status === 'DISAPPROVED' ? 'foi reprovada' : k.status === 'PENDING_BILLING_INFO' ? 'parou por falta de pagamento' : 'está com problema';
            for (const u of quem) await enviar(u, `Campanha ${tx}: ${doc.nome}`, `Campanha "${k.nome}". Confira no Gerenciador de Anúncios.`);
            await marcar(chave);
          }
        }
        if (k.status === 'ACTIVE' && k.fim && k.fim < amanhaIso && k.fim > new Date().toISOString()) {
          const chave = `meta_fim_${k.id}_${k.fim.slice(0, 10)}`;
          if (!(await jaFoi(chave))) { for (const u of quem) await enviar(u, `Campanha termina em breve: ${doc.nome}`, `"${k.nome}" acaba em ${k.fim.slice(8, 10)}/${k.fim.slice(5, 7)}. Renovar?`); await marcar(chave); }
        }
      }
    } catch (e) {
      console.error(`Meta: conta ${c.name} (${id}): ${e.message}`);
      await db.collection('anuncios').doc(id).set({ conta: id, nome: c.name || id, erro: e.message.slice(0, 200), atualizadoEm: agoraIso }, { merge: true });
      vistos.push(id);
    }
  }
  await db.collection('anunciosMeta').doc('estado').set({ atualizadoEm: agoraIso, contas: vistos.length, erro: '' });
};
