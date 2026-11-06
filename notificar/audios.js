// Busca de músicas da biblioteca do Instagram (Instagram Audio API, só para Reels).
// O app grava um pedido em "audioBusca"; o robô consulta o Instagram com a chave da loja e devolve a lista de músicas.
let cachePag = { em: 0, lista: null };

async function paginasCache(pub, token) {
  if (cachePag.lista && Date.now() - cachePag.em < 5 * 60e3) return cachePag.lista;
  cachePag = { em: Date.now(), lista: await pub.paginas(token) };
  return cachePag.lista;
}

async function processar({ db, pedidos }) {
  const token = process.env.META_TOKEN;
  const lista = pedidos || (await db.collection('audioBusca').where('status', '==', 'pedido').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!lista.length) return 0;
  const pub = require('./publicar');
  let n = 0;
  for (const p of lista.slice(0, 6)) {
    const ref = db.collection('audioBusca').doc(p.id);
    try {
      if (!token) throw new Error('Falta o META_TOKEN no GitHub.');
      const lj = (await db.collection('lojas').doc(p.loja).get()).data() || {};
      const pags = await paginasCache(pub, token);
      const pag = pags.find((x) => x.id === lj.fbPage) || pags.find((x) => lj.igId && x.ig === lj.igId) || pags.find((x) => x.igUser && lj.instagram && x.igUser.toLowerCase() === String(lj.instagram).replace(/^@/, '').toLowerCase());
      if (!pag || !pag.ig) throw new Error('Essa loja ainda não está ligada a um Instagram na Central.');
      const resultados = await pub.buscarAudio(pag, String(p.q || '').trim().slice(0, 80), token);
      await ref.update({ status: 'pronto', resultados, prontoEm: new Date().toISOString() });
      n++;
    } catch (e) { try { await ref.update({ status: 'erro', erro: String(e.message || e).slice(0, 220) }); } catch (_) {} }
  }
  return n;
}
module.exports = { processar };
