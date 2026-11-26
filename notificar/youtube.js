// YouTube Shorts: liga o canal de cada loja (OAuth do Google), renova o acesso e envia o vídeo (YouTube Data API, videos.insert).
// Segredos no GitHub: YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET. Os acessos dos canais ficam só no Firestore (coleção youtubeContas, que o app não lê).
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const REDIRECT = (process.env.APP_URL || 'https://duraesfotografiax-alt.github.io/CentraDuraes/').replace(/\/?$/, '/') + 'youtube.html';
const chaves = () => ({ id: process.env.YOUTUBE_CLIENT_ID || '', secret: process.env.YOUTUBE_CLIENT_SECRET || '' });
const temChaves = () => { const c = chaves(); return !!(c.id && c.secret); };

const MSG = {
  quotaExceeded: 'o YouTube atingiu o limite diário de envios do aplicativo; tente amanhã',
  uploadLimitExceeded: 'o canal atingiu o limite de envios do YouTube por hoje; tente mais tarde',
  forbidden: 'o YouTube não deixou enviar por este canal (permissão)',
  youtubeSignupRequired: 'a conta do Google ainda não tem canal no YouTube',
  invalidTitle: 'o título do vídeo não foi aceito pelo YouTube',
  videoTooLong: 'o vídeo é longo demais para o YouTube',
  authError: 'o acesso ao canal expirou; ligue o canal de novo',
};
function erroYT(status, j, txt) {
  const e = (j && j.error) || {};
  const motivo = (e.errors && e.errors[0] && e.errors[0].reason) || (typeof e === 'string' ? e : '') || '';
  return new Error('YouTube: ' + (MSG[motivo] || e.message || (typeof e === 'string' ? e : '') || String(txt || '').slice(0, 120) || `respondeu ${status}`) + (motivo && !MSG[motivo] ? ` (${motivo})` : ''));
}

async function pedirToken(campos) {
  const c = chaves();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: c.id, client_secret: c.secret }, campos)).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const err = new Error('YouTube: ' + (j.error === 'invalid_grant' ? MSG.authError : (j.error_description || j.error || `respondeu ${r.status}`)).toString().slice(0, 200));
    err.invalido = j.error === 'invalid_grant';
    throw err;
  }
  return j;
}

// Troca os códigos que o dono do canal autorizou (youtube.html grava em youtubeAuth) pelos acessos
async function trocarCodigos({ db, usuarios, enviar, ehAdm, agoraIso }) {
  if (!temChaves()) return 0;
  const sn = await db.collection('youtubeAuth').where('status', '==', 'recebido').get();
  let feitos = 0;
  for (const d of sn.docs) {
    const a = d.data();
    try {
      if (!a.loja || !a.code) throw new Error('pedido incompleto');
      const j = await pedirToken({ code: a.code, grant_type: 'authorization_code', redirect_uri: REDIRECT });
      if (!j.refresh_token) throw new Error('o Google não devolveu o acesso permanente; no link, escolha a conta e aceite todas as permissões');
      await db.collection('youtubeContas').doc(a.loja).set({ access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope || '', expiraEm: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
      let nome = '', foto = '', canal = '';
      try {
        const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + j.access_token } });
        const c = await r.json();
        const it = (c.items || [])[0];
        if (it) { nome = (it.snippet && it.snippet.title) || ''; foto = (it.snippet && it.snippet.thumbnails && it.snippet.thumbnails.default && it.snippet.thumbnails.default.url) || ''; canal = it.id || ''; }
        else throw new Error('essa conta do Google não tem canal no YouTube');
      } catch (e) { if (/não tem canal/.test(e.message)) throw e; }
      const lref = db.collection('lojas').doc(a.loja);
      const l = (await lref.get()).data() || {};
      await lref.update({ youtube: { ligado: true, nome, foto, canal, em: agoraIso || '' } });
      await d.ref.update({ status: 'ligado', code: '', nome });
      feitos++;
      console.log(`YouTube: canal ligado à loja ${l.nome || a.loja} (${nome || canal})`);
      if (enviar && usuarios) for (const u of usuarios.filter(ehAdm)) await enviar(u, 'YouTube ligado', `${l.nome || 'Loja'}: o canal ${nome || 'do YouTube'} foi ligado à Central.`);
    } catch (e) {
      console.error('YouTube (ligar):', e.message);
      try { await d.ref.update({ status: 'erro', erro: String(e.message).slice(0, 200), code: '' }); } catch (_) {}
    }
  }
  return feitos;
}

