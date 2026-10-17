// Marketplace > Upload add-on: checks an add-on package (.zip) and installs it under addons/<id>/, and builds
// the starter add-on of the developer guide. An upload is checked first (inspect: manifest, file paths, sizes,
// packages) and kept for a few minutes; installing it is a second, confirmed step. Updating an add-on keeps the
// old folder in data/addon-backups/. New code is loaded when the server restarts (routes are mounted at start).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zip = require('../../../core/helpers/zip.helper');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const ADDONS_DIR = path.join(ROOT, 'addons');
const BACKUP_DIR = path.join(ROOT, 'data', 'addon-backups');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SEGMENT_RE = /^[A-Za-z0-9._@()+\- ]+$/;     // a folder or file name inside the package
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.git)(\/|$)/i;
const KEEP_MS = 15 * 60 * 1000;                   // an uploaded package waits this long for "Install"
const LIMITS = { maxFiles: 2000, maxBytes: 50 * 1024 * 1024 };

const uploads = new Map();                        // token -> { at, id, files, manifest }
const installed = [];                             // installed since this start: { id, name, version, update, by, at }

function bad(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

// A package path, checked: forward slashes, no "..", no absolute paths, plain names only.
function safePath(name) {
  const p = name.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = p.split('/');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.length > 240 ||
      parts.some((s) => !s || s === '.' || s === '..' || !SEGMENT_RE.test(s))) {
    throw bad(`The package contains a file with a path that is not allowed: "${name}".`);
  }
  return p;
}

const packagesMissing = (list) => (Array.isArray(list) ? list : []).map(String).filter((n) => {
  try { require.resolve(n, { paths: [ROOT] }); return false; } catch (e) { return true; }
});

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

/**
 * Checks an uploaded .zip. The add-on is the folder holding addon.json: the ZIP's root or one folder in it.
 * Returns what installing it would do, with a token for install().
 */
exports.inspect = function (buffer, username) {
  for (const [t, u] of uploads) if (Date.now() - u.at > KEEP_MS) uploads.delete(t);
  const all = zip.read(buffer, LIMITS)
    .map((f) => ({ name: f.name.replace(/\\/g, '/'), data: f.data }))
    .filter((f) => !JUNK_RE.test(f.name));
  const manifests = all.filter((f) => /^([^/]+\/)?addon\.json$/i.test(f.name));
  if (!manifests.length) throw bad('No addon.json found: the ZIP must hold the add-on folder (or its files) with addon.json at the top.');
  if (manifests.length > 1) throw bad('The ZIP holds more than one addon.json at the top; upload one add-on at a time.');
  const prefix = manifests[0].name.slice(0, -'addon.json'.length);
  const files = all.filter((f) => f.name.startsWith(prefix)).map((f) => ({ name: safePath(f.name.slice(prefix.length)), data: f.data }));
  const outside = all.length - files.length;

  let m;
  try { m = JSON.parse(manifests[0].data.toString('utf8').replace(/^﻿/, '')); } catch (e) { throw bad('addon.json is not valid JSON: ' + e.message); }
  if (!m || typeof m !== 'object') throw bad('addon.json must be a JSON object.');
  if (!ID_RE.test(String(m.id || ''))) throw bad('addon.json: "id" is required, 1-40 characters: lower-case letters, digits and "-", starting with a letter or digit.');
  if (!m.name) throw bad('addon.json: "name" is required.');
  if (files.some((f) => f.name.split('/')[0] === 'node_modules')) throw bad('The package contains node_modules; list npm packages in addon.json "packages" instead.');

  const id = String(m.id);
  const dest = path.join(ADDONS_DIR, id);
  const current = fs.existsSync(path.join(dest, 'addon.json')) ? readJson(path.join(dest, 'addon.json')) : null;
  const routes = ['routes.open.js', 'routes.public.js', 'routes.js'].filter((r) => files.some((f) => f.name === r));
  const warnings = [];
  if (!routes.length) warnings.push('No routes file (routes.open.js, routes.public.js or routes.js): the add-on adds no pages.');
  if (outside) warnings.push(`${outside} file${outside === 1 ? '' : 's'} outside the add-on folder will not be installed.`);
  // Paths another add-on already owns
  const own = (Array.isArray(m.paths) ? m.paths : []).concat(m.menu && Array.isArray(m.menu.items) ? m.menu.items.map((i) => i && i.link) : []).filter(Boolean).map(String);
  require('../../../core/addons').list().filter((a) => a.id !== id).forEach((a) => {
    const clash = own.filter((p) => a.paths.some((q) => p === q || p.startsWith(q + '/') || q.startsWith(p + '/')));
    if (clash.length) warnings.push(`Uses ${clash.join(', ')}, which "${a.name}" also uses.`);
  });

  const token = crypto.randomBytes(16).toString('hex');
  uploads.set(token, { at: Date.now(), id, files, manifest: m, by: username || '' });
  const bytes = files.reduce((n, f) => n + f.data.length, 0);
  return {
    token, id,
    name: String(m.name), version: String(m.version || '1.0.0'), author: String(m.author || ''), category: String(m.category || 'Other'),
    icon: String(m.icon || 'fas fa-puzzle-piece'), summary: String(m.summary || m.description || ''),
    update: !!current, currentVersion: current ? String(current.version || '') : '',
    files: files.length, bytes, routes,
    fileList: files.map((f) => f.name).sort().slice(0, 300),
    packages: (Array.isArray(m.packages) ? m.packages : []).map(String),
    packagesMissing: packagesMissing(m.packages),
    warnings
  };
};

