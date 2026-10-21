// Agenda sozinho o que o cliente aprovou (só nas lojas com "Agendar sozinho ao aprovar" ligado).
// O post entra na fila da Central no próximo horário livre da loja; quem publica é o robô de postagem (publicar.js).
const arr = (x) => (Array.isArray(x) ? x : []);
const pad = (n) => String(n).padStart(2, '0');

function lerHoras(txt) {
  const out = [];
  for (const m of String(txt || '').matchAll(/\b(\d{1,2})[:h](\d{2})?\b/g)) {
    const h = +m[1], mi = +(m[2] || 0);
    if (h < 24 && mi < 60) out.push(pad(h) + ':' + pad(mi));
  }
  const u = [...new Set(out)].sort();
  return u.length ? u : ['09:00', '12:00', '19:00'];
}

// n horários livres a partir de "desde" (AAAA-MM-DDTHH:MM, hora de Brasília), pulando os já ocupados
function horariosLivres(horas, n, desde, ocupados) {
  const out = [];
  const base = new Date(desde.slice(0, 10) + 'T12:00:00Z');
  for (let d = 0; d < 120 && out.length < n; d++) {
    const dia = new Date(+base + d * 864e5).toISOString().slice(0, 10);
    for (const h of horas) {
      const q = dia + 'T' + h;
      if (q <= desde || ocupados.has(q)) continue;
      out.push(q); ocupados.add(q);
      if (out.length >= n) break;
    }
  }
  return out;
}

function escolherArquivos(tipo, fs) {
  const vid = (f) => /^video\//.test(f.mime || '');
  const img = (f) => /^image\//.test(f.mime || '');
  if (tipo === 'reels') return fs.filter(vid);
  if (tipo === 'feed') return fs.filter(img);
  if (tipo === 'carrossel') return fs.slice(0, 10);
  return fs;
}

module.exports = async function autoAgenda({ db, agoraIso, enviar, usuarios, ehAdm, membroDe }) {
  const lojas = {};
  (await db.collection('lojas').get()).docs.forEach((d) => { const l = d.data(); if (l.autoAprov && l.ativo !== false) lojas[d.id] = { id: d.id, ...l }; });
  if (!Object.keys(lojas).length) return 0;

  const aprs = (await db.collection('aprovacoes').orderBy('respEm', 'desc').limit(25).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.respEm && lojas[a.loja]);
  if (!aprs.length) return 0;
  const prontos = {};
  (await db.collection('posts').where('status', '==', 'pronto').get()).docs.forEach((d) => { prontos[d.id] = { id: d.id, ...d.data() }; });

  // horários já usados por loja
  const ocup = {};
  (await db.collection('posts').where('pubStatus', 'in', ['aguardando', 'publicando']).get()).docs.forEach((d) => {
    const p = d.data(); const s = (ocup[p.loja] = ocup[p.loja] || new Set());
    if (p.quando) s.add(String(p.quando).slice(0, 16));
    arr(p.fila).forEach((x) => x && x.quando && s.add(String(x.quando).slice(0, 16)));
  });

  const itens = [];
  for (const a of aprs) for (const it of arr(a.itens)) if (it.status === 'aprovado' && prontos[it.post] && !prontos[it.post].pubStatus) itens.push({ a, it, p: prontos[it.post] });
  itens.sort((x, y) => String(x.it.em || '').localeCompare(String(y.it.em || '')));

  let feitos = 0;
  const desde0 = (() => { const d = new Date(Date.parse(agoraIso.slice(0, 16) + ':00Z') + 15 * 60e3); return d.toISOString().slice(0, 16); })();
  for (const { it, p } of itens) {
    const lj = lojas[p.loja]; if (!lj) continue;
    const tipo = p.tipo || it.tipo || 'feed';
    let fs = escolherArquivos(tipo, arr(it.arquivos));
    if (!fs.length) { console.log(`Aprovados: ${lj.nome} · ${p.titulo}: sem arquivo compatível com ${tipo}, ficou em Para programar`); continue; }
    const serie = ['stories', 'reels', 'feed'].includes(tipo) && fs.length > 1;
    const n = serie ? fs.length : 1;
    const set = (ocup[lj.id] = ocup[lj.id] || new Set());
    const hs = horariosLivres(lerHoras(lj.autoHoras), n, desde0, set);
    if (hs.length < n) continue;
    const temVideo = fs.some((f) => /^video\//.test(f.mime || ''));
    const fb = !!lj.autoFB && !(tipo === 'carrossel' && temVideo);
    const ig = lj.autoIG !== false;
    if (!ig && !fb) continue;
    const doc = {
      tipo, legenda: String(p.legenda || it.legenda || lj.legPadrao || '').slice(0, 2200), quando: hs[0], pubIG: ig, pubFB: fb,
      arquivos: fs.map((f) => ({ id: f.id, nome: f.nome || f.name || '', mime: f.mime || '' })), pubStatus: 'aguardando', pubErro: '', pubFeito: {}, status: 'programado',
      programadoPor: 'Automático (aprovado pelo cliente)', programadoEm: agoraIso, autoAprov: true,
      fila: serie ? hs.map((t, i) => ({ i, quando: t, ig: '', fb: '', legenda: '' })) : [], agenda: serie ? hs : [], qtd: serie ? hs.length : 1, quandoIni: hs[0], quandoFim: hs[hs.length - 1],
    };
    try {
      await db.collection('posts').doc(p.id).update(doc);
      feitos++;
      console.log(`Aprovados: ${lj.nome} · ${p.titulo} agendado para ${hs[0]}${serie ? ' até ' + hs[hs.length - 1] : ''}`);
      const para = [...new Set([...usuarios.filter((u) => membroDe(u) === (lj.postagem || 'Vanessa')), ...usuarios.filter(ehAdm)])];
      const quando = hs[0].slice(8, 10) + '/' + hs[0].slice(5, 7) + ' às ' + hs[0].slice(11, 16);
      for (const u of para) await enviar(u, `Aprovado e agendado: ${lj.nome || 'cliente'}`, `${p.titulo} sai ${quando}${serie ? ' (e mais ' + (hs.length - 1) + ')' : ''}.`);
    } catch (e) { console.error('Aprovados:', e.message); }
  }
  return feitos;
};
module.exports.horariosLivres = horariosLivres;
module.exports.lerHoras = lerHoras;