// Acesso válido da loja (o do Google dura 1 hora; renova se faltar menos de 5 minutos)
async function acesso(db, lojaId) {
  const ref = db.collection('youtubeContas').doc(lojaId);
  const c = (await ref.get()).data();
  if (!c || !c.refresh_token) throw new Error('YouTube: o canal desta loja ainda não foi ligado à Central.');
  if (c.access_token && c.expiraEm - Date.now() > 5 * 60e3) return c;
  const j = await pedirToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token });
  const novo = Object.assign({}, c, { access_token: j.access_token, expiraEm: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  await ref.set(novo);
  return novo;
}

const limpa = (s) => String(s || '').replace(/[<>]/g, '').trim();
function titulo(legenda, tit) {
  const linha = limpa(String(legenda || '').split('\n').map((x) => x.replace(/#[\wÀ-ÿ]+/g, '').trim()).find(Boolean) || tit || 'Novo vídeo');
  const base = linha.slice(0, 88).trim() || 'Novo vídeo';
  return (base + ' #Shorts').slice(0, 100);
}

// Envia o vídeo como Short (vertical, até 3 min; o YouTube reconhece pelo formato). Devolve { link }.
async function publicarShort({ db, lojaId, loja, video, legenda, titulo: tit }) {
  if (!temChaves()) throw new Error('YouTube: faltam os segredos YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no GitHub.');
  if (!loja || !loja.youtube || !loja.youtube.ligado) throw new Error('YouTube: o canal desta loja ainda não foi ligado à Central.');
  const c = await acesso(db, lojaId);
  const mime = video.mime || 'video/mp4';
  const desc = limpa(legenda).slice(0, 4800);
  const meta = {
    snippet: { title: titulo(legenda, tit), description: (desc + (/#shorts/i.test(desc) ? '' : '\n\n#Shorts')).trim(), categoryId: '22' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
  };
  const ini = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.access_token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(video.buf.length), 'X-Upload-Content-Type': mime },
    body: JSON.stringify(meta),
  });
  if (!ini.ok) { const t = await ini.text().catch(() => ''); let j = {}; try { j = JSON.parse(t); } catch (_) {} throw erroYT(ini.status, j, t); }
  const url = ini.headers.get('location');
  if (!url) throw new Error('YouTube: não recebi o endereço de envio.');
  let ultimo = '';
  for (let t = 0; t < 3; t++) {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(video.buf.length) }, body: video.buf });
    const txt = await r.text().catch(() => '');
    let j = {}; try { j = JSON.parse(txt); } catch (_) {}
    if (r.ok && j.id) {
      const priv = j.status && j.status.privacyStatus && j.status.privacyStatus !== 'public';
      return { link: 'https://www.youtube.com/shorts/' + j.id, aviso: priv ? 'YouTube: o vídeo ficou ' + j.status.privacyStatus + ' (o Google limita publicações de aplicativos ainda não verificados). Abra o YouTube Studio e torne público, ou peça a verificação do app.' : '' };
    }
    if (r.status < 500 && r.status !== 429) throw erroYT(r.status, j, txt);
    ultimo = `HTTP ${r.status}`;
    await espera(4000);
  }
  throw new Error('YouTube: o envio do vídeo falhou (' + ultimo + ').');
}

module.exports = { trocarCodigos, publicarShort, temChaves, REDIRECT, titulo };
