// TikTok: liga a conta de cada loja (OAuth), renova o acesso e envia o vídeo (rascunho no app do TikTok ou publicação direta).
// Segredos no GitHub: TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET. Os tokens das contas ficam só no Firestore (coleção tiktokContas, que o app não lê).
const API = 'https://open.tiktokapis.com';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const REDIRECT = (process.env.APP_URL || 'https://duraesfotografiax-alt.github.io/CentraDuraes/').replace(/\/?$/, '/') + 'tiktok.html';

const chaves = () => ({ key: process.env.TIKTOK_CLIENT_KEY || '', secret: process.env.TIKTOK_CLIENT_SECRET || '' });
const temChaves = () => { const c = chaves(); return !!(c.key && c.secret); };

const MSG = {
  invalid_param: 'o TikTok recusou os dados enviados',
  access_token_invalid: 'o acesso à conta do TikTok expirou; ligue a conta de novo',
  scope_not_authorized: 'a conta do TikTok não liberou essa permissão; ligue a conta de novo',
  spam_risk_too_many_posts: 'o TikTok atingiu o limite diário de posts dessa conta',
  spam_risk_too_many_pending_share: 'a conta já tem 5 rascunhos esperando no TikTok hoje; publique ou apague alguns no app',
  spam_risk_user_banned_from_posting: 'o TikTok bloqueou essa conta para postar',
  reached_active_user_cap: 'o app do TikTok atingiu o limite diário de contas',
  rate_limit_exceeded: 'o TikTok pediu para esperar um pouco',
  privacy_level_option_mismatch: 'o TikTok não aceitou o tipo de privacidade',
  unaudited_client_can_only_post_to_private_accounts: 'o app do TikTok ainda não foi auditado',
};
function erroTT(status, j) {
  const e = (j && j.error) || {};
  const cod = e.code || '';
  const err = new Error('TikTok: ' + (MSG[cod] || e.message || `respondeu ${status}`) + (cod && cod !== 'ok' && !MSG[cod] ? ` (${cod})` : ''));
  err.codigo = cod;
  return err;
}

async function chamar(caminho, token, corpo, metodo) {
  const r = await fetch(API + caminho, {
    method: metodo || 'POST',
    headers: Object.assign({ Authorization: 'Bearer ' + token }, corpo ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.error && j.error.code && j.error.code !== 'ok')) throw erroTT(r.status, j);
  return j.data || j;
}

async function pedirToken(campos) {
  const c = chaves();
  const r = await fetch(API + '/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams(Object.assign({ client_key: c.key, client_secret: c.secret }, campos)).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('TikTok: ' + (j.error_description || j.error || `respondeu ${r.status}`).toString().slice(0, 200));
  return j;
}
const guardar = (j) => ({
  open_id: j.open_id, access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope || '',
  expiraEm: Date.now() + (Number(j.expires_in) || 86400) * 1000, refreshExpiraEm: Date.now() + (Number(j.refresh_expires_in) || 31536000) * 1000,
});

// Troca os códigos que o cliente autorizou (tiktok.html grava em tiktokAuth) pelos acessos das contas
async function trocarCodigos({ db, usuarios, enviar, ehAdm, agoraIso }) {
  if (!temChaves()) return 0;
  const sn = await db.collection('tiktokAuth').where('status', '==', 'recebido').get();
  let feitos = 0;
  for (const d of sn.docs) {
    const a = d.data();
    try {
      if (!a.loja || !a.code) throw new Error('pedido incompleto');
      const j = await pedirToken({ code: a.code, grant_type: 'authorization_code', redirect_uri: REDIRECT });
      await db.collection('tiktokContas').doc(a.loja).set(guardar(j));
      let nome = '', foto = '';
      try { const u = await chamar('/v2/user/info/?fields=open_id,display_name,avatar_url', j.access_token, null, 'GET'); const us = u.user || u; nome = us.display_name || ''; foto = us.avatar_url || ''; } catch (_) {}
      const lref = db.collection('lojas').doc(a.loja);
      const l = (await lref.get()).data() || {};
      const modo = (l.tiktok && l.tiktok.modo) || 'rascunho';
      await lref.update({ tiktok: { ligado: true, nome, foto, modo, em: agoraIso || '', direto: String(j.scope || '').includes('video.publish') } });
      await d.ref.update({ status: 'ligado', code: '', nome });
      feitos++;
      console.log(`TikTok: conta ligada à loja ${l.nome || a.loja} (${nome || j.open_id})`);
      if (enviar && usuarios) for (const u of usuarios.filter(ehAdm)) await enviar(u, 'TikTok ligado', `${l.nome || 'Loja'}: a conta ${nome || 'do TikTok'} foi ligada à Central.`);
    } catch (e) {
      console.error('TikTok (ligar):', e.message);
      try { await d.ref.update({ status: 'erro', erro: String(e.message).slice(0, 200), code: '' }); } catch (_) {}
    }
  }
  return feitos;
}

// Acesso válido da loja (renova se faltar menos de 10 minutos)
async function acesso(db, lojaId) {
  const ref = db.collection('tiktokContas').doc(lojaId);
  const c = (await ref.get()).data();
  if (!c || !c.access_token) throw new Error('TikTok: a conta desta loja ainda não foi ligada à Central.');
  if (c.expiraEm - Date.now() > 10 * 60e3) return c;
  if (c.refreshExpiraEm && c.refreshExpiraEm < Date.now()) throw new Error('TikTok: o acesso da conta venceu; ligue a conta de novo.');
  const j = await pedirToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token });
  const novo = Object.assign({}, c, guardar(Object.assign({ open_id: c.open_id, scope: c.scope }, j)));
  await ref.set(novo);
  return novo;
}

