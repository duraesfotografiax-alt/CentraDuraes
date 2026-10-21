// Robô de notificações da Central Elite & Durães.
// Roda de hora em hora no GitHub Actions e manda avisos para quem ativou as notificações:
//  - Resumo do dia (a partir das 8h): captações de hoje e amanhã, entregas próximas e atrasos.
//  - "Daqui a pouco": cerca de 2 horas antes de cada captação com horário.
//  - "Edição atrasada": no dia em que o prazo de entrega estoura.
const admin = require('firebase-admin');

const TZ = 'America/Sao_Paulo';
const APP_URL = process.env.APP_URL || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const MODO = (process.env.MODO || 'auto').trim();
const TEAM = ['Thiago', 'Vanessa', 'Lucas'];
const TIPOS = { loja: 'Produção em loja', social: 'Conteúdo / redes', casamento: 'Casamento', evento: 'Evento', aniversario: 'Aniversário', ensaio: 'Ensaio', outro: 'Outro' };

if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.error('Falta o segredo FIREBASE_SERVICE_ACCOUNT no GitHub.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

function agora() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { data: `${g('year')}-${g('month')}-${g('day')}`, min: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}
function addDias(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dm(s) { const [, m, d] = s.split('-'); return `${d}/${m}`; }
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const membroDe = (u) => (TEAM.includes(u.membro) ? u.membro : TEAM.find((p) => p.toLowerCase() === String(u.nome || '').trim().split(/\s+/)[0].toLowerCase()) || '');
const ehAdm = (u) => u.papel === 'adm' || String(u.email || '').toLowerCase() === ADMIN_EMAIL;

async function jaFoi(id) { return (await db.collection('avisos').doc(id).get()).exists; }
async function marcar(id) { await db.collection('avisos').doc(id).set({ em: new Date().toISOString() }); }

async function enviar(u, title, body) {
  const tokens = arr(u.tokens);
  if (!tokens.length) return 0;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: { notification: { icon: APP_URL + 'icons/icon-192.png', badge: APP_URL + 'icons/icon-192.png' }, fcmOptions: { link: APP_URL } },
  });
  const ruins = [];
  res.responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token' || c === 'messaging/invalid-argument') ruins.push(tokens[i]);
  });
  if (ruins.length) await db.collection('usuarios').doc(u.id).update({ tokens: admin.firestore.FieldValue.arrayRemove(...ruins) });
  console.log(`→ ${u.nome || u.email}: "${title}" (${res.successCount}/${tokens.length})`);
  return res.successCount;
}

const INICIO = Date.now();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const batimento = () => db.collection('config').doc('robo').set({ vivoEm: new Date().toISOString() }, { merge: true }).catch(() => {});
const agoraIsoFn = () => { const a = agora(); return `${a.data}T${String(Math.floor(a.min / 60)).padStart(2, '0')}:${String(a.min % 60).padStart(2, '0')}`; };
const noHorario = () => agora().min >= 5 * 60; // das 5h à meia-noite (Brasília) o robô fica de plantão
async function carregarUsuarios() {
  return (await db.collection('usuarios').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.ativo === true || String(u.email || '').toLowerCase() === ADMIN_EMAIL);
}

