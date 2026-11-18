// Entregas da Durães: quando o Lucas (vídeo) ou a Vanessa (fotos) exporta algo na pasta de um cliente
// (Casamentos, Aniversários, Ensaios), a Central avisa os três e deixa pronto o botão "Gerar link da galeria".
// O robô enxerga as pastas pela conta de serviço: as 3 pastas precisam estar compartilhadas (Leitor) com ela.
const drive = require('./drive');
const { FOLDER, DAPI } = drive;

const RAIZES_PADRAO = [
  { id: '1JBl9lYK3EvYClxbB9VDnbJ6Q7k-rkqq_', nome: 'Casamentos', tipo: 'Casamento' },
  { id: '17lHgQ1EBpH2g87WmOen5I9s6GQgDUqhA', nome: 'Aniversários', tipo: 'Aniversário' },
  { id: '1lYk6f9qJmGKqtEQNtP70qHRczJ4tQ_ww', nome: 'Ensaios Fotográficos', tipo: 'Ensaio' },
];
const QUIETO_MS = 20 * 60e3; // só avisa depois de 20 min sem arquivo novo (exportação terminou)
const nrm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ignora = (s) => /(postad|publicad|usad|antig|arquivad|bruto|backup|lixo|nao\s*usar|\bold\b|(^|[^a-z])raw([^a-z]|$)|selecao|originais?)/i.test(nrm(s));
const midia = (m) => /^(image|video)\//.test(m || '');

