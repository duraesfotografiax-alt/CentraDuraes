// Pasta Prontos (CapCut → Drive → Central), feita pelo robô a cada 10 minutos, sem ninguém precisar abrir o app.
// O robô usa a mesma conta de serviço do Firebase. Para ele enxergar a pasta, ela precisa estar
// compartilhada (Leitor) com o e-mail dessa conta, e a "Google Drive API" ligada no projeto do Google Cloud.
const { JWT } = require('google-auth-library');

const FOLDER = 'application/vnd.google-apps.folder';
const DAPI = 'https://www.googleapis.com/drive/v3';
const MES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nrm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ignora = (s) => /(j[aá]\s*)?(postad|publicad|usad|antig|arquivad|bruto|backup|lixo|n[aã]o\s*usar|\bold\b)/i.test(nrm(s));
const ehTipo = (s) => /^(fotos?|v[ií]deos?|videos?|reels|stories|feed|carross[eé]is|carrossel|prontos?|editados?|finalizados?)$/i.test(String(s || '').trim());
const ehVid = (s) => /^(v[ií]deos?|videos?|reels|stories)$/i.test(String(s || '').trim());

function mesDaPasta(nome, hoje) {
  const n = nrm(nome);
  let mi = -1;
  for (let i = 0; i < 12; i++) { const m = MES[i]; if (n.startsWith(m) || new RegExp('(^|[^a-z])' + m + '([^a-z]|$)').test(n)) { mi = i; break; } }
  let y = (String(nome).match(/(20\d{2})/) || [])[1], mo = mi + 1;
  if (mi < 0) { const d = String(nome).match(/\b(\d{1,2})[-._/](20\d{2})\b/); if (!d) return null; mo = +d[1]; y = d[2]; if (mo < 1 || mo > 12) return null; }
  const [ay, am] = hoje.split('-').map(Number);
  if (!y) y = mo > am + 3 ? ay - 1 : ay;
  return (+y) * 100 + mo;
}