async function rodada() {
  await batimento();
  const { data: hoje, min } = agora();
  const amanha = addDias(hoje, 1), em2 = addDias(hoje, 2);
  const usuarios = (await db.collection('usuarios').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.ativo === true || String(u.email || '').toLowerCase() === ADMIN_EMAIL);
  console.log(`Agora: ${hoje} ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')} · ${usuarios.length} usuário(s) · ${usuarios.filter((u) => arr(u.tokens).length).length} com notificação`);

  if (MODO === 'teste') {
    for (const u of usuarios) await enviar(u, 'Central Elite & Durães', 'Teste: as notificações estão funcionando!');
    return;
  }

  const agoraIso0 = `${hoje}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  // Postagens primeiro: o que está na hora sai antes de qualquer outra tarefa (tráfego, notificações...)
  const pub = require('./publicar');
  try { await pub.publicarAgendados({ db, usuarios, enviar, ehAdm, membroDe, agoraIso: agoraIso0 }); } catch (e) { console.error('Postagens:', e.message); }
  // Posts que o cliente aprovou entram sozinhos na fila (lojas com "Agendar sozinho ao aprovar" ligado)
  try { await require('./autoagenda')({ db, agoraIso: agoraIso0, enviar, usuarios, ehAdm, membroDe }); } catch (e) { console.error('Aprovados:', e.message); }
  // Tráfego pago (Meta) e lista de Páginas/Instagram: uma vez por hora (ou quando rodar manualmente no modo "meta"/"paginas")
  const horaChave = agoraIso0.slice(0, 13);
  const roboDoc = ((await db.collection('config').doc('robo').get()).data()) || {};
  const fazHora = MODO === 'meta' || MODO === 'paginas' || ((min % 60) < 10 && roboDoc.horaFeita !== horaChave);
  if (fazHora && process.env.META_TOKEN) await db.collection('config').doc('robo').set({ horaFeita: horaChave }, { merge: true });
  if (process.env.META_TOKEN && fazHora && MODO !== 'paginas') {
    try { await require('./meta')({ db, usuarios, enviar, jaFoi, marcar, ehAdm, hoje, agoraIso: agoraIso0 }); }
    catch (e) { console.error('Meta:', e.message); await db.collection('anunciosMeta').doc('estado').set({ atualizadoEm: agoraIso0, erro: String(e.message).slice(0, 300) }, { merge: true }); }
  }
  if (process.env.META_TOKEN && fazHora) {
    try { await pub.sincronizarPaginas({ db, agoraIso: agoraIso0 }); } catch (e) { console.error('Postagens (páginas):', e.message); }
  }
  if (MODO === 'meta' || MODO === 'paginas') return;

  // Pasta Prontos: vídeo/foto exportado no Drive vira card em "Para programar" sozinho
  try { await require('./prontos')({ db, agoraIso: agoraIso0, hoje }); } catch (e) { console.error('Prontos:', e.message); }

  const tarefas = (await db.collection('tar').where('etapa', 'in', ['agendar', 'agendado', 'captado', 'edicao']).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.etapa !== 'entregue');
  const emEdicao = (t) => t.etapa === 'captado' || t.etapa === 'edicao';
  const doUsuario = (u, t) => { const m = membroDe(u); return m && arr(t.captacao).concat(arr(t.edicao)).includes(m); };
  const naEdicao = (u, t) => { const m = membroDe(u); return m && arr(t.edicao).includes(m); };
  const naCaptacao = (u, t) => { const m = membroDe(u); return m && arr(t.captacao).includes(m); };

  // Clientes: conteúdos editados esperando programar e programados que já deviam ter saído
  const lojas = Object.fromEntries((await db.collection('lojas').get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const posts = (await db.collection('posts').where('status', 'in', ['pronto', 'programado']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const TPOST = { reels: 'Reels', feed: 'Feed', carrossel: 'Carrossel', stories: 'Stories' };
  const respDe = (lj) => { const r = (lj && lj.postagem) || 'Vanessa'; const a = usuarios.filter((u) => membroDe(u) === r); return a.length ? a : usuarios.filter(ehAdm); };
  const agoraIso = `${hoje}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const minutosEntre = (a, b) => Math.round((new Date(a + ':00Z') - new Date(b + ':00Z')) / 6e4);

  // 0a) Material entregue: avisa quem programa (agrupado por loja). Chave por pessoa:
  //     se o app dela estava aberto e já mostrou o aviso na hora, o robô não repete.
  for (const lj of Object.values(lojas)) {
    if (lj.ativo === false) continue;
    const ps = posts.filter((x) => x.status === 'pronto' && x.loja === lj.id);
    if (!ps.length) continue;
    for (const u of respDe(lj)) {
      const novos = [];
      for (const p of ps) if (!(await jaFoi(`pronto_${p.id}_${u.id}`))) novos.push(p);
      if (!novos.length) continue;
      const titulo = novos.length === 1 ? `Programar post: ${lj.nome}` : `Programar ${novos.length} posts: ${lj.nome}`;
      await enviar(u, titulo, novos.map((p) => `${p.titulo} (${TPOST[p.tipo] || 'post'})`).join(', ') + '. O material está no Drive.');
      for (const p of novos) await marcar(`pronto_${p.id}_${u.id}`);
    }
  }
  // 0b) Programado há mais de 2h e ainda não marcado como no ar: pedir conferência
  for (const p of posts.filter((x) => x.status === 'programado' && !x.pubStatus && x.quando && minutosEntre(agoraIso, x.quando) >= 120)) {
    const chave = `conferir_${p.id}_${p.quando.replace(/[^0-9]/g, '')}`;
    if (await jaFoi(chave)) continue;
    const lj = lojas[p.loja]; if (!lj || lj.ativo === false) continue;
    const para = [...new Set([...respDe(lj), ...usuarios.filter(ehAdm)])];
    for (const u of para) await enviar(u, `Confira se saiu: ${lj.nome}`, `${p.titulo} (${TPOST[p.tipo] || 'post'}) estava programado para ${dm(p.quando.slice(0, 10))} às ${p.quando.slice(11, 16)}. Se saiu, marque "Saiu" no app.`);
    await marcar(chave);
  }

  // 0c) Durães: material pronto no Drive -> avisar quem envia ao cliente (Adm e quem vê o caixa)
  const prontosDrive = (await db.collection('tar').where('entregaStatus', '==', 'drive').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.etapa === 'entregue');
  const socios = usuarios.filter((u) => ehAdm(u) || u.financeiro === true);
  for (const t of prontosDrive) {
    for (const u of socios) {
      const chave = `drive_${t.id}_${String(t.prontoEm || '').replace(/[^0-9]/g, '')}_${u.id}`;
      if (await jaFoi(chave)) continue;
      await enviar(u, `Pronto no Drive: ${t.titulo}`, `${TIPOS[t.tipo] || 'Trabalho'} editado e no Drive. Falta enviar ao cliente${t.contato ? ' (' + t.contato + ')' : ''}.`);
      await marcar(chave);
    }
  }

  // 0d) Álbum: cliente enviou a seleção de fotos
  const albunsEnv = (await db.collection('albuns').where('status', '==', 'enviado').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const a of albunsEnv) {
    for (const u of socios) {
      const chave = `album_${a.id}_${String(a.enviadoEm || '').replace(/[^0-9]/g, '')}_${u.id}`;
      if (await jaFoi(chave)) continue;
      await enviar(u, `Seleção do álbum recebida: ${a.titulo}`, `${(a.selecionadas || []).length} fotos escolhidas${a.obs ? '. Recado: ' + String(a.obs).slice(0, 80) : ''}.`);
      await marcar(chave);
    }
  }

  // 0e) Envios: o cliente abriu o link pela primeira vez
  const envAbertos = (await db.collection('envios').where('aberturas', '>', 0).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const e of envAbertos) {
    const chave = `envio_${e.id}`;
    if (await jaFoi(chave)) continue;
    const para = [...new Set([...usuarios.filter((u) => membroDe(u) && membroDe(u) === e.criadoPor), ...usuarios.filter(ehAdm)])];
    for (const u of para) await enviar(u, `Cliente abriu o link: ${e.titulo}`, `${(e.arquivos || []).length} arquivo(s)${e.baixados ? ` · ${e.baixados} download(s)` : ''}.`);
    await marcar(chave);
  }

  // 0g) Aprovação do cliente: aprovou ou pediu ajuste
  const desdeAp = new Date(Date.now() - 7 * 864e5).toISOString();
  const aps = (await db.collection('aprovacoes').where('respEm', '>=', desdeAp).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const ap of aps) {
    for (const it of (ap.itens || []).filter((x) => x.status === 'aprovado' || x.status === 'ajuste')) {
      const chave = `aprov_${ap.id}_${it.post}_${it.status}_${String(it.em || '').replace(/[^0-9]/g, '')}`;
      if (await jaFoi(chave)) continue;
      const tit = it.status === 'aprovado' ? `Cliente aprovou: ${ap.lojaNome || ''}` : `Cliente pediu ajuste: ${ap.lojaNome || ''}`;
      const corpo = it.status === 'aprovado' ? `${it.titulo} pode ir para a programação${it.por ? ' (' + it.por + ')' : ''}.` : `${it.titulo}: ${String(it.obs || '').slice(0, 120)}`;
      for (const u of usuarios) await enviar(u, tit, corpo);
      await marcar(chave);
    }
  }

  // 0f) Material bruto novo: avisa a equipe (menos quem subiu)
  const desde = new Date(Date.now() - 3 * 864e5).toISOString();
  const mats = (await db.collection('materiais').where('criadoEm', '>=', desde).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const m of mats.filter((x) => (x.arquivos || []).length)) {
    const chave = `material_${m.id}`;
    if (await jaFoi(chave)) continue;
    const nv = m.arquivos.filter((a) => /^video/.test(a.mime || '')).length, nf = m.arquivos.length - nv;
    const quem = [nv ? `${nv} vídeo(s)` : '', nf ? `${nf} foto(s)` : ''].filter(Boolean).join(' e ');
    const dia = String(m.data || '').split('-').reverse().slice(0, 2).join('/');
    for (const u of usuarios.filter((u) => membroDe(u) !== m.criadoPor)) await enviar(u, `Material novo: ${m.lojaNome || 'loja'} · ${dia}`, `${quem} para editar${m.criadoPor ? ', subido por ' + m.criadoPor : ''}. Abra em Envios → Materiais brutos.`);
    await marcar(chave);
  }

  // 0h) Tarefas da Agenda: nova tarefa, tarefa concluída, lembrete do horário e o que ficou para trás no fim do dia
  const REP = { diario: 'Todo dia', uteis: 'Dias úteis', semanal: 'Toda semana' };
  const tarefasAg = (await db.collection('tarefas').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.ativo !== false);
  const ocorre = (t, d) => {
    if (!t.data || d < t.data || (t.fim && d > t.fim)) return false;
    if (!t.repete) return t.data === d;
    if (t.repete === 'diario') return true;
    const w = new Date(d + 'T12:00:00Z').getUTCDay();
    if (t.repete === 'uteis') return w >= 1 && w <= 5;
    if (t.repete === 'semanal') return w === new Date(t.data + 'T12:00:00Z').getUTCDay();
    return false;
  };
  const paraT = (t) => { const p = arr(t.para); const alvo = usuarios.filter((u) => !p.length || p.includes(membroDe(u))); return alvo.length ? alvo : usuarios.filter(ehAdm); };
  const quemT = (t) => (arr(t.para).length ? arr(t.para).join(', ') : 'todos');
  const recente = new Date(Date.now() - 2 * 864e5).toISOString();
  for (const t of tarefasAg) {
    // nova: avisa quem vai fazer (menos quem criou)
    if (t.criadoEm && t.criadoEm >= recente) {
      for (const u of paraT(t).filter((u) => !t.criadoPor || membroDe(u) !== t.criadoPor)) {
        const chave = `tfnova_${t.id}_${u.id}`;
        if (await jaFoi(chave)) continue;
        await enviar(u, `Nova tarefa${t.criadoPor ? ' de ' + t.criadoPor : ''}: ${t.titulo}`, `${t.repete ? REP[t.repete] || '' : 'Para ' + dm(t.data)}${t.hora ? ' às ' + t.hora : ''} · ${quemT(t)}${t.obs ? '. ' + t.obs : ''}`);
        await marcar(chave);
      }
    }
    // concluída: avisa todo mundo (menos quem fez)
    for (const [d, f] of Object.entries(t.feito || {})) {
      if (!f || d < addDias(hoje, -2)) continue;
      for (const u of usuarios.filter((u) => membroDe(u) !== f.por)) {
        const chave = `tfok_${t.id}_${d}_${u.id}`;
        if (await jaFoi(chave)) continue;
        await enviar(u, `${f.por || 'Alguém'} concluiu: ${t.titulo}`, `Tarefa de ${dm(d)} marcada como feita${f.em ? ' às ' + String(f.em).slice(11, 16) : ''}.`);
        await marcar(chave);
      }
    }
    // lembrete: ~30 min antes do horário
    if (t.hora && ocorre(t, hoje) && !(t.feito || {})[hoje]) {
      const [hh, mm] = t.hora.split(':').map(Number);
      const falta = hh * 60 + mm - min;
      if (falta >= -5 && falta <= 35) {
        const chave = `tfhora_${t.id}_${hoje}`;
        if (!(await jaFoi(chave))) {
          for (const u of paraT(t)) await enviar(u, `Tarefa ${falta > 0 ? 'em ' + falta + ' min' : 'agora'}: ${t.titulo}`, `Às ${t.hora} · ${quemT(t)}. Marque como feita na Agenda quando terminar.`);
          await marcar(chave);
        }
      }
    }
  }
  // fim do dia (18h): o que ainda falta de hoje
  if (min >= 18 * 60 && min < 22 * 60) {
    for (const u of usuarios) {
      const chave = `tffalta_${u.id}_${hoje}`;
      if (!arr(u.tokens).length || (await jaFoi(chave))) continue;
      const m = membroDe(u);
      const falta = tarefasAg.filter((t) => ocorre(t, hoje) && !(t.feito || {})[hoje] && (!arr(t.para).length || arr(t.para).includes(m) || (!m && ehAdm(u))));
      if (falta.length) await enviar(u, `Ainda falta ${falta.length} tarefa(s) de hoje`, falta.map((t) => t.titulo).join(', '));
      await marcar(chave);
    }
  }

  // 1) Resumo do dia, a partir das 8h
  if (min >= 8 * 60 && min < 22 * 60) {
    for (const u of usuarios) {
      const chave = `resumo_${u.id}_${hoje}`;
      if (!arr(u.tokens).length || (await jaFoi(chave))) continue;
      const ts = tarefas.filter((t) => ehAdm(u) || doUsuario(u, t));
      const lin = [];
      const hj = ts.filter((t) => t.data === hoje && !emEdicao(t)).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
      const am = ts.filter((t) => t.data === amanha && !emEdicao(t));
      const atr = ts.filter((t) => emEdicao(t) && t.prazo && t.prazo < hoje);
      const ent = ts.filter((t) => emEdicao(t) && t.prazo && t.prazo >= hoje && t.prazo <= em2);
      if (hj.length) lin.push('Hoje: ' + hj.map((t) => t.titulo + (t.hora ? ' ' + t.hora : '')).join(', '));
      if (am.length) lin.push('Amanhã: ' + am.map((t) => t.titulo).join(', '));
      if (ent.length) lin.push('Entregar até ' + dm(em2) + ': ' + ent.map((t) => t.titulo).join(', '));
      if (atr.length) lin.push('Atrasadas: ' + atr.map((t) => t.titulo).join(', '));
      const mm = membroDe(u), tfs = tarefasAg.filter((t) => ocorre(t, hoje) && !(t.feito || {})[hoje] && (!arr(t.para).length || arr(t.para).includes(mm) || (!mm && ehAdm(u))));
      if (tfs.length) lin.unshift('Tarefas de hoje: ' + tfs.map((t) => t.titulo + (t.hora ? ' ' + t.hora : '')).join(', '));
      const progr = posts.filter((p) => p.status === 'pronto' && lojas[p.loja] && (ehAdm(u) || membroDe(u) === (lojas[p.loja].postagem || 'Vanessa')));
      if (progr.length) lin.push('Para programar: ' + progr.length + ' post(s) (' + [...new Set(progr.map((p) => lojas[p.loja].nome))].join(', ') + ')');
      if (ehAdm(u) || u.financeiro === true) { const env = prontosDrive.map((t) => t.titulo); if (env.length) lin.push('Enviar ao cliente: ' + env.join(', ')); }
      if (lin.length) await enviar(u, atr.length ? `Seu dia · ${atr.length} edição(ões) atrasada(s)` : 'Seu dia na Central', lin.join('\n'));
      await marcar(chave);
    }
  }

  // 2) Edição atrasada: no dia em que o prazo estoura (a partir das 8h)
  if (min >= 8 * 60) {
    for (const t of tarefas.filter((x) => emEdicao(x) && x.prazo && x.prazo < hoje)) {
      const chave = `atraso_${t.id}_${t.prazo}`;
      if (await jaFoi(chave)) continue;
      const dias = Math.round((new Date(hoje) - new Date(t.prazo)) / 864e5);
      for (const u of usuarios.filter((u) => naEdicao(u, t) || ehAdm(u))) {
        await enviar(u, `Edição atrasada: ${t.titulo}`, `O prazo era ${dm(t.prazo)} (${dias} dia(s) atrás). Edição: ${arr(t.edicao).filter((k) => !String(k).startsWith('f:')).join(', ') || 'ninguém marcado'}.`);
      }
      await marcar(chave);
    }
  }

  // 4) Eventos da Durães (casamentos, aniversários...): aviso 7 dias, 3 dias e 1 dia antes (a partir das 9h)
  if (min >= 9 * 60) {
    const ANTES = [[7, 'Falta 1 semana'], [3, 'Faltam 3 dias'], [1, 'É amanhã']];
    for (const [n, tx] of ANTES) {
      const dia = addDias(hoje, n);
      for (const t of tarefas.filter((x) => x.empresa === 'duraes' && x.data === dia && !emEdicao(x))) {
        const chave = `evento_${t.id}_${t.data}_${n}d`;
        if (await jaFoi(chave)) continue;
        const equipe = arr(t.captacao).filter((k) => !String(k).startsWith('f:'));
        const para = usuarios.filter((u) => naCaptacao(u, t) || ehAdm(u));
        for (const u of para) await enviar(u, `${tx}: ${t.titulo}`, `${TIPOS[t.tipo] || 'Evento'} em ${dm(t.data)}${t.hora ? ' às ' + t.hora : ''}${t.local ? ' · ' + t.local : ''}. Equipe: ${equipe.join(', ') || 'ninguém marcado ainda'}.`);
        await marcar(chave);
      }
    }
  }

  // 3) "Daqui a pouco": até ~2h30 antes da captação
  for (const t of tarefas.filter((x) => x.data === hoje && x.hora && !emEdicao(x))) {
    const [hh, mm] = t.hora.split(':').map(Number);
    const falta = hh * 60 + mm - min;
    if (falta < 0 || falta > 150) continue;
    const chave = `antes_${t.id}_${t.data}_${t.hora.replace(':', '')}`;
    if (await jaFoi(chave)) continue;
    const alvo = usuarios.filter((u) => naCaptacao(u, t));
    const para = alvo.length ? alvo : usuarios.filter(ehAdm);
    const quando = falta < 60 ? `em ${falta} min` : `em ${Math.floor(falta / 60)}h${falta % 60 ? String(falta % 60).padStart(2, '0') : ''}`;
    for (const u of para) await enviar(u, `Daqui a pouco: ${t.titulo}`, `${TIPOS[t.tipo] || 'Captação'} às ${t.hora} (${quando})${t.local ? ' · ' + t.local : ''}`);
    await marcar(chave);
  }
}

