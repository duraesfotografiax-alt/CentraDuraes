// Gerador de legendas: o app grava um pedido em "legendas"; o robô responde com 3 opções escritas pela IA.
// Precisa do segredo ANTHROPIC_API_KEY no GitHub (Settings → Secrets → Actions). Sem ele, o pedido volta com o aviso.
const MODELO = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

function montarPrompt(p) {
  const tipo = { reels: 'Reels (vídeo curto)', stories: 'Stories', feed: 'post de feed', carrossel: 'carrossel' }[p.tipo] || 'post';
  return [
    `Escreva 3 opções de legenda em português do Brasil para um ${tipo} do Instagram da loja "${p.lojaNome || ''}".`,
    p.sobre ? `Sobre a loja: ${p.sobre}` : '',
    p.tom ? `Tom de voz: ${p.tom}` : 'Tom: próximo, direto e simpático.',
    p.titulo ? `Nome do conteúdo: ${p.titulo}` : '',
    p.nota ? `O que aparece/é dito no conteúdo: ${p.nota}` : '',
    p.base ? `Informações fixas que devem aparecer no final (endereço, WhatsApp, hashtags): ${p.base}` : '',
    'Regras: comece com um gancho curto; no máximo 5 linhas antes das informações fixas; no máximo 2 emojis; não invente preços, promoções ou datas que não foram informados; não use travessão longo.',
    'Responda SOMENTE com um JSON: {"opcoes":["...","...","..."]}',
  ].filter(Boolean).join('\n');
}

async function gerar(p) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error('A chave da IA ainda não foi colocada no GitHub (segredo ANTHROPIC_API_KEY).');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 900, messages: [{ role: 'user', content: montarPrompt(p) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'A IA respondeu ' + r.status);
  const txt = ((j.content || []).find((c) => c.type === 'text') || {}).text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  const op = m ? (JSON.parse(m[0]).opcoes || []) : [];
  const lim = op.map((x) => String(x).trim().slice(0, 2200)).filter(Boolean).slice(0, 3);
  if (!lim.length) throw new Error('A IA não devolveu legendas. Tente de novo.');
  return lim;
}

async function processar({ db, agoraIso, pedidos }) {
  const lista = pedidos || (await db.collection('legendas').where('status', '==', 'pedido').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let n = 0;
  for (const p of lista.slice(0, 6)) {
    const ref = db.collection('legendas').doc(p.id);
    try {
      const opcoes = await gerar(p);
      await ref.update({ status: 'pronto', opcoes, prontoEm: agoraIso });
      n++;
    } catch (e) { try { await ref.update({ status: 'erro', erro: String(e.message || e).slice(0, 200) }); } catch (_) {} }
  }
  return n;
}
module.exports = { processar, gerar, montarPrompt };
