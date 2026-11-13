// Acesso do robô ao Google Drive pela conta de serviço do Firebase (a mesma da pasta Prontos).
// A pasta precisa estar compartilhada (Leitor) com o e-mail dessa conta.
const { JWT } = require('google-auth-library');
const FOLDER = 'application/vnd.google-apps.folder';
const DAPI = 'https://www.googleapis.com/drive/v3';
let tok = { v: '', exp: 0 };
async function token() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const { token: t } = await jwt.getAccessToken();
  tok = { v: t, exp: Date.now() + 45 * 60e3 };
  return t;
}
async function g(url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (await token()) } });
  if (!r.ok) throw new Error('Drive ' + r.status);
  return r.json();
}
const CAMPOS = 'id,name,mimeType,size,modifiedTime';
async function listar(id) {
  let out = [], pt = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const j = await g(`${DAPI}/files?q=${q}&fields=nextPageToken,files(${CAMPOS})&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pt ? '&pageToken=' + pt : ''}`);
    out = out.concat(j.files || []); pt = j.nextPageToken || '';
  } while (pt);
  return out;
}
const idDoLink = (link) => { const m = String(link || '').match(/\/folders\/([\w-]+)|[?&]id=([\w-]+)|\/d\/([\w-]+)/); return m ? (m[1] || m[2] || m[3]) : ''; };
// fotos e vídeos de um link do Drive (arquivo ou pasta, entrando em até 2 níveis de subpasta)
async function midiaDoLink(link) {
  const id = idDoLink(link); if (!id) return [];
  const i = await g(`${DAPI}/files/${id}?fields=${CAMPOS}&supportsAllDrives=true`);
  if (i.mimeType !== FOLDER) return /^(image|video)\//.test(i.mimeType || '') ? [i] : [];
  const out = [];
  const anda = async (pid, nv) => { for (const f of await listar(pid)) { if (f.mimeType === FOLDER) { if (nv < 2) await anda(f.id, nv + 1); } else if (/^(image|video)\//.test(f.mimeType || '')) out.push(f); } };
  await anda(id, 0);
  return out;
}
async function baixar(id) {
  const r = await fetch(`${DAPI}/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + (await token()) } });
  if (!r.ok) throw new Error('Drive ' + r.status + ' ao baixar');
  return Buffer.from(await r.arrayBuffer());
}
module.exports = { midiaDoLink, baixar, idDoLink };