/** Installs a package checked by inspect(). Returns { id, name, version, update, backup }. */
exports.install = function (token, username) {
  const u = uploads.get(String(token || ''));
  if (!u || Date.now() - u.at > KEEP_MS) throw bad('This upload has expired or was already installed; upload the ZIP again.');
  uploads.delete(token);
  const dest = path.join(ADDONS_DIR, u.id);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(ADDONS_DIR, `.staging-${u.id}-${stamp}`);
  // Write the new version beside the add-ons first, then swap it in (the old one goes to the backups).
  for (const f of u.files) {
    const to = path.join(staging, ...f.name.split('/'));
    if (!to.startsWith(staging + path.sep)) throw bad('Unsafe path in the package.');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, f.data);
  }
  let backup = '';
  try {
    if (fs.existsSync(dest)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      backup = path.join(BACKUP_DIR, `${u.id}-${stamp}`);
      fs.renameSync(dest, backup);
    }
    fs.renameSync(staging, dest);
  } catch (err) {
    if (backup && !fs.existsSync(dest) && fs.existsSync(backup)) fs.renameSync(backup, dest);   // put the old version back
    fs.rmSync(staging, { recursive: true, force: true });
    throw Object.assign(new Error('The add-on could not be installed: ' + err.message), { status: 500, expose: true });
  }
  const rec = { id: u.id, name: String(u.manifest.name), version: String(u.manifest.version || '1.0.0'), update: !!backup, by: username || '', at: new Date().toISOString(),
    backup: backup ? path.relative(ROOT, backup) : '', packagesMissing: packagesMissing(u.manifest.packages) };
  const i = installed.findIndex((x) => x.id === rec.id);
  if (i >= 0) installed.splice(i, 1);
  installed.push(rec);
  return rec;
};

/** Add-ons installed or updated since the server started: they load on the next restart. */
exports.pending = () => installed.slice();

// ---- the starter add-on of the developer guide ----

