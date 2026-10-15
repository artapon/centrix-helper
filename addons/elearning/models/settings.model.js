// E-Learning > Settings: the shared folders lessons may play videos from, set by an administrator.
// Kept in SQLite app_meta ("elearning.settings" -> JSON), so they survive restarts.
//   folders: [{ key, name, path }]  path is a folder the server can read, e.g. \\fileserver\training
//   A lesson stores "<key>|<path inside the folder>", so moving a share means editing one path here.
const fs = require('fs');
const path = require('path');
const { run, get } = require('../../../app/core/config/sqlite');

const KEY = 'elearning.settings';
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_FOLDERS = 50;

let cache = null;

const invalid = (message) => Object.assign(new Error(message), { status: 400, expose: true });
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'folder';

exports.get = async function () {
  if (cache) return cache;
  const row = await get('SELECT value FROM app_meta WHERE key = ?', [KEY]);
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch (e) { stored = {}; }
  cache = { folders: (Array.isArray(stored.folders) ? stored.folders : []).filter((f) => f && KEY_RE.test(f.key) && f.path) };
  return cache;
};

exports.folder = async (key) => (await exports.get()).folders.find((f) => f.key === key) || null;

// A folder path as typed: \\server\share\dir, //server/share/dir or a drive path (D:\Training).
function folderPath(p) {
  let v = text(p, 1000).replace(/[\\/]+$/, '');
  if (/^\/\/[^/]/.test(v)) v = v.replace(/\//g, '\\');
  if (!v || !(path.isAbsolute(v) || /^\\\\[^\\]+\\[^\\]+/.test(v))) throw invalid(`"${p || ''}" is not a full folder path, e.g. \\\\fileserver\\training or D:\\Training.`);
  return path.normalize(v);
}
exports.folderPath = folderPath;

/** Saves the folder list; keeps each existing folder's key (lessons refer to it) and makes keys for new ones. */
exports.save = async function (body) {
  const list = Array.isArray(body && body.folders) ? body.folders : [];
  if (list.length > MAX_FOLDERS) throw invalid(`At most ${MAX_FOLDERS} shared folders.`);
  const cur = await exports.get();
  // Keys in use now are never given to a new folder, so lessons of a removed folder don't play from another one.
  const taken = new Set(cur.folders.map((c) => c.key));
  const kept = new Set();
  const names = new Set();
  const folders = list.map((f) => {
    const name = text(f && f.name, 80);
    if (!name) throw invalid('Each shared folder needs a name.');
    if (names.has(name.toLowerCase())) throw invalid(`There are two shared folders named "${name}".`);
    names.add(name.toLowerCase());
    let key = f && taken.has(f.key) && !kept.has(f.key) ? f.key : '';
    if (!key) {
      const base = slug(name);
      key = base;
      for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 36)}-${i}`;
      taken.add(key);
    }
    kept.add(key);
    return { key, name, path: folderPath(f && f.path) };
  });
  const next = { folders };
  await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [KEY, JSON.stringify(next)]);
  cache = next;
  return next;
};

/** Can the server read the folder? { ok, error?, folders, videos } (counts of the top level only). */
exports.test = async function (p) {
  const dir = folderPath(p);
  try {
    const st = await fs.promises.stat(dir);
    if (!st.isDirectory()) return { ok: false, error: 'This is a file, not a folder.' };
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const { isVideo } = require('./video.service');
    return { ok: true, folders: entries.filter((e) => e.isDirectory()).length, videos: entries.filter((e) => e.isFile() && isVideo(e.name)).length };
  } catch (err) {
    const why = { ENOENT: 'The folder was not found.', EACCES: 'The server has no permission to read it.', EPERM: 'The server has no permission to read it.' }[err.code];
    return { ok: false, error: why || `The server cannot open it (${err.code || err.message}).` };
  }
};
