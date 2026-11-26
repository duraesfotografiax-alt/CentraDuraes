// Google Agenda <-> Agenda da Central (coleção "tar"), na agenda principal de quem autorizou.
// Central -> Google: cada trabalho com data vira um evento (com horário, ou o dia inteiro); a entrega de edição vira evento de dia inteiro.
// Google -> Central: mudar horário/dia/título/local de um evento criado pela Central atualiza o trabalho; criar um evento novo no Google com o título começando por "Central:" cria o trabalho.
// Usa o mesmo ID/segredo do Google do YouTube (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET). Acessos em agendaContas (que o app não lê).
const crypto = require('crypto');
const TZ = 'America/Sao_Paulo';
const TEAM = ['Thiago', 'Vanessa', 'Lucas'];
const APP = (process.env.APP_URL || 'https://duraesfotografiax-alt.github.io/CentraDuraes/').replace(/\/?$/, '/');
const REDIRECT = APP + 'agenda.html';
const chaves = () => ({ id: process.env.YOUTUBE_CLIENT_ID || '', secret: process.env.YOUTUBE_CLIENT_SECRET || '' });
const temChaves = () => { const c = chaves(); return !!(c.id && c.secret); };
const sha = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);

async function pedirToken(campos) {
  const c = chaves();
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.assign({ client_id: c.id, client_secret: c.secret }, campos)).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error('Google Agenda: ' + (j.error === 'invalid_grant' ? 'o acesso expirou; ligue o Google Agenda de novo' : (j.error_description || j.error || `respondeu ${r.status}`)));
    e.invalido = j.error === 'invalid_grant'; throw e;
  }
  return j;
}
async function g(tk, metodo, caminho, corpo, qs) {
  const r = await fetch('https://www.googleapis.com/calendar/v3' + caminho + (qs ? '?' + new URLSearchParams(qs) : ''), { method: metodo, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('Google Agenda: ' + ((j.error && j.error.message) || r.status)); e.status = r.status; throw e; }
  return j;
}
async function acesso(db) {
  const ref = db.collection('agendaContas').doc('principal');
  const c = (await ref.get()).data();
  if (!c || !c.refresh_token) throw new Error('Google Agenda: ainda não foi ligado.');
  if (c.access_token && c.expiraEm - Date.now() > 5 * 60e3) return c;
  const j = await pedirToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token });
  const novo = Object.assign({}, c, { access_token: j.access_token, expiraEm: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  await ref.set(novo); return novo;
}

// Troca o código que o dono da agenda autorizou (agenda.html grava em agendaAuth) pelo acesso
async function trocarCodigos({ db, usuarios, enviar, ehAdm }) {
  if (!temChaves()) return 0;
  const sn = await db.collection('agendaAuth').where('status', '==', 'recebido').get();
  let n = 0;
  for (const d of sn.docs) {
    const a = d.data();
    try {
      if (!a.code) throw new Error('pedido incompleto');
      const j = await pedirToken({ code: a.code, grant_type: 'authorization_code', redirect_uri: REDIRECT });
      if (!j.refresh_token) throw new Error('o Google não devolveu o acesso permanente; refaça e aceite todas as permissões');
      const cal = await g(j.access_token, 'GET', '/calendars/primary');
      await db.collection('agendaContas').doc('principal').set({ access_token: j.access_token, refresh_token: j.refresh_token, expiraEm: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
      await db.collection('config').doc('agendaGoogle').set({ ligado: true, email: cal.id || '', em: new Date().toISOString(), syncToken: '', erro: '' });
      await d.ref.update({ status: 'ligado', code: '', nome: cal.id || '' });
      n++; console.log('Google Agenda ligado:', cal.id);
      if (enviar) for (const u of usuarios.filter(ehAdm)) await enviar(u, 'Google Agenda ligado', `A agenda ${cal.id || ''} vai receber os trabalhos da Central.`);
    } catch (e) { console.error('Google Agenda (ligar):', e.message); try { await d.ref.update({ status: 'erro', erro: String(e.message).slice(0, 200), code: '' }); } catch (_) {} }
  }
  return n;
}

const addDia = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function addMin(data, hora, min) { const d = new Date(`${data}T${hora}:00Z`); d.setUTCMinutes(d.getUTCMinutes() + min); return d.toISOString().slice(0, 16) + ':00'; }
const lista = (a) => (Array.isArray(a) ? a : []).join(', ');
const LEMB_H = { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }] };
const LEMB_D = { useDefault: false, overrides: [{ method: 'popup', minutes: 900 }] }; // 9h do dia anterior

function montarCap(t) {
  const desc = [t.captacao && t.captacao.length ? 'Captação: ' + lista(t.captacao) : '', t.edicao && t.edicao.length ? 'Edição: ' + lista(t.edicao) : '', t.contato ? 'Contato: ' + t.contato : '', t.obs ? 'Obs: ' + t.obs : '', '—', 'Central Elite & Durães'].filter(Boolean).join('\n');
  const comHora = /^\d\d:\d\d$/.test(t.hora || '');
  return {
    summary: String(t.titulo || 'Trabalho'), location: t.local || '', description: desc,
    start: comHora ? { dateTime: `${t.data}T${t.hora}:00`, timeZone: TZ } : { date: t.data },
    end: comHora ? { dateTime: addMin(t.data, t.hora, 120), timeZone: TZ } : { date: addDia(t.data, 1) },
    extendedProperties: { private: { centralTar: t.id, centralKind: 'cap' } }, reminders: comHora ? LEMB_H : LEMB_D,
  };
}
function montarEnt(t) {
  return {
    summary: 'Entrega: ' + String(t.titulo || 'Trabalho'), location: '', description: ['Entrega da edição', t.edicao && t.edicao.length ? 'Edição: ' + lista(t.edicao) : '', '—', 'Central Elite & Durães'].filter(Boolean).join('\n'),
    start: { date: t.prazo }, end: { date: addDia(t.prazo, 1) },
    extendedProperties: { private: { centralTar: t.id, centralKind: 'ent' } }, reminders: LEMB_D,
  };
}
const hashDes = (ev) => sha({ s: ev.summary, l: ev.location || '', d: ev.description || '', a: ev.start, b: ev.end });
const normT = (x) => (x && x.dateTime ? { t: x.dateTime.slice(0, 16) } : { d: (x && x.date) || '' });
const hashEv = (e) => sha({ s: e.summary || '', l: e.location || '', d: e.description || '', a: normT(e.start), b: normT(e.end) });

async function sincronizar({ db, hoje }) {
  if (!temChaves()) return;
  const cfgRef = db.collection('config').doc('agendaGoogle');
  const cfg = (await cfgRef.get()).data();
  if (!cfg || !cfg.ligado) return;
  let tk;
  try { tk = (await acesso(db)).access_token; }
  catch (e) { await cfgRef.set({ erro: e.message.slice(0, 200), erroEm: new Date().toISOString(), ligado: e.invalido ? false : true }, { merge: true }); throw e; }
  const mapRef = db.collection('agendaContas').doc('mapa');
  const mapa = ((await mapRef.get()).data() || {}).m || {};
  const ontem = addDia(hoje, -1);
  let escritas = 0;
  const MAX = 60;

  // 1) Google -> Central
  let syncToken = cfg.syncToken || '', novoToken = '';
  const lidos = [];
  for (let tent = 0; tent < 2; tent++) {
    lidos.length = 0; let pag = '', paginas = 0;
    try {
      do {
        const qs = { maxResults: '250', showDeleted: 'true', timeZone: TZ };
        if (syncToken) qs.syncToken = syncToken;
        if (pag) qs.pageToken = pag;
        const r = await g(tk, 'GET', '/calendars/primary/events', null, qs);
        lidos.push(...(r.items || [])); pag = r.nextPageToken || ''; novoToken = r.nextSyncToken || novoToken;
      } while (pag && ++paginas < 20);
      break;
    } catch (e) { if (e.status === 410 && syncToken) { syncToken = ''; continue; } throw e; }
  }
  for (const e of lidos) {
    const priv = (e.extendedProperties && e.extendedProperties.private) || {};
    const tid = priv.centralTar, tipo = priv.centralKind === 'ent' ? 'ent' : 'cap';
    if (tid) {
      const m = mapa[tid]; const slot = m && m[tipo];
      if (!slot || slot.id !== e.id) continue;
      if (e.status === 'cancelled') { slot.gone = true; continue; } // apagou no Google: a Central deixa de mexer neste evento
      const eh = hashEv(e); if (eh === slot.eh) continue; // é só o eco do que a Central mandou
      const ref = db.collection('tar').doc(tid), snap = await ref.get();
      if (!snap.exists) continue;
      const t = { id: tid, ...snap.data() }, up = {};
      const sum = String(e.summary || '').trim();
      if (sum) { const novoT = tipo === 'ent' ? sum.replace(/^Entrega:\s*/i, '') : sum; if (novoT && novoT !== t.titulo) up.titulo = novoT.slice(0, 120); }
      const dia = (e.start && (e.start.date || (e.start.dateTime || '').slice(0, 10))) || '';
      if (tipo === 'cap') {
        const hora = e.start && e.start.dateTime ? e.start.dateTime.slice(11, 16) : '';
        if (dia && dia !== t.data) up.data = dia;
        if (hora !== (t.hora || '')) up.hora = hora;
        if ((e.location || '') !== (t.local || '')) up.local = String(e.location || '').slice(0, 200);
      } else if (dia && dia !== t.prazo) up.prazo = dia;
      if (Object.keys(up).length) { await ref.update(up); Object.assign(t, up); console.log(`Google Agenda: "${t.titulo}" atualizado pela agenda do Google (${Object.keys(up).join(', ')})`); }
      slot.eh = eh; slot.h = hashDes(tipo === 'ent' ? montarEnt(t) : montarCap(t)); slot.d = tipo === 'ent' ? t.prazo : t.data;
    } else {
      if (e.status === 'cancelled' || e.recurrence || !/^\s*central\s*:/i.test(e.summary || '')) continue;
      const dia = (e.start && (e.start.date || (e.start.dateTime || '').slice(0, 10))) || '';
      if (!dia || dia < ontem) continue;
      const titulo = e.summary.replace(/^\s*central\s*:\s*/i, '').trim().slice(0, 120) || 'Trabalho';
      const hora = e.start.dateTime ? e.start.dateTime.slice(11, 16) : '';
      const doc = { titulo, tipo: 'outro', empresa: 'duraes', data: dia, hora, local: String(e.location || '').slice(0, 200), captacao: TEAM.slice(), edicao: [], prazo: '', etapa: 'agendado', obs: 'Criado pelo Google Agenda', midia: '', album: '', loja: '', drive: '', contato: '', entregaStatus: '', prontoEm: '', enviadoEm: '' };
      const ref = db.collection('tar').doc(); await ref.set(doc);
      const t = { id: ref.id, ...doc };
      const des = montarCap(t);
      const novo = await g(tk, 'PATCH', '/calendars/primary/events/' + encodeURIComponent(e.id), des); escritas++;
      mapa[t.id] = { cap: { id: e.id, h: hashDes(des), eh: hashEv(novo), d: dia } };
      console.log(`Google Agenda: criei o trabalho "${titulo}" a partir do Google Agenda`);
    }
  }

  // 2) Central -> Google
  const docs = new Map();
  for (const campo of ['data', 'prazo']) { const sn = await db.collection('tar').where(campo, '>=', ontem).get(); for (const d of sn.docs) docs.set(d.id, { id: d.id, ...d.data() }); }
  const sincSlot = async (t, m, tipo, des) => {
    if (escritas >= MAX) return;
    const slot = m[tipo];
    if (slot && slot.gone) return;
    if (!des) { if (slot && slot.id) { try { await g(tk, 'DELETE', '/calendars/primary/events/' + encodeURIComponent(slot.id)); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; } escritas++; } m[tipo] = null; return; }
    const h = hashDes(des), d = tipo === 'ent' ? t.prazo : t.data;
    if (!slot || !slot.id) { const r = await g(tk, 'POST', '/calendars/primary/events', des); escritas++; m[tipo] = { id: r.id, h, eh: hashEv(r), d }; return; }
    if (slot.h !== h) {
      try { const r = await g(tk, 'PUT', '/calendars/primary/events/' + encodeURIComponent(slot.id), des); escritas++; m[tipo] = { id: slot.id, h, eh: hashEv(r), d }; }
      catch (e) { if (e.status === 404 || e.status === 410) { const r = await g(tk, 'POST', '/calendars/primary/events', des); escritas++; m[tipo] = { id: r.id, h, eh: hashEv(r), d }; } else throw e; }
    } else if (slot.d !== d) slot.d = d;
  };
  for (const t of docs.values()) {
    const m = mapa[t.id] || (mapa[t.id] = {});
    await sincSlot(t, m, 'cap', t.data ? montarCap(t) : null);
    await sincSlot(t, m, 'ent', t.prazo && !['entregue', 'agendar'].includes(t.etapa) ? montarEnt(t) : null);
  }
  // trabalho apagado na Central: tira os eventos do Google
  for (const [tid, m] of Object.entries(mapa)) {
    if (docs.has(tid) || escritas >= MAX) continue;
    const d = [m.cap && m.cap.d, m.ent && m.ent.d].filter(Boolean).sort().pop() || '';
    if (!d || d < ontem) continue; // evento antigo: deixa quieto
    if ((await db.collection('tar').doc(tid).get()).exists) continue;
    for (const k of ['cap', 'ent']) if (m[k] && m[k].id && !m[k].gone) { try { await g(tk, 'DELETE', '/calendars/primary/events/' + encodeURIComponent(m[k].id)); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; } escritas++; }
    delete mapa[tid];
  }
  // não deixa o mapa crescer para sempre: esquece eventos de mais de 60 dias
  const corte = addDia(hoje, -60);
  for (const [tid, m] of Object.entries(mapa)) { const d = [m.cap && m.cap.d, m.ent && m.ent.d].filter(Boolean).sort().pop() || ''; if (d && d < corte) delete mapa[tid]; }
  await mapRef.set({ m: mapa });
  await cfgRef.set({ syncToken: novoToken || cfg.syncToken || '', ultima: new Date().toISOString(), erro: '', erroEm: '' }, { merge: true });
  if (escritas) console.log(`Google Agenda: ${escritas} evento(s) atualizado(s)`);
}

module.exports = { trocarCodigos, sincronizar, temChaves, REDIRECT };
