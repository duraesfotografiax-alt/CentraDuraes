// Prévias de vídeo para a página de aprovação do cliente.
// O Drive não foi feito para exibir vídeo (trava, limita e não toca HEVC de iPhone). Aqui o robô manda cada vídeo da aprovação para o
// Bunny Stream, que converte sozinho e entrega com um player de verdade. A página aprovar.html usa o player do Bunny quando a prévia está
// pronta e, enquanto não estiver (ou se der erro), continua usando o Drive como antes.
// Segredos no GitHub: BUNNY_API_KEY (chave da biblioteca) e BUNNY_LIBRARY_ID (número da biblioteca).
const LIB = () => String(process.env.BUNNY_LIBRARY_ID || '').trim();
const KEY = () => String(process.env.BUNNY_API_KEY || '').trim();
const BASE = 'https://video.bunnycdn.com/library';
const arr = (x) => (Array.isArray(x) ? x : []);
const ehVideo = (f) => /^video\//.test((f && f.mime) || '');
const DIAS = 7;            // só aprovações criadas nos últimos 7 dias
const POR_VEZ = 4;         // vídeos enviados por chamada (para não segurar as postagens)

async function api(caminho, metodo, corpo, tipo) {
  const r = await fetch(`${BASE}/${LIB()}${caminho}`, {
    method: metodo || 'GET',
    headers: Object.assign({ AccessKey: KEY(), Accept: 'application/json' }, corpo ? { 'Content-Type': tipo || 'application/json' } : {}),
    body: corpo === undefined ? undefined : (tipo ? corpo : JSON.stringify(corpo)),
  });
  const t = await r.text().catch(() => '');
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) {}
  if (!r.ok || j.success === false) throw new Error(`Bunny ${r.status}: ${(j.message || t || '').toString().slice(0, 120)}`);
  return j;
}

const cache = (db) => db.collection('bunnyCache'); // vídeos já convertidos, por id do arquivo no Drive
const pronto = (v) => v.status === 4 || (arr([v.availableResolutions]).join('') !== '' && v.status !== 5 && v.status !== 6);

// Aprovações recentes que ainda têm vídeo sem prévia pronta (para o plantão saber se vale chamar processar)
function pendentes(docs, agoraMs) {
  const corte = new Date((agoraMs || Date.now()) - DIAS * 864e5).toISOString();
  return arr(docs).some((a) => String(a.criadoEm || '') >= corte && arr(a.itens).some((it) => it.status === 'aguardando' && arr(it.arquivos).some((f) => {
    if (!ehVideo(f)) return false;
    const pv = (a.previas || {})[f.id];
    if (!pv) return true;
    if (pv.ok) return false;
    return !pv.erro || ((pv.n || 0) < 3 && Date.now() - new Date(pv.em || 0).getTime() > 10 * 60e3);
  })));
}

async function processar({ db, baixar }) {
  if (!LIB() || !KEY()) return 0;
  const corte = new Date(Date.now() - DIAS * 864e5).toISOString();
  const sn = await db.collection('aprovacoes').orderBy('criadoEm', 'desc').limit(20).get();
  let enviados = 0;
  for (const d of sn.docs) {
    const a = d.data();
    if (String(a.criadoEm || '') < corte) continue;
    const previas = a.previas || {};
    // 1) vídeos que já subiram: confere se o Bunny terminou de converter
    for (const [fid, pv] of Object.entries(previas)) {
      if (pv.ok || pv.erro || !pv.id) continue;
      try {
        const v = await api(`/videos/${pv.id}`);
        if (v.status === 5 || v.status === 6) await d.ref.update({ ['previas.' + fid]: Object.assign({}, pv, { erro: 'O Bunny não conseguiu converter o vídeo.', em: new Date().toISOString(), n: (pv.n || 0) + 1 }) });
        else if (pronto(v)) { await d.ref.update({ ['previas.' + fid]: Object.assign({}, pv, { ok: true }) }); try { await cache(db).doc(fid).set({ ok: true }, { merge: true }); } catch (_) {} console.log(`Prévias: pronta (${a.lojaNome || ''}) ${fid}`); }
        else if (Date.now() - new Date(pv.em || 0).getTime() > 40 * 60e3) await d.ref.update({ ['previas.' + fid]: Object.assign({}, pv, { erro: 'A conversão demorou demais.', em: new Date().toISOString(), n: 3 }) });
      } catch (e) { console.error('Prévias (conferir):', e.message); }
    }
    // 2) vídeos novos (ou que falharam há mais de 10 min): baixa do Drive e manda
    for (const it of arr(a.itens)) {
      if (it.status !== 'aguardando') continue;
      for (const f of arr(it.arquivos)) {
        if (!ehVideo(f) || enviados >= POR_VEZ) continue;
        const pv = previas[f.id];
        if (pv && (pv.ok || (pv.id && !pv.erro))) continue;
        if (pv && pv.erro && ((pv.n || 0) >= 3 || Date.now() - new Date(pv.em || 0).getTime() < 10 * 60e3)) continue;
        const n = ((pv && pv.n) || 0) + 1;
        // já convertido antes (quando o card caiu em Para programar): só aproveita
        try {
          const c = (await cache(db).doc(f.id).get()).data();
          if (c && c.id && !c.erro) {
            await d.ref.update({ ['previas.' + f.id]: { id: c.id, lib: c.lib || LIB(), ok: !!c.ok, em: c.em || new Date().toISOString(), n: c.n || 1 } });
            previas[f.id] = { id: c.id, ok: !!c.ok };
            console.log(`Prévias: aproveitou a conversão antecipada (${a.lojaNome || ''} · ${it.titulo || ''})${c.ok ? ', já pronta' : ''}`);
            continue;
          }
        } catch (_) {}
        try {
          const x = await baixar({ id: f.id, nome: f.nome, mime: f.mime });
          const v = await api('/videos', 'POST', { title: `${a.lojaNome || 'Cliente'} · ${it.titulo || f.nome || f.id}`.slice(0, 120) });
          await api(`/videos/${v.guid}`, 'PUT', x.buf, 'application/octet-stream');
          await d.ref.update({ ['previas.' + f.id]: { id: v.guid, lib: LIB(), ok: false, em: new Date().toISOString(), n } });
          try { await cache(db).doc(f.id).set({ id: v.guid, lib: LIB(), ok: false, em: new Date().toISOString(), n }); } catch (_) {}
          enviados++;
          console.log(`Prévias: enviado ${a.lojaNome || ''} · ${it.titulo || ''} (${Math.round(x.buf.length / 1e6)} MB)`);
        } catch (e) {
          console.error('Prévias:', e.message);
          try { await d.ref.update({ ['previas.' + f.id]: { erro: String(e.message).slice(0, 160), em: new Date().toISOString(), n } }); } catch (_) {}
        }
      }
    }
  }
  return enviados;
}