const pais = new Map();
async function pai(id) {
  if (pais.has(id)) return pais.get(id);
  let r = null;
  try { const j = await drive.g(`${DAPI}/files/${id}?fields=id,name,parents&supportsAllDrives=true`); r = { nome: j.name, pai: (j.parents || [])[0] || '' }; } catch (_) {}
  pais.set(id, r);
  return r;
}
// sobe pelas pastas até achar uma das raízes; devolve o cliente (pasta logo abaixo da raiz) e os capítulos no caminho
async function localizar(parents, raizes) {
  let id = parents && parents[0]; const trilha = [];
  for (let i = 0; i < 8 && id; i++) {
    const r = raizes.find((x) => x.id === id);
    if (r) { const t = trilha.reverse(); return t.length ? { raiz: r, cliente: t[0], caps: t.slice(1).map((x) => x.nome) } : null; }
    const p = await pai(id); if (!p) return null;
    trilha.push({ id, nome: p.nome }); id = p.pai;
  }
  return null;
}
async function resumo(clienteId) {
  let nVid = 0, nFoto = 0; const caps = {};
  const anda = async (id, cap, nv) => {
    for (const f of await drive.listar(id)) {
      if (f.mimeType === FOLDER) { if (nv < 3 && !ignora(f.name)) await anda(f.id, cap || f.name, nv + 1); }
      else if (midia(f.mimeType)) { if (/^video\//.test(f.mimeType)) nVid++; else nFoto++; const k = cap || '(raiz)'; caps[k] = (caps[k] || 0) + 1; }
    }
  };
  await anda(clienteId, '', 0);
  return { nVid, nFoto, capitulos: Object.entries(caps).map(([nome, n]) => ({ nome, n })).slice(0, 30) };
}

module.exports = async function entregas({ db, usuarios, enviar, ehAdm, membroDe }) {
  const estRef = db.collection('config').doc('entregasEstado');
  const est = (await estRef.get()).data() || {};
  if (est.ultMs && Date.now() - est.ultMs < 4 * 60e3) return;
  const cfg = (await db.collection('config').doc('entregasDur').get()).data() || {};
  const raizes = Array.isArray(cfg.raizes) && cfg.raizes.length ? cfg.raizes : RAIZES_PADRAO;

  // as pastas estão visíveis para o robô?
  const status = [];
  for (const r of raizes) {
    try { await drive.g(`${DAPI}/files/${r.id}?fields=id,name&supportsAllDrives=true`); status.push({ id: r.id, nome: r.nome, ok: true }); }
    catch (e) { status.push({ id: r.id, nome: r.nome, ok: false }); }
  }
  await db.collection('config').doc('robo').set({ entregasRaizes: status }, { merge: true });
  const visiveis = raizes.filter((r) => status.find((s) => s.id === r.id && s.ok));
  if (!visiveis.length) { await estRef.set({ ultMs: Date.now() }, { merge: true }); console.log('Entregas: o robô ainda não enxerga nenhuma das pastas (compartilhar com a conta do robô).'); return; }

  const agora = new Date().toISOString();
  if (!est.cursor) { await estRef.set({ cursor: agora, ultMs: Date.now() }, { merge: true }); console.log('Entregas: início do monitoramento.'); return; }

  // arquivos novos/alterados desde a última passada
  let achados = [], pt = '', maxMod = est.cursor;
  const q = encodeURIComponent(`modifiedTime > '${est.cursor}' and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`);
  do {
    const j = await drive.g(`${DAPI}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,parents,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pt ? '&pageToken=' + pt : ''}`);
    achados = achados.concat(j.files || []); pt = j.nextPageToken || '';
  } while (pt && achados.length < 5000);

  const porCliente = new Map();
  for (const f of achados) {
    if (f.modifiedTime > maxMod) maxMod = f.modifiedTime;
    const loc = await localizar(f.parents, visiveis);
    if (!loc || ignora(loc.cliente.nome) || loc.caps.some(ignora)) continue;
    const c = porCliente.get(loc.cliente.id) || { loc, n: 0 };
    c.n++; porCliente.set(loc.cliente.id, c);
  }
  const ms = Date.now();
  for (const [id, c] of porCliente) {
    const ref = db.collection('entregas').doc(id);
    const d = (await ref.get()).data() || {};
    await ref.set({
      nome: String(c.loc.cliente.nome).trim(), tipo: c.loc.raiz.tipo || c.loc.raiz.nome, raizId: c.loc.raiz.id,
      status: 'pendente',
      atualiza: !!d.envioId, ultNovoMs: ms, nNovos: (d.status === 'pendente' ? d.nNovos || 0 : 0) + c.n,
    }, { merge: true });
  }
  await estRef.set({ cursor: maxMod, ultMs: Date.now() }, { merge: true });

  // pendentes que já ficaram quietos: calcula o conteúdo e avisa
  const pend = (await db.collection('entregas').where('status', '==', 'pendente').get()).docs;
  for (const d of pend) {
    const e = d.data();
    if (Date.now() - (e.ultNovoMs || 0) < QUIETO_MS) continue;
    let r; try { r = await resumo(d.id); } catch (er) { console.error('Entregas:', e.nome, er.message); continue; }
    if (!r.nVid && !r.nFoto) { await d.ref.update({ status: 'dispensada' }); continue; }
    const novos = !!e.atualiza;
    await d.ref.update(Object.assign(r, { status: novos ? 'atualizada' : 'pronta', prontoEm: new Date().toISOString(), avisadoEm: new Date().toISOString() }));
    const partes = [r.nVid ? `${r.nVid} vídeo${r.nVid > 1 ? 's' : ''}` : '', r.nFoto ? `${r.nFoto} foto${r.nFoto > 1 ? 's' : ''}` : ''].filter(Boolean).join(' e ');
    const para = [...new Set([...usuarios.filter((u) => ['Thiago', 'Vanessa', 'Lucas'].includes(membroDe(u))), ...usuarios.filter(ehAdm)])];
    console.log(`Entregas: ${e.nome} (${e.tipo}) ${novos ? 'com arquivos novos' : 'pronta'}: ${partes}`);
    for (const u of para) await enviar(u, novos ? `Arquivos novos: ${e.nome}` : `Entrega pronta: ${e.nome}`, novos ? `${partes} no total. O link do cliente já mostra os novos.` : `${partes} em ${r.capitulos.length} pasta${r.capitulos.length > 1 ? 's' : ''}. Toque em Envios para gerar o link da galeria.`);
  }
};