const trasDe = (hoje, n) => new Date(Date.parse(hoje + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10) + 'T00:00';

module.exports = async function prontos({ db, agoraIso, hoje }) {
  let abertos = null;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const lojas = (await db.collection('lojas').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.prontosId && l.ativo !== false);
  await db.collection('config').doc('robo').set({ email: sa.client_email, prontosEm: agoraIso }, { merge: true });
  if (!lojas.length) return;
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const { token } = await jwt.getAccessToken();
  const g = async (url) => {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { const t = await r.text(); const e = new Error(r.status + ' ' + (t.match(/"message":\s*"([^"]+)/) || [])[1] || r.status); e.status = r.status; e.txt = t; throw e; }
    return r.json();
  };
  const listar = async (id) => {
    let out = [], pt = '';
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
      const j = await g(`${DAPI}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,createdTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pt ? '&pageToken=' + pt : ''}`);
      out = out.concat(j.files || []); pt = j.nextPageToken || '';
    } while (pt);
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
  };
  const info = {};
  const infoDe = async (id) => { if (!(id in info)) { try { info[id] = await g(`${DAPI}/files/${id}?fields=name,mimeType,parents,trashed&supportsAllDrives=true`); } catch (_) { info[id] = null; } } return info[id]; };

  for (const l of lojas) {
    try {
      const posts = (await db.collection('posts').where('loja', '==', l.id).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
      const ja = new Set(posts.filter((p) => p.origem).map((p) => p.origem));
      const desde = l.prontosDesde || '';
      const novoArq = (f) => !desde || String(f.modifiedTime || f.createdTime || '9') >= desde;
      let n = 0; const criados = [];
      const novo = async (origem, titulo, tipo, drive) => {
        if (ja.has(origem)) return; ja.add(origem);
        const nr = await db.collection('posts').add({ loja: l.id, titulo: String(titulo).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').slice(0, 100), tipo, drive, status: 'pronto', origem, legenda: l.legPadrao || '', editadoPor: 'Drive', editadoEm: agoraIso, quando: '', link: '', obs: 'Veio do Drive (' + (l.prontosNome || 'Prontos') + ')' });
        criados.push({ id: nr.id, titulo: String(titulo) });
        n++;
      };
      let fs = await listar(l.prontosId);
      const meses = fs.filter((f) => f.mimeType === FOLDER && !ignora(f.name)).map((f) => ({ f, k: mesDaPasta(f.name, hoje) })).filter((x) => x.k).sort((a, b) => b.k - a.k);
      if (meses.length) fs = await listar(meses[0].f.id);
      const ignorados = new Set(), vistos = new Set();
      const marca = async (id, nv) => { ignorados.add(id); if (nv > 3) return; try { for (const x of await listar(id)) { ignorados.add(x.id); if (x.mimeType === FOLDER) await marca(x.id, nv + 1); } } catch (_) {} };
      const trata = async (lista, dentroTipo, soVideo) => {
        for (const f of lista) {
          if (f.mimeType === FOLDER) {
            if (ignora(f.name)) { await marca(f.id, 0); continue; }
            if (!dentroTipo && ehTipo(f.name)) { await trata(await listar(f.id), true, ehVid(f.name)); continue; }
            if (soVideo) continue;
            vistos.add(f.id);
            const den = (await listar(f.id)).filter((x) => /^(image|video)\//.test(x.mimeType || ''));
            if (!den.length || !den.some(novoArq)) continue;
            const nv = den.filter((x) => /^video/.test(x.mimeType)).length;
            await novo(f.id, f.name, den.length === 1 && nv ? 'reels' : den.length > 1 ? 'carrossel' : nv ? 'reels' : 'feed', 'https://drive.google.com/drive/folders/' + f.id);
            continue;
          }
          vistos.add(f.id);
          if (!novoArq(f)) continue;
          if (/^video\//.test(f.mimeType || '')) await novo(f.id, f.name, 'reels', 'https://drive.google.com/file/d/' + f.id + '/view');
          else if (/^image\//.test(f.mimeType || '')) await novo(f.id, f.name, 'feed', 'https://drive.google.com/file/d/' + f.id + '/view');
        }
      };
      await trata(fs, false, false);
      // Liga os cards novos ao serviço da Produção: o arquivo chegou no Drive, então o serviço mais antigo da loja que está em edição passa para "Entregue"
      try {
        const sem = posts.filter((p) => p.origem && !p.tar && !p.tarTentado && p.status === 'pronto' && String(p.editadoEm || '') >= trasDe(hoje, 2));
        const lote = [...new Map([...sem.map((p) => [p.id, p.id]), ...criados.map((c) => [c.id, c.id])]).values()];
        if (lote.length) {
          if (!abertos) abertos = (await db.collection('tar').where('etapa', 'in', ['captado', 'edicao']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
          const meus = abertos.filter((t) => t.loja === l.id && t.empresa !== 'duraes').sort((a, b) => ((a.etapa === 'edicao' ? 0 : 1) - (b.etapa === 'edicao' ? 0 : 1)) || String(a.prazo || a.data || 'z').localeCompare(String(b.prazo || b.data || 'z')));
          const job = meus[0];
          if (job) {
            await db.collection('tar').doc(job.id).update({ etapa: 'entregue', entregueEm: hoje, entregueAuto: true, entregueAutoEm: agoraIso, drive: job.drive || '' });
            abertos = abertos.filter((t) => t.id !== job.id);
            console.log(`Prontos ${l.nome}: serviço "${job.titulo}" passou para Entregue (${lote.length} conteúdo(s) no Drive)`);
          }
          for (const id of lote) await db.collection('posts').doc(id).update(Object.assign({ tarTentado: true }, job ? { tar: job.id } : {}));
        }
      } catch (e) { console.error('Prontos (ligar serviço):', e.message); }
      // card cujo arquivo foi para "Já postados" (em qualquer lugar) ou para a lixeira: sai de Para programar
      const usado = async (id) => {
        if (ignorados.has(id)) return true;
        let i = await infoDe(id); if (!i) return false;
        if (i.trashed || (i.mimeType === FOLDER && ignora(i.name))) return true;
        for (let k = 0; k < 6 && i && i.parents && i.parents[0]; k++) {
          const pid = i.parents[0]; if (pid === l.prontosId) return false;
          i = await infoDe(pid); if (!i) return false;
          if (i.trashed || ignora(i.name || '')) return true;
        }
        return false;
      };
      let fora = 0;
      for (const p of posts.filter((p) => p.origem && p.status === 'pronto' && !vistos.has(p.origem))) {
        if (await usado(p.origem)) { await db.collection('posts').doc(p.id).update({ status: 'descartado' }); fora++; }
      }
      await db.collection('lojas').doc(l.id).update({ prontosSinc: new Date().toISOString(), prontosRobo: agoraIso, prontosRoboErro: '' });
      if (n || fora) console.log(`Prontos ${l.nome}: ${n} novo(s), ${fora} saiu(ram) de Para programar`);
    } catch (e) {
      const msg = e.status === 404 || e.status === 403
        ? (/has not been used|is disabled|accessNotConfigured/i.test(e.txt || '') ? 'A Google Drive API está desligada no projeto do Google Cloud.' : 'O robô não tem acesso a esta pasta.')
        : String(e.message || e).slice(0, 200);
      console.error(`Prontos ${l.nome}:`, msg);
      try { await db.collection('lojas').doc(l.id).update({ prontosRoboErro: msg, prontosRobo: agoraIso }); } catch (_) {}
    }
  }
};
