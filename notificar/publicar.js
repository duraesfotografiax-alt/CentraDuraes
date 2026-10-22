// Postagens: publica no Instagram e no Facebook dos clientes na hora marcada na Central.
// Também mantém a lista de Páginas/Instagrams liberados para o usuário do sistema "Central"
// e os últimos posts de cada Instagram (para mostrar na aba Clientes).
//
// Precisa da chave META_TOKEN (usuário do sistema) com as permissões:
//   pages_show_list, pages_read_engagement, pages_manage_posts,
//   instagram_basic, instagram_content_publish, business_management (+ ads_read do Tráfego).
const VERSAO = process.env.META_API_VERSION || 'v22.0';
const G = `https://graph.facebook.com/${VERSAO}`;
const GV = `https://graph-video.facebook.com/${VERSAO}`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function erroMeta(j, status) {
  const e = (j && j.error) || {};
  const m = e.error_user_msg || e.message || `Meta respondeu ${status}`;
  return new Error(m.replace(/\s+/g, ' ').slice(0, 300));
}
async function gget(caminho, token) {
  const r = await fetch(`${G}/${caminho}${caminho.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw erroMeta(j, r.status);
  return j;
}
async function gpost(url, campos, token) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  body.append('access_token', token);
  const r = await fetch(url.startsWith('http') ? url : `${G}/${url}`, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw erroMeta(j, r.status);
  return j;
}
async function gpostArquivo(url, campos, arquivo, token) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) fd.append(k, String(v));
  fd.append('access_token', token);
  fd.append('source', new Blob([arquivo.buf], { type: arquivo.mime }), arquivo.nome || 'arquivo');
  const r = await fetch(url, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw erroMeta(j, r.status);
  return j;
}

// ---------- Drive ----------
const urlDrive = (id) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
async function baixar(a) {
  const r = await fetch(urlDrive(a.id), { redirect: 'follow' });
  const tipo = r.headers.get('content-type') || '';
  if (!r.ok || /text\/html/.test(tipo)) throw new Error(`Não consegui baixar "${a.nome}" do Drive. O arquivo precisa estar com "Qualquer pessoa com o link".`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = /^(image|video)\//.test(a.mime || '') ? a.mime : tipo.split(';')[0];
  return { buf, mime, nome: a.nome || 'arquivo', video: /^video\//.test(mime) };
}
async function paraJpeg(arq) {
  const sharp = require('sharp');
  const buf = await sharp(arq.buf).rotate().resize({ width: 1440, height: 1800, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  return { buf, mime: 'image/jpeg', nome: arq.nome.replace(/\.\w+$/, '') + '.jpg', video: false };
}

// ---------- Conversão de vídeo (quando o Facebook/Instagram recusam o formato) ----------
const FORMATO_RECUSADO = /formato|format|compat|codec|unsupported|n[aã]o suportad|invalid video|v[ií]deo inv[aá]lido|2207|1363|processing\s*failed|process.*fail|n[aã]o conseguiu processar|recusou o envio do v[ií]deo|demorou demais para processar/i;
async function transcodificar(a) { // converte para MP4 H.264 + AAC, 30 fps, proporção par: aceito em qualquer lugar
  const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
  let bin = 'ffmpeg'; try { bin = require('ffmpeg-static') || 'ffmpeg'; } catch (_) {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-')), ent = path.join(dir, 'entrada'), sai = path.join(dir, 'saida.mp4');
  try {
    fs.writeFileSync(ent, a.buf);
    await new Promise((ok, no) => {
      const pr = spawn(bin, ['-y', '-i', ent, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-vf', "scale='min(1080,iw)':-2", '-r', '30', '-profile:v', 'high', '-level', '4.1', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', sai], { stdio: 'ignore' });
      const t = setTimeout(() => { pr.kill('SIGKILL'); no(new Error('A conversão do vídeo demorou demais.')); }, 8 * 60e3);
      pr.on('error', (e) => { clearTimeout(t); no(new Error('Não consegui converter o vídeo: ' + e.message)); });
      pr.on('close', (c) => { clearTimeout(t); c === 0 ? ok() : no(new Error('Não consegui converter o vídeo (ffmpeg ' + c + ').')); });
    });
    const buf = fs.readFileSync(sai);
    console.log(`Postagens: vídeo convertido (${Math.round(a.buf.length / 1e6)} MB → ${Math.round(buf.length / 1e6)} MB)`);
    return { buf, mime: 'video/mp4', nome: String(a.nome || 'video').replace(/\.\w+$/, '') + '.mp4', video: true, convertido: true };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

// ---------- Facebook ----------
async function fotoOculta(pag, jpg) { // sobe a foto na Página sem publicar e devolve id + endereço público (usado pelo Instagram)
  const r = await gpostArquivo(`${G}/${pag.id}/photos`, { published: 'false', temporary: 'true' }, jpg, pag.token);
  const info = await gget(`${r.id}?fields=images`, pag.token);
  const url = info.images && info.images[0] && info.images[0].source;
  return { id: r.id, url };
}
async function fbEsperarReel(pag, id) { // o Facebook processa depois do envio: espera dizer se aceitou ou recusou
  const fim = Date.now() + 5 * 60e3;
  while (Date.now() < fim) {
    let st = {};
    try { st = (await gget(`${id}?fields=status`, pag.token)).status || {}; } catch (_) { return; }
    for (const k of ['uploading_phase', 'processing_phase', 'publishing_phase']) {
      if (st[k] && st[k].status === 'error') throw new Error((st[k].errors && st[k].errors[0] && st[k].errors[0].message) || 'O vídeo não foi aceito pelo Facebook (formato não compatível).');
    }
    if (st.video_status === 'error') throw new Error('O vídeo não foi aceito pelo Facebook (formato não compatível).');
    if (st.video_status === 'ready' || (st.publishing_phase && st.publishing_phase.status === 'complete')) return;
    await espera(6000);
  }
}
async function fbReel(pag, a, legenda) { // jeito oficial de publicar Reels em Página
  const ini = await gpost(`${pag.id}/video_reels`, { upload_phase: 'start' }, pag.token);
  const up = await fetch(ini.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${pag.token}`, offset: '0', file_size: String(a.buf.length) }, body: a.buf });
  if (!up.ok) { const t = await up.text().catch(() => ''); throw new Error('Facebook recusou o envio do Reels. ' + t.slice(0, 150)); }
  await gpost(`${pag.id}/video_reels`, { upload_phase: 'finish', video_id: ini.video_id, video_state: 'PUBLISHED', description: legenda }, pag.token);
  await fbEsperarReel(pag, ini.video_id);
  return { id: ini.video_id, link: `https://www.facebook.com/reel/${ini.video_id}` };
}
async function fbPublicar(pag, tipo, arqs, legenda) {
  if (tipo === 'stories') {
    const a = arqs[0];
    if (a.video) {
      const ini = await gpost(`${pag.id}/video_stories`, { upload_phase: 'start' }, pag.token);
      const up = await fetch(ini.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${pag.token}`, file_size: String(a.buf.length) }, body: a.buf });
      if (!up.ok) throw new Error('Facebook recusou o vídeo do story.');
      const fim = await gpost(`${pag.id}/video_stories`, { upload_phase: 'finish', video_id: ini.video_id }, pag.token);
      return { id: fim.post_id || ini.video_id, link: `https://www.facebook.com/${pag.id}` };
    }
    const f = await fotoOculta(pag, a.jpg);
    const r = await gpost(`${pag.id}/photo_stories`, { photo_id: f.id }, pag.token);
    return { id: r.post_id || f.id, link: `https://www.facebook.com/${pag.id}` };
  }
  if (arqs.length === 1 && arqs[0].video && tipo === 'reels') {
    try { return await fbReel(pag, arqs[0], legenda); }
    catch (e) { console.error('Facebook Reels (API de reels) falhou, tentando como vídeo comum: ' + e.message); if (FORMATO_RECUSADO.test(e.message)) throw e; }
  }
  if (arqs.length === 1 && arqs[0].video) {
    const r = await gpostArquivo(`${GV}/${pag.id}/videos`, { description: legenda, published: 'true' }, arqs[0], pag.token);
    return { id: r.id, link: `https://www.facebook.com/${pag.id}/videos/${r.id}` };
  }
  if (arqs.length === 1) {
    const r = await gpostArquivo(`${G}/${pag.id}/photos`, { message: legenda, published: 'true' }, arqs[0].jpg, pag.token);
    const pid = r.post_id || r.id;
    let link = `https://www.facebook.com/${pid}`;
    try { link = (await gget(`${pid}?fields=permalink_url`, pag.token)).permalink_url || link; } catch (_) {}
    return { id: pid, link };
  }
  const ids = [];
  for (const a of arqs) {
    if (a.video) throw new Error('No Facebook, o carrossel com vídeo não é suportado pela Central. Use só fotos.');
    ids.push((await fotoOculta(pag, a.jpg)).id);
  }
  const campos = { message: legenda };
  ids.forEach((id, i) => { campos[`attached_media[${i}]`] = { media_fbid: id }; });
  const r = await gpost(`${pag.id}/feed`, campos, pag.token);
  let link = `https://www.facebook.com/${r.id}`;
  try { link = (await gget(`${r.id}?fields=permalink_url`, pag.token)).permalink_url || link; } catch (_) {}
  return { id: r.id, link };
}

// ---------- Instagram ----------
async function esperarPronto(container, token, maxMin = 12) {
  const fim = Date.now() + maxMin * 60e3;
  while (Date.now() < fim) {
    const s = await gget(`${container}?fields=status_code,status`, token);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram não aceitou o arquivo: ${s.status || s.status_code}`);
    await espera(8000);
  }
  throw new Error('O Instagram demorou demais para processar o vídeo. Tente de novo.');
}
async function igVideo(pag, tipoMidia, a, extra) {
  const c = await gpost(`${pag.ig}/media`, Object.assign({ media_type: tipoMidia, upload_type: 'resumable' }, extra), pag.token);
  const up = await fetch(c.uri || `https://rupload.facebook.com/ig-api-upload/${VERSAO}/${c.id}`, { method: 'POST', headers: { Authorization: `OAuth ${pag.token}`, offset: '0', file_size: String(a.buf.length) }, body: a.buf });
  if (!up.ok) { const t = await up.text().catch(() => ''); throw new Error('Instagram recusou o envio do vídeo. ' + t.slice(0, 150)); }
  await esperarPronto(c.id, pag.token);
  return c.id;
}
const lista = (x) => (Array.isArray(x) ? x : String(x || '').split(/[,\s]+/)).map((u) => String(u).trim().replace(/^@/, '')).filter(Boolean).slice(0, 3);
// Convite de colaborador e marcação de pessoas. Se o Instagram recusar (conta não aceita convite, usuário inexistente...), publica sem eles e avisa.
async function igPublicar(pag, tipo, arqs, legenda, ex) {
  const colab = lista(ex && ex.colab), marcar = lista(ex && ex.marcar);
  if (tipo === 'stories' || (!colab.length && !marcar.length)) return igPublicarBase(pag, tipo, arqs, legenda, {});
  try { return await igPublicarBase(pag, tipo, arqs, legenda, { colab, marcar }); }
  catch (e) {
    if (!/colab|collaborat|user_tag|tag|username|usu[aá]rio|invit|convit/i.test(e.message || '')) throw e;
    console.log('Postagens: Instagram recusou colaborador/marcação (' + String(e.message).slice(0, 120) + '), publicando sem eles');
    const r = await igPublicarBase(pag, tipo, arqs, legenda, {});
    r.aviso = 'Saiu sem colaborador/marcação: ' + String(e.message).slice(0, 120);
    return r;
  }
}
async function igPublicarBase(pag, tipo, arqs, legenda, ex) {
  const colabP = ex.colab && ex.colab.length ? { collaborators: JSON.stringify(ex.colab) } : {};
  const tagsP = ex.marcar && ex.marcar.length ? { user_tags: JSON.stringify(ex.marcar.map((u) => ({ username: u, x: 0.5, y: 0.5 }))) } : {};
  let container;
  if (tipo === 'stories') {
    const a = arqs[0];
    if (a.video) container = await igVideo(pag, 'STORIES', a, {});
    else { const f = await fotoOculta(pag, a.jpg); container = (await gpost(`${pag.ig}/media`, { media_type: 'STORIES', image_url: f.url }, pag.token)).id; await esperarPronto(container, pag.token, 3); }
  } else if (arqs.length === 1) {
    const a = arqs[0];
    if (a.video) container = await igVideo(pag, 'REELS', a, Object.assign({ caption: legenda, share_to_feed: 'true' }, colabP));
    else { const f = await fotoOculta(pag, a.jpg); container = (await gpost(`${pag.ig}/media`, Object.assign({ image_url: f.url, caption: legenda }, colabP, tagsP), pag.token)).id; await esperarPronto(container, pag.token, 3); }
  } else {
    const filhos = [];
    for (const a of arqs) {
      if (a.video) filhos.push(await igVideo(pag, 'VIDEO', a, { is_carousel_item: 'true' }));
      else { const f = await fotoOculta(pag, a.jpg); const id = (await gpost(`${pag.ig}/media`, Object.assign({ image_url: f.url, is_carousel_item: 'true' }, tagsP), pag.token)).id; await esperarPronto(id, pag.token, 3); filhos.push(id); }
    }
    container = (await gpost(`${pag.ig}/media`, Object.assign({ media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda }, colabP), pag.token)).id;
    await esperarPronto(container, pag.token, 5);
  }
  const pub = await gpost(`${pag.ig}/media_publish`, { creation_id: container }, pag.token);
  let link = '';
  try { link = (await gget(`${pub.id}?fields=permalink`, pag.token)).permalink || ''; } catch (_) {}
  return { id: pub.id, link };
}

// ---------- Páginas liberadas para o usuário do sistema ----------
async function paginas(token) {
  const out = [];
  let j = await gget('me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url,followers_count}&limit=100', token);
  for (;;) {
    for (const p of j.data || []) {
      const ig = p.instagram_business_account || null;
      out.push({ id: p.id, nome: p.name, token: p.access_token, foto: (p.picture && p.picture.data && p.picture.data.url) || '', ig: ig ? ig.id : '', igUser: ig ? ig.username || '' : '', igFoto: ig ? ig.profile_picture_url || '' : '', seguidores: ig ? ig.followers_count || 0 : 0 });
    }
    if (!(j.paging && j.paging.next)) break;
    const r = await fetch(j.paging.next); j = await r.json();
  }
  return out;
}

// Lista de páginas + últimos posts do Instagram (roda de hora em hora, junto com o Tráfego)
async function sincronizarPaginas({ db, agoraIso }) {
  const token = process.env.META_TOKEN;
  if (!token) return;
  let ps = [];
  try { ps = await paginas(token); }
  catch (e) { console.error('Postagens: ' + e.message); await db.collection('metaPaginas').doc('lista').set({ paginas: [], erro: e.message.slice(0, 200), atualizadoEm: agoraIso }); return; }
  console.log(`Postagens: ${ps.length} página(s), ${ps.filter((p) => p.ig).length} com Instagram`);
  await db.collection('metaPaginas').doc('lista').set({ paginas: ps.map(({ token: _t, ...p }) => p), erro: '', atualizadoEm: agoraIso });
  for (const p of ps.filter((x) => x.ig)) {
    try {
      const m = await gget(`${p.ig}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=12`, p.token);
      await db.collection('metaIG').doc(p.ig).set({ user: p.igUser, foto: p.igFoto, seguidores: p.seguidores, pagina: p.id, atualizadoEm: agoraIso, erro: '',
        posts: (m.data || []).map((x) => ({ id: x.id, tipo: x.media_product_type === 'REELS' ? 'reels' : x.media_type === 'CAROUSEL_ALBUM' ? 'carrossel' : x.media_type === 'VIDEO' ? 'video' : 'foto', img: x.thumbnail_url || x.media_url || '', link: x.permalink || '', quando: x.timestamp || '', legenda: String(x.caption || '').slice(0, 140), curtidas: x.like_count || 0, coment: x.comments_count || 0 })) });
    } catch (e) { await db.collection('metaIG').doc(p.ig).set({ user: p.igUser, foto: p.igFoto, pagina: p.id, atualizadoEm: agoraIso, erro: e.message.slice(0, 200) }, { merge: true }); }
  }
}

// ---------- Publicação dos posts agendados ----------
async function publicarAgendados({ db, usuarios, enviar, ehAdm, membroDe, agoraIso }) {
  const token = process.env.META_TOKEN;
  const ref = db.collection('posts');
  const snap = await ref.where('pubStatus', 'in', ['aguardando', 'publicando']).get();
  const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // destrava publicação que ficou presa (robô caiu no meio)
  for (const p of todos.filter((x) => x.pubStatus === 'publicando' && x.pubInicio && (Date.now() - new Date(x.pubInicio).getTime()) > 40 * 60e3)) {
    await ref.doc(p.id).update({ pubStatus: 'erro', pubErro: 'A publicação foi interrompida. Toque em "Tentar de novo".' });
  }
  const vez = todos.filter((p) => p.pubStatus === 'aguardando' && p.quando && p.quando <= agoraIso).sort((a, b) => a.quando.localeCompare(b.quando));
  if (!vez.length) return;
  if (!token) { console.error('Postagens: falta META_TOKEN'); return; }
  const lojas = Object.fromEntries((await db.collection('lojas').get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  let pags;
  try { pags = await paginas(token); } catch (e) { for (const p of vez) await ref.doc(p.id).update({ pubStatus: 'erro', pubErro: 'Meta: ' + e.message }); return; }

  // até 3 posts ao mesmo tempo: um vídeo demorado no Instagram não segura os outros da fila
  const fila = vez.slice(0, 9);
  const processar = async (p) => {
    // trava para não publicar duas vezes
    const ok = await db.runTransaction(async (tx) => { const d = await tx.get(ref.doc(p.id)); if (!d.exists || d.data().pubStatus !== 'aguardando') return false; tx.update(ref.doc(p.id), { pubStatus: 'publicando', pubInicio: new Date().toISOString() }); return true; });
    if (!ok) return;
    const lj = lojas[p.loja] || {};
    const pag = pags.find((x) => x.id === lj.fbPage) || pags.find((x) => lj.igId && x.ig === lj.igId) || pags.find((x) => x.igUser && lj.instagram && x.igUser.toLowerCase() === String(lj.instagram).replace(/^@/, '').toLowerCase());
    const feito = Object.assign({}, p.pubFeito || {});
    const erros = []; let aviso = '';
    if (Array.isArray(p.fila) && p.fila.length > 1) { await publicarSerie({ ref, p, lj, pag, feito, usuarios, enviar, ehAdm, membroDe, agoraIso }); return; }
    try {
      if (!pag) throw new Error(`A loja ${lj.nome || ''} não está ligada a uma Página/Instagram liberado para a Central.`);
      const arqs = [];
      for (const a of p.arquivos || []) { const x = await baixar(a); if (!x.video) x.jpg = await paraJpeg(x); arqs.push(x); }
      if (!arqs.length) throw new Error('Nenhum arquivo escolhido para publicar.');
      const legenda = String(p.legenda || '').slice(0, 2200);
      for (let tent = 0; tent < 2; tent++) {
        erros.length = 0;
        if (p.pubIG && !feito.ig) {
          try { if (!pag.ig) throw new Error('essa Página não tem Instagram comercial ligado'); const r = await igPublicar(pag, p.tipo, arqs, legenda, { colab: p.colab, marcar: p.marcar }); if (r.aviso) aviso = r.aviso; feito.ig = r.link || `https://www.instagram.com/${pag.igUser}/`; }
          catch (e) { erros.push('Instagram: ' + e.message); }
        }
        if (p.pubFB && !feito.fb) {
          try { const r = await fbPublicar(pag, p.tipo, arqs, legenda); feito.fb = r.link; }
          catch (e) { erros.push('Facebook: ' + e.message); }
        }
        // formato de vídeo recusado: converte para H.264/AAC (que todos aceitam) e tenta de novo só o que faltou
        if (!erros.length || tent === 1 || !erros.some((m) => FORMATO_RECUSADO.test(m)) || !arqs.some((a) => a.video && !a.convertido)) break;
        console.log(`Postagens: ${lj.nome} · ${p.titulo}: formato recusado, convertendo o vídeo e tentando de novo`);
        try { for (let i = 0; i < arqs.length; i++) if (arqs[i].video) arqs[i] = await transcodificar(arqs[i]); }
        catch (e) { erros.push(e.message); break; }
      }
    } catch (e) { erros.push(e.message); }

    const onde = [feito.ig && 'Instagram', feito.fb && 'Facebook'].filter(Boolean).join(' e ');
    const para = [...new Set([...usuarios.filter((u) => membroDe(u) === (lj.postagem || 'Vanessa')), ...usuarios.filter(ehAdm)])];
    if (!erros.length) {
      await ref.doc(p.id).update({ pubStatus: 'publicado', pubFeito: feito, pubErro: '', pubAviso: aviso, status: 'publicado', publicadoEm: agoraIso, link: feito.ig || feito.fb || p.link || '', verificado: true });
      console.log(`Postagens: publicado ${lj.nome} · ${p.titulo} (${onde})`);
      for (const u of para) await enviar(u, `Publicado: ${lj.nome || 'cliente'}`, `${p.titulo} saiu no ${onde}.`);
    } else {
      await ref.doc(p.id).update({ pubStatus: 'erro', pubFeito: feito, pubErro: erros.join(' · ').slice(0, 500) });
      console.error(`Postagens: erro ${lj.nome} · ${p.titulo}: ${erros.join(' · ')}`);
      for (const u of para) await enviar(u, `Não consegui publicar: ${lj.nome || 'cliente'}`, `${p.titulo}${onde ? ' (saiu só no ' + onde + ')' : ''}. ${erros[0]}`.slice(0, 230));
    }
  };
  const trabalhadores = Array.from({ length: Math.min(3, fila.length) }, async () => {
    while (fila.length) {
      const p = fila.shift();
      try { await processar(p); }
      catch (e) { console.error('Postagens: falha inesperada em', p.titulo, e.message); try { await ref.doc(p.id).update({ pubStatus: 'erro', pubErro: ('Falha inesperada: ' + e.message).slice(0, 300) }); } catch (_) {} }
    }
  });
  await Promise.all(trabalhadores);
}

const nomeItem = (t) => (t === 'reels' ? 'Reels' : t === 'feed' ? 'Post' : 'Story');
// Série (stories, reels ou fotos): solta só os que já chegaram na hora, um de cada vez
async function publicarSerie({ ref, p, lj, pag, feito, usuarios, enviar, ehAdm, membroDe, agoraIso }) {
  const fila = p.fila.map((x) => Object.assign({}, x));
  const falta = (x) => (p.pubIG && !x.ig) || (p.pubFB && !x.fb);
  const erros = [];
  let soltos = 0;
  try {
    if (!pag) throw new Error(`A loja ${lj.nome || ''} não está ligada a uma Página/Instagram liberado para a Central.`);
    for (const it of fila.filter((x) => falta(x) && x.quando <= agoraIso).sort((a, b) => a.quando.localeCompare(b.quando)).slice(0, 5)) {
      const a = (p.arquivos || [])[it.i];
      if (!a) { it.ig = it.ig || '-'; it.fb = it.fb || '-'; continue; }
      let x = await baixar(a); if (!x.video) x.jpg = await paraJpeg(x);
      const n = it.i + 1;
      const tipo = p.tipo === 'reels' || p.tipo === 'feed' ? p.tipo : 'stories';
      const leg = tipo === 'stories' ? '' : String(it.legenda || p.legenda || '').slice(0, 2200);
      const comConversao = async (fn) => { // se recusarem o formato do vídeo, converte e tenta mais uma vez
        try { return await fn(x); }
        catch (e) { if (x.video && !x.convertido && FORMATO_RECUSADO.test(e.message)) { x = await transcodificar(x); return await fn(x); } throw e; }
      };
      if (p.pubIG && !it.ig) {
        try { if (!pag.ig) throw new Error('essa Página não tem Instagram comercial ligado'); const r = await comConversao((v) => igPublicar(pag, tipo, [v], leg, { colab: p.colab, marcar: p.marcar })); it.ig = r.link || `https://www.instagram.com/${pag.igUser}/`; feito.ig = it.ig; }
        catch (e) { erros.push(`${nomeItem(p.tipo)} ${n} no Instagram: ${e.message}`); }
      }
      if (p.pubFB && !it.fb) {
        try { const r = await comConversao((v) => fbPublicar(pag, tipo, [v], leg)); it.fb = r.link || '-'; feito.fb = r.link || feito.fb || ''; }
        catch (e) { erros.push(`${nomeItem(p.tipo)} ${n} no Facebook: ${e.message}`); }
      }
      if (erros.length) break;
      soltos++;
    }
  } catch (e) { erros.push(e.message); }
  const pend = fila.filter(falta);
  const para = [...new Set([...usuarios.filter((u) => membroDe(u) === (lj.postagem || 'Vanessa')), ...usuarios.filter(ehAdm)])];
  if (erros.length) {
    await ref.doc(p.id).update({ pubStatus: 'erro', fila, pubFeito: feito, pubErro: erros.join(' · ').slice(0, 500) });
    console.error(`Postagens: erro série ${lj.nome} · ${p.titulo}: ${erros.join(' · ')}`);
    for (const u of para) await enviar(u, `Não consegui publicar: ${lj.nome || 'cliente'}`, `${p.titulo}. ${erros[0]}`.slice(0, 230));
  } else if (pend.length) {
    await ref.doc(p.id).update({ pubStatus: 'aguardando', fila, pubFeito: feito, pubErro: '', quando: pend.map((x) => x.quando).sort()[0] });
    console.log(`Postagens: série ${lj.nome} · ${p.titulo}: +${soltos}, faltam ${pend.length}`);
  } else {
    await ref.doc(p.id).update({ pubStatus: 'publicado', fila, pubFeito: feito, pubErro: '', status: 'publicado', publicadoEm: agoraIso, quando: fila[fila.length - 1].quando, link: feito.ig || feito.fb || '', verificado: true });
    console.log(`Postagens: série completa ${lj.nome} · ${p.titulo}`);
    for (const u of para) await enviar(u, `Publicado: ${lj.nome || 'cliente'}`, `Os ${fila.length} ${p.tipo === 'reels' ? 'reels' : p.tipo === 'feed' ? 'posts' : 'stories'} de ${p.titulo} saíram.`);
  }
}

module.exports = { sincronizarPaginas, publicarAgendados, transcodificar };
