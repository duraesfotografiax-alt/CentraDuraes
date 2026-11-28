// Transcreve a fala de um vídeo no próprio robô (modelo Whisper rodando no GitHub Actions: sem custo e sem chave extra).
// É opcional: se o pacote ou o modelo não carregarem, a legenda sai só com as imagens.
let pronto = null;
function carregar() {
  if (!pronto) pronto = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    try { env.cacheDir = require('path').join(__dirname, 'node_modules', '.modelos'); } catch (_) {}
    return pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { dtype: 'q8' });
  })();
  return pronto;
}
// f32 = áudio mono 16 kHz em Float32Array
async function transcrever(f32) {
  const asr = await carregar();
  const out = await asr(f32, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  return String((out && out.text) || '').replace(/\s+/g, ' ').trim();
}
module.exports = { transcrever };
