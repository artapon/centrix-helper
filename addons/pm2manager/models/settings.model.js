// PM2 Manager > Settings: options for every user of the add-on's pages, set by an administrator.
// Kept in SQLite app_meta ("pm2manager.settings" -> JSON), so they survive restarts.
//   theme: 'light' | 'dark' | 'system' (follow the device's light / dark setting)
const { run, get } = require('../../../app/core/config/sqlite');

const KEY = 'pm2manager.settings';
const THEMES = ['light', 'dark', 'system'];
const DEFAULTS = { theme: 'light', updatedBy: '', updatedAt: null };

let cache = null;

exports.get = async function () {
  if (cache) return cache;
  const row = await get('SELECT value FROM app_meta WHERE key = ?', [KEY]);
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch (e) { stored = {}; }
  cache = Object.assign({}, DEFAULTS, stored);
  if (!THEMES.includes(cache.theme)) cache.theme = DEFAULTS.theme;
  return cache;
};

exports.save = async function (body, username) {
  const b = body || {};
  const cur = await exports.get();
  const theme = b.theme == null ? cur.theme : String(b.theme);
  if (!THEMES.includes(theme)) throw Object.assign(new Error('Choose Light, Dark or Match system.'), { status: 400, expose: true });
  const next = Object.assign({}, cur, { theme, updatedBy: username || '', updatedAt: new Date().toISOString() });
  await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [KEY, JSON.stringify(next)]);
  cache = next;
  return next;
};

exports.THEMES = THEMES;
