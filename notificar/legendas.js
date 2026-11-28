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
    p.visto ? `Imagens do conteúdo: anexei ${p.visto} quadro(s) do vídeo/fotos. Descreva na legenda o que realmente aparece (carro, produto, cena, ambiente). Não cite nada que não esteja nas imagens ou na fala.` : '',
    p.fala ? `O que é dito no vídeo (transcrição automática, pode ter erros de nome ou palavra; use só como apoio): "${String(p.fala).slice(0, 1800)}"` : '',
    p.base ? `Informações fixas que devem aparecer no final (endereço, WhatsApp, hashtags): ${p.base}` : '',
    'Regras: comece com um gancho curto; no máximo 5 linhas antes das informações fixas; no máximo 2 emojis; não invente preços, promoções ou datas que não foram informados; não use travessão longo.',
    p.visto ? 'Responda SOMENTE com um JSON: {"resumo":"1 frase dizendo o que aparece no conteúdo","opcoes":["...","...","..."]}' : 'Responda SOMENTE com um JSON: {"opcoes":["...","...","..."]}',
  ].filter(Boolean).join('\n');
}

async function gerar(p, imagens, completo) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error('A chave da IA ainda não foi colocada no GitHub (segredo ANTHROPIC_API_KEY).');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 1100, messages: [{ role: 'user', content: (imagens && imagens.length ? imagens.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } })) : []).concat([{ type: 'text', text: montarPrompt(p) }]) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'A IA respondeu ' + r.status);
  const txt = ((j.content || []).find((c) => c.type === 'text') || {}).text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  const js = m ? JSON.parse(m[0]) : {};
  const op = js.opcoes || [];
  const lim = op.map((x) => String(x).trim().slice(0, 2200)).filter(Boolean).slice(0, 3);
  if (!lim.length) throw new Error('A IA não devolveu legendas. Tente de novo.');
  return completo ? { opcoes: lim, resumo: String(js.resumo || '').slice(0, 300) } : lim;
}

// ---------- Ler o vídeo (quadros + fala) ----------
const ffbin = () => { try { return require('ffmpeg-static') || 'ffmpeg'; } catch (_) { return 'ffmpeg'; } };
const rodar = (args, saida) => new Promise((ok, no) => {
  const { spawn } = require('child_process');
  const pr = spawn(ffbin(), args, { stdio: ['ignore', saida ? 'pipe' : 'ignore', 'pipe'] });
  const out = [], err = []; let t = '';
  const to = setTimeout(() => { try { pr.kill('SIGKILL'); } catch (_) {} }, 240e3);
  if (saida) pr.stdout.on('data', (d) => out.push(d));
  pr.stderr.on('data', (d) => { t += d; if (t.length > 20000) t = t.slice(-8000); });
  pr.on('error', no);
  pr.on('close', (c) => { clearTimeout(to); ok({ code: c, out: Buffer.concat(out), err: t }); });
});
async function duracao(arq) {
  const r = await rodar(['-hide_banner', '-i', arq]);
  const d = r.err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { seg: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0, audio: /Audio:/.test(r.err) };
}
async function quadros(arq, seg, n) {
  const fs = require('fs'), path = require('path'), out = [];
  const dir = path.dirname(arq);
  for (let i = 0; i < n; i++) {
    const t = seg > 0 ? Math.max(0, Math.min(seg - 0.2, (i + 0.5) / n * seg)) : 0, dest = path.join(dir, 'q' + i + '.jpg');
    const r = await rodar(['-y', '-ss', t.toFixed(2), '-i', arq, '-frames:v', '1', '-vf', 'scale=720:720:force_original_aspect_ratio=decrease', '-q:v', '5', dest]);
    if (r.code === 0 && fs.existsSync(dest)) out.push(fs.readFileSync(dest));
    if (seg <= 0) break;
  }
  return out;
}
async function falaDe(arq, info) {
  if (!info.audio) return '';
  const r = await rodar(['-v', 'error', '-i', arq, '-vn', '-t', '180', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], true);
  if (r.code !== 0 || r.out.length < 16000 * 4 * 2) return '';
  const f32 = new Float32Array(r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + r.out.length - (r.out.length % 4)));
  let soma = 0; for (let i = 0; i < f32.length; i += 7) soma += f32[i] * f32[i];
  if (Math.sqrt(soma / (f32.length / 7)) < 0.004) return ''; // só silêncio/ruído baixo
  try { return await require('./fala').transcrever(f32); } catch (e) { console.error('Legendas (fala):', String(e.message || e).slice(0, 160)); return ''; }
}
// baixa o vídeo (ou as fotos) do link do Drive do card e devolve o que a IA precisa ver
async function lerMidia(p) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const drive = require('./drive');
  const arqs = await drive.midiaDoLink(p.drive);
  if (!arqs.length) throw new Error('Não achei vídeo nem foto nesse link do Drive (o robô precisa ter acesso à pasta).');
  const vid = arqs.find((a) => /^video\//.test(a.mimeType || ''));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leg-'));
  try {
    if (vid) {
      const arq = path.join(dir, 'video');
      await drive.baixarPara(vid.id, arq, 700e6);
      const info = await duracao(arq);
      const q = await quadros(arq, info.seg, info.seg > 45 ? 10 : 8);
      if (!q.length) throw new Error('Não consegui abrir esse vídeo para ver as imagens.');
      const fala = await falaDe(arq, info);
      return { imagens: q, fala, tipoMidia: 'vídeo' };
    }
    let sharp = null; try { sharp = require('sharp'); } catch (_) {}
    const q = [];
    for (const f of arqs.filter((a) => /^image\//.test(a.mimeType || '')).slice(0, 8)) {
      let b = await drive.baixar(f.id);
      if (sharp) b = await sharp(b).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
      q.push(b);
    }
    return { imagens: q, fala: '', tipoMidia: 'fotos' };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

async function processar({ db, agoraIso, pedidos }) {
  const lista = pedidos || (await db.collection('legendas').where('status', '==', 'pedido').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let n = 0;
  for (const p of lista.slice(0, 6)) {
    const ref = db.collection('legendas').doc(p.id);
    try {
      let imagens = null, extra = {};
      if (p.drive && p.modo !== 'texto') {
        try {
          const m = await lerMidia(p);
          imagens = m.imagens; p.visto = imagens.length; p.fala = m.fala;
          extra = { visto: imagens.length, fala: m.fala || '', midia: m.tipoMidia };
        } catch (e) {
          if (p.modo === 'video') throw e; // pediu "ler o vídeo": avisa o motivo em vez de gerar às cegas
          console.error('Legendas (mídia):', String(e.message || e).slice(0, 160));
        }
      }
      const r = await gerar(p, imagens, true);
      await ref.update(Object.assign({ status: 'pronto', opcoes: r.opcoes, resumo: r.resumo || '', prontoEm: agoraIso }, extra));
      if (p.postId) {
        try { await db.collection('posts').doc(p.postId).update({ legendaIA: { opcoes: r.opcoes, resumo: r.resumo || '', fala: extra.fala || '', visto: extra.visto || 0, em: agoraIso } }); } catch (_) {}
      }
      n++;
    } catch (e) {
      if (p.postId) { try { await db.collection('posts').doc(p.postId).update({ legendaIA: require('firebase-admin').firestore.FieldValue.delete() }); } catch (_) {} }
      try { await ref.update({ status: 'erro', erro: String(e.message || e).slice(0, 200) }); } catch (_) {}
    }
  }
  return n;
}
module.exports = { processar, gerar, montarPrompt };