// Plantão: o agendador do GitHub atrasa de 30 a 55 minutos, então depois da rodada normal o robô fica
// uns 9 minutos de olho nos posts agendados (confere a cada 20 s) e, no fim, chama a próxima rodada sozinho.
async function plantao() {
  const pub = require('./publicar');
  let pend = [];
  const unsub = db.collection('posts').where('pubStatus', 'in', ['aguardando', 'publicando']).onSnapshot(
    (sn) => { pend = sn.docs.map((d) => ({ id: d.id, ...d.data() })); },
    (e) => console.error('Plantão (escuta):', e.message));
  const FIM = INICIO + (Number(process.env.PLANTAO_MIN) || 9) * 60e3;
  let ultTent = 0, ultBat = Date.now();
  console.log('Plantão ligado por ~9 min');
  while (Date.now() < FIM) {
    await espera((Number(process.env.PLANTAO_SEG) || 20) * 1e3);
    if (Date.now() - ultBat > 120e3) { ultBat = Date.now(); await batimento(); }
    const agoraIso = agoraIsoFn();
    const vencidos = pend.filter((p) => p.pubStatus === 'aguardando' && p.quando && p.quando <= agoraIso);
    if (!vencidos.length || Date.now() - ultTent < 45e3) continue;
    ultTent = Date.now();
    console.log(`Plantão: ${vencidos.length} post(s) na hora, publicando`);
    try { await pub.publicarAgendados({ db, usuarios: await carregarUsuarios(), enviar, ehAdm, membroDe, agoraIso }); } catch (e) { console.error('Plantão:', e.message); }
  }
  unsub();
}

(async () => {
  await rodada();
  if (MODO !== 'auto' || !noHorario()) return;
  await plantao();
  // avisa o workflow para chamar a próxima rodada (só se ainda estiver no horário de plantão)
  if (noHorario() && process.env.GITHUB_OUTPUT) require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'proxima=sim\n');
})().catch((e) => { console.error(e); process.exit(1); });