function partes(tam) {
  if (tam <= 64e6) return { chunk: tam, total: 1 };
  const chunk = 32e6;
  return { chunk, total: Math.floor(tam / chunk) };
}
async function enviarPartes(url, buf, mime) {
  const { chunk, total } = partes(buf.length);
  for (let i = 0; i < total; i++) {
    const ini = i * chunk, fim = i === total - 1 ? buf.length - 1 : ini + chunk - 1;
    let ok = false, ult = '';
    for (let t = 0; t < 3 && !ok; t++) {
      const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': mime || 'video/mp4', 'Content-Range': `bytes ${ini}-${fim}/${buf.length}` }, body: buf.subarray(ini, fim + 1) });
      if (r.status === 206 || r.status === 201 || r.status === 200) ok = true;
      else { ult = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`; if (r.status < 500) break; await espera(3000); }
    }
    if (!ok) throw new Error('TikTok: o envio do vídeo falhou (' + ult + ')');
  }
}
async function esperar(token, id, aceitos) {
  const fim = Date.now() + 6 * 60e3;
  let st = '';
  while (Date.now() < fim) {
    const d = await chamar('/v2/post/publish/status/fetch/', token, { publish_id: id });
    st = d.status || '';
    if (aceitos.includes(st)) return d;
    if (st === 'FAILED') throw new Error('TikTok recusou o vídeo' + (d.fail_reason ? ' (' + d.fail_reason + ')' : '') + '.');
    await espera(5000);
  }
  throw new Error('TikTok demorou demais para processar o vídeo (último estado: ' + (st || 'sem resposta') + ').');
}

async function viaRascunho(token, buf, mime) {
  const { chunk, total } = partes(buf.length);
  const ini = await chamar('/v2/post/publish/inbox/video/init/', token, { source_info: { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: chunk, total_chunk_count: total } });
  await enviarPartes(ini.upload_url, buf, mime);
  await esperar(token, ini.publish_id, ['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE']);
  return { modo: 'rascunho', link: '' };
}
async function viaDireto(token, buf, mime, legenda) {
  const info = await chamar('/v2/post/publish/creator_info/query/', token, {});
  const ops = info.privacy_level_options || [];
  const priv = ops.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : ops[0] || 'SELF_ONLY';
  const { chunk, total } = partes(buf.length);
  const ini = await chamar('/v2/post/publish/video/init/', token, {
    post_info: { title: String(legenda || '').slice(0, 2200), privacy_level: priv, disable_duet: !!info.duet_disabled, disable_stitch: !!info.stitch_disabled, disable_comment: !!info.comment_disabled },
    source_info: { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: chunk, total_chunk_count: total },
  });
  await enviarPartes(ini.upload_url, buf, mime);
  await esperar(token, ini.publish_id, ['PUBLISH_COMPLETE']);
  return { modo: 'direto', privado: priv === 'SELF_ONLY', link: info.creator_username ? 'https://www.tiktok.com/@' + info.creator_username : '' };
}

// Envia o vídeo da loja. Devolve { modo, link, aviso }.
async function publicarVideo({ db, lojaId, loja, video, legenda }) {
  if (!temChaves()) throw new Error('TikTok: faltam os segredos TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET no GitHub.');
  if (!loja || !loja.tiktok || !loja.tiktok.ligado) throw new Error('TikTok: a conta desta loja ainda não foi ligada à Central.');
  const c = await acesso(db, lojaId);
  const mime = video.mime || 'video/mp4';
  const querDireto = loja.tiktok.modo === 'direto';
  if (querDireto && String(c.scope || '').includes('video.publish')) {
    try {
      const r = await viaDireto(c.access_token, video.buf, mime, legenda);
      if (r.privado) r.aviso = 'TikTok: saiu como privado (só a própria conta vê), porque o app do TikTok ainda não passou na auditoria.';
      return r;
    } catch (e) {
      if (e.codigo !== 'unaudited_client_can_only_post_to_private_accounts' && e.codigo !== 'privacy_level_option_mismatch') throw e;
      const r = await viaRascunho(c.access_token, video.buf, mime);
      r.aviso = 'TikTok: o app ainda não pode publicar direto; foi para o rascunho. Abra o TikTok e publique.';
      return r;
    }
  }
  const r = await viaRascunho(c.access_token, video.buf, mime);
  r.aviso = querDireto ? 'TikTok: a conta foi ligada sem permissão de publicar direto; foi para o rascunho. Abra o TikTok e publique.' : 'TikTok: foi para o rascunho do TikTok. Abra o app, toque na notificação e publique.';
  return r;
}

module.exports = { trocarCodigos, publicarVideo, temChaves, REDIRECT };