/** The files of a working "hello" add-on with the given id and name, as a ZIP (Buffer). */
exports.starter = function (rawId, rawName) {
  const id = ID_RE.test(String(rawId || '')) ? String(rawId) : 'my-addon';
  const name = String(rawName || '').trim().slice(0, 60) || 'My Add-on';
  const link = '/' + id;
  const table = id.replace(/-/g, '_') + '_notes';
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  const files = [
    { name: `${id}/addon.json`, data: json({
      id, name, version: '1.0.0', author: 'Your team', category: 'Tools', icon: 'fas fa-puzzle-piece',
      summary: `${name}: one line that says what it does.`,
      description: `What ${name} is for, in a few sentences. Shown on its Marketplace page.`,
      features: ['A page with notes kept in SQLite', 'An action granted per role (Add notes)'],
      requires: ['SQLite (no MongoDB connection needed)'],
      packages: [],
      defaultActive: false,
      paths: [link],
      menu: { header: name, icon: 'fas fa-puzzle-piece', after: 'Tools',
        items: [{ text: 'Notes', icon: 'fas fa-sticky-note', link, actions: [{ key: 'add', text: 'Add notes', description: 'Add and delete notes' }] }] }
    }) },
    { name: `${id}/routes.public.js`, data:
`// Signed-in users, no MongoDB connection needed. Access follows the "Notes" menu item (${link} and below).
const express = require('express');
const asyncHandler = require('../../app/core/http/async.handler');
const { requireAction } = require('../../app/core/middleware/requireauth.middleware');
const controller = require('./controllers/${id}.controller');

const LINK = '${link}';
const router = express.Router();

router.get(LINK, asyncHandler(controller.index));
router.get(\`\${LINK}/notes\`, controller.list);
router.post(\`\${LINK}/notes\`, requireAction(LINK, 'add'), controller.add);
router.post(\`\${LINK}/notes/:id(\\\\d+)/delete\`, requireAction(LINK, 'add'), controller.remove);

module.exports = router;
` },
    { name: `${id}/controllers/${id}.controller.js`, data:
`// ${name}: the page and its JSON endpoints.
const view = require('../../../app/core/view').addon('${id}');
const { actionsFor } = require('../../../app/core/permissions');
const notes = require('../models/notes.model');

const LINK = '${link}';

exports.index = async function (req, res) {
  return res.renderPage(view('${id}'), { title: '${name.replace(/'/g, "\\'")}', can: actionsFor(req.user, LINK) });
};

exports.list = async function (req, res) {
  try { res.json({ notes: await notes.list() }); } catch (err) { console.error('${name}:', err); res.status(500).json({ error: 'The notes could not be read.' }); }
};

exports.add = async function (req, res) {
  try {
    const text = String((req.body && req.body.text) || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'Write a note first.' });
    res.json({ note: await notes.add(text, req.user.username) });
  } catch (err) { console.error('${name}:', err); res.status(500).json({ error: 'The note could not be saved.' }); }
};

exports.remove = async function (req, res) {
  try { await notes.remove(parseInt(req.params.id, 10)); res.json({ ok: true }); } catch (err) { console.error('${name}:', err); res.status(500).json({ error: 'The note could not be deleted.' }); }
};
` },
    { name: `${id}/models/notes.model.js`, data:
`// ${name}: notes in the app's SQLite database (data/app.sqlite), in a table of this add-on's own.
const { run, all, get } = require('../../../app/core/config/sqlite');

let ready = null;
const schema = () => ready || (ready = run(\`CREATE TABLE IF NOT EXISTS ${table} (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)\`)
  .catch((err) => { ready = null; throw err; }));

exports.list = async () => { await schema(); return all('SELECT * FROM ${table} ORDER BY id DESC LIMIT 200'); };
exports.add = async (text, by) => {
  await schema();
  const r = await run('INSERT INTO ${table} (text, created_by, created_at) VALUES (?, ?, ?)', [text, by || '', new Date().toISOString()]);
  return get('SELECT * FROM ${table} WHERE id = ?', [r.lastID]);
};
exports.remove = async (id) => { await schema(); await run('DELETE FROM ${table} WHERE id = ?', [id]); };
` },
    { name: `${id}/views/${id}.html`, data:
`<div class="col-12">
<div class="${id}-page">
  <h1>{{ title }}</h1>
  <p class="text-muted">A starter page: notes kept in SQLite. Change it into your add-on.</p>
  <div v-if="error" class="alert alert-danger">{{ error }}</div>

  <form v-if="can.add" class="${id}-form" @submit.prevent="add">
    <input v-model="text" class="form-control" maxlength="500" placeholder="Write a note…" aria-label="Note">
    <button type="submit" class="btn btn-primary" :disabled="!text.trim()">Add</button>
  </form>

  <ul class="list-group">
    <li v-for="n in notes" :key="n.id" class="list-group-item d-flex justify-content-between align-items-center">
      <span>{{ n.text }} <small class="text-muted">· {{ n.created_by }}</small></span>
      <button v-if="can.add" type="button" class="btn btn-sm btn-light" @click="remove(n)" aria-label="Delete">✕</button>
    </li>
    <li v-if="!notes.length" class="list-group-item text-muted">No notes yet.</li>
  </ul>
</div>
</div>

<style>
  .${id}-page { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
  .${id}-form { display: flex; gap: 8px; }
</style>

<script>
  (function () {
    var BASE = '${link}';
    var json = function (r) { return r.json().then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; }); };
    var post = function (url, body) {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(json);
    };
    Page.setup({
      data: function () { return { notes: [], text: '', error: '' }; },
      methods: {
        load: function () { var vm = this; fetch(BASE + '/notes', { credentials: 'same-origin' }).then(json).then(function (d) { vm.notes = d.notes; }).catch(function (e) { vm.error = e.message; }); },
        add: function () { var vm = this; post(BASE + '/notes', { text: vm.text }).then(function () { vm.text = ''; vm.load(); }).catch(function (e) { vm.error = e.message; }); },
        remove: function (n) { var vm = this; post(BASE + '/notes/' + n.id + '/delete').then(vm.load).catch(function (e) { vm.error = e.message; }); }
      },
      mounted: function () { this.load(); }
    });
  })();
</script>
` },
    { name: `${id}/README.md`, data:
`# ${name}

A starter add-on for Centrix Suite, made from Marketplace > Developer guide.

- \`addon.json\`: the manifest (name, menu, paths, permissions). The folder name must equal \`id\` (\`${id}\`).
- \`routes.public.js\`: pages and APIs for signed-in users (no MongoDB needed). Use \`routes.js\` for routes that need
  the Centrix database, \`routes.open.js\` for routes without sign-in.
- \`controllers/\`, \`models/\`, \`views/\`: the usual layout. Views are Vue 2 templates (\`Page.setup\`).

Install: zip the \`${id}\` folder, upload it in Administration > Marketplace > Upload add-on, restart the server,
then activate it (it starts inactive: \`"defaultActive": false\`) and grant "Notes" to roles in Roles & Permissions.
` }
  ];
  return zip.write(files);
};
