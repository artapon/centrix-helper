// PM2 Manager: the remote servers (environments), each a pm2-agent with its URL and token, in SQLite.
//   pm2_environments  name, url, token (encrypted, see secret.js; never leaves this module), description,
//                     allow_insecure_tls (accept a self-signed certificate), enabled (read or parked)
// Environment 0 is "Local" (local.pm2.js) and has no row.
const { run, get, all } = require('../../../app/core/config/sqlite');
const secret = require('./secret');

const NAME_RE = /^[A-Za-z0-9 _.\-:()]{1,64}$/;
const DESCRIPTION_MAX = 256;
const URL_MAX = 512;
const TOKEN_MIN = 16;
const TOKEN_MAX = 512;
// printable ASCII only: the token goes into an HTTP header
const TOKEN_RE = /^[\x21-\x7E]+$/;
const LINK = '/pm2';

let ready = null;
function schema() {
  if (!ready) {
    ready = run(`
      CREATE TABLE IF NOT EXISTS pm2_environments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        url TEXT NOT NULL,
        token TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        allow_insecure_tls INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`).catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

// Every row that leaves this module: the token never does, not even masked.
const view = (row) => ({
  id: row.id, name: row.name, url: row.url, description: row.description,
  allowInsecureTls: !!row.allow_insecure_tls, enabled: !!row.enabled, hasToken: !!row.token,
  createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at
});

// The sidebar asks on every page, so it answers from memory (refreshed on every change).
let menuCache = [];
async function refreshMenu() {
  const rows = await all('SELECT id, name, enabled FROM pm2_environments ORDER BY sort_order, name COLLATE NOCASE');
  menuCache = rows;
  return rows;
}

exports.menu = () => [{ text: 'Local', link: `${LINK}/env/0`, icon: 'fas fa-desktop' }]
  .concat(menuCache.filter((r) => r.enabled).map((r) => ({ text: r.name, link: `${LINK}/env/${r.id}`, icon: 'fas fa-server' })));

exports.init = () => schema().then(refreshMenu);

exports.list = async function () {
  await schema();
  return (await all('SELECT * FROM pm2_environments ORDER BY sort_order, name COLLATE NOCASE')).map(view);
};

exports.get = async function (id) {
  await schema();
  const row = await get('SELECT * FROM pm2_environments WHERE id = ?', [id]);
  return row ? view(row) : null;
};

/** What agent.service needs to call it: { url, token, allowInsecureTls }, or an error to show. */
exports.target = async function (id) {
  await schema();
  const row = await get('SELECT * FROM pm2_environments WHERE id = ?', [id]);
  if (!row) throw Object.assign(new Error('Environment not found'), { status: 404, expose: true });
  if (!row.enabled) throw Object.assign(new Error('This environment is disabled'), { status: 409, expose: true });
  let token;
  try { token = secret.decrypt(row.token); } catch (e) {
    throw Object.assign(new Error('The stored agent token could not be decrypted. Edit this environment and enter it again.'), { status: 409, expose: true });
  }
  return { url: row.url, token, allowInsecureTls: !!row.allow_insecure_tls, name: row.name };
};

exports.validateUrl = function (url) {
  const { parseAgentUrl } = require('./agent.service');
  if (typeof url !== 'string' || !url.trim() || url.length > URL_MAX) throw invalid('Agent URL is required');
  // the same agent typed with or without a trailing slash is one URL
  return parseAgentUrl(url).toString().replace(/\/+$/, '');
};

exports.validateToken = function (token) {
  if (typeof token !== 'string' || token.length < TOKEN_MIN || token.length > TOKEN_MAX || !TOKEN_RE.test(token)) {
    throw invalid(`The agent token must be ${TOKEN_MIN}-${TOKEN_MAX} printable characters without spaces`);
  }
  return token;
};

function normalize(b, { tokenRequired }) {
  const name = String(b.name || '').trim();
  if (!NAME_RE.test(name)) throw invalid('The name must be 1-64 characters: letters, digits, space, _ . - : ( )');
  const description = String(b.description || '').trim();
  if (description.length > DESCRIPTION_MAX) throw invalid(`The description must be at most ${DESCRIPTION_MAX} characters`);
  const token = b.token ? exports.validateToken(String(b.token)) : null;
  if (tokenRequired && !token) throw invalid('The agent token is required');
  return {
    name, description, url: exports.validateUrl(b.url), token,
    allowInsecureTls: b.allowInsecureTls ? 1 : 0,
    enabled: b.enabled === undefined ? 1 : (b.enabled ? 1 : 0)
  };
}

const unique = (err) => (err && /UNIQUE/.test(err.message) ? invalid('An environment with that name already exists') : err);

exports.create = async function (body, username) {
  await schema();
  const v = normalize(body || {}, { tokenRequired: true });
  const now = new Date().toISOString();
  try {
    const r = await run(`INSERT INTO pm2_environments (name, url, token, description, allow_insecure_tls, enabled, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [v.name, v.url, secret.encrypt(v.token), v.description, v.allowInsecureTls, v.enabled, username, now, username, now]);
    await refreshMenu();
    return exports.get(r.lastID);
  } catch (err) { throw unique(err); }
};

// A blank token keeps the stored one: the page never receives it, so it cannot send it back.
exports.update = async function (id, body, username) {
  await schema();
  const row = await get('SELECT * FROM pm2_environments WHERE id = ?', [id]);
  if (!row) return null;
  const v = normalize(body || {}, { tokenRequired: false });
  try {
    await run(`UPDATE pm2_environments SET name = ?, url = ?, token = ?, description = ?, allow_insecure_tls = ?, enabled = ?, updated_by = ?, updated_at = ?
      WHERE id = ?`, [v.name, v.url, v.token ? secret.encrypt(v.token) : row.token, v.description, v.allowInsecureTls, v.enabled, username, new Date().toISOString(), id]);
    await refreshMenu();
    return exports.get(id);
  } catch (err) { throw unique(err); }
};

exports.setEnabled = async function (id, enabled, username) {
  await schema();
  const r = await run('UPDATE pm2_environments SET enabled = ?, updated_by = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, username, new Date().toISOString(), id]);
  await refreshMenu();
  return r.changes ? exports.get(id) : null;
};