// Conversão antecipada: assim que o card cai em "Para programar", o vídeo já sobe para o Bunny.
// Quando a equipe gerar o link de aprovação, o player já está pronto (o link libera em segundos).
const DIAS_PRE = 15;      // só cards mexidos nos últimos 15 dias
const PRE_POR_VEZ = 1;    // 1 vídeo por chamada, para não segurar as postagens
const semVideo = new Set(); // cards já olhados nesta rodada que não têm vídeo (ou o robô não acessa)
async function preConverter({ db }) {
  if (!LIB() || !KEY()) return 0;
  const c = cache(db);
  // 1) confere os que já subiram
  for (const d of (await c.where('ok', '==', false).limit(30).get()).docs) {
    const x = d.data(); if (x.erro || !x.id) continue;
    try {
      const v = await api(`/videos/${x.id}`);
      if (v.status === 5 || v.status === 6) await d.ref.update({ erro: 'O Bunny não conseguiu converter o vídeo.', em: new Date().toISOString(), n: (x.n || 0) + 1 });
      else if (pronto(v)) await d.ref.update({ ok: true });
    } catch (e) { console.error('Prévias antecipadas (conferir):', e.message); }
  }
  // 2) sobe os vídeos dos cards novos
  const drive = require('./drive');
  const corte = new Date(Date.now() - DIAS_PRE * 864e5).toISOString().slice(0, 16);
  const posts = (await db.collection('posts').where('status', '==', 'pronto').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.drive && !p.pubStatus && String(p.editadoEm || '') >= corte && !semVideo.has(p.id + '|' + p.drive))
    .sort((a, b) => String(b.editadoEm || '').localeCompare(String(a.editadoEm || '')));
  let enviados = 0;
  for (const p of posts) {
    if (enviados >= PRE_POR_VEZ) break;
    let arqs = [];
    try { arqs = (await drive.midiaDoLink(p.drive)).filter((f) => /^video\//.test(f.mimeType || '')); } catch (_) { semVideo.add(p.id + '|' + p.drive); continue; } // sem acesso à pasta: fica para a hora do link
    if (!arqs.length) { semVideo.add(p.id + '|' + p.drive); continue; } // só fotos: não precisa de player
    for (const f of arqs.slice(0, 10)) {
      if (enviados >= PRE_POR_VEZ) break;
      const ref = c.doc(f.id), x = (await ref.get()).data();
      if (x && (x.ok || (x.id && !x.erro))) continue;
      if (x && x.erro && ((x.n || 0) >= 3 || Date.now() - new Date(x.em || 0).getTime() < 10 * 60e3)) continue;
      if (Number(f.size) > 1.5e9) continue;
      const n = ((x && x.n) || 0) + 1;
      try {
        const buf = await drive.baixar(f.id);
        const v = await api('/videos', 'POST', { title: `${p.titulo || f.name}`.slice(0, 120) });
        await api(`/videos/${v.guid}`, 'PUT', buf, 'application/octet-stream');
        await ref.set({ id: v.guid, lib: LIB(), ok: false, em: new Date().toISOString(), n, post: p.id });
        enviados++;
        console.log(`Prévias antecipadas: ${p.titulo || ''} · ${f.name} (${Math.round(buf.length / 1e6)} MB)`);
      } catch (e) {
        console.error('Prévias antecipadas:', e.message);
        try { await ref.set({ erro: String(e.message).slice(0, 160), ok: false, em: new Date().toISOString(), n }, { merge: true }); } catch (_) {}
      }
    }
  }
  return enviados;
}

module.exports = { processar, pendentes, preConverter };
