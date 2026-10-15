// Service Monitor > Settings: options for every user of the add-on's pages, set by an administrator.
// Kept in SQLite app_meta ("servicemonitor.settings" -> JSON), so they survive restarts.
//   theme: 'light' | 'dark' | 'system' (follow the device's light / dark setting)
//   autoReset: clear the statistics of every monitor on a schedule (see models/autoreset.service.js)
//     { enabled, everyDays, at: 'HH:MM' (server time), checks, events, since, lastRunAt, lastResult: { checks, events } | null }
//     `since` is when the schedule was last turned on or changed: the first reset is everyDays after it.
const { run, get } = require('../../../app/core/config/sqlite');

const KEY = 'servicemonitor.settings';
const THEMES = ['light', 'dark', 'system'];
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_RESET = { enabled: false, everyDays: 30, at: '00:00', checks: true, events: true, since: null, lastRunAt: null, lastResult: null };
// Public status page (/status/<token>): view only, no sign-in. showTargets: show URLs / hosts and error texts.
// expandGroups: groups start open (true) or collapsed to their header and heartbeat bar (false).
const DEFAULT_SHARE = { enabled: false, token: '', title: 'Service Status', showTargets: false, expandGroups: true, updatedBy: '', updatedAt: null };
// Browser notifications (a monitor down / back up), offered on Service Health and on the public status page.
const DEFAULT_NOTIFY = { health: true, public: true };
const DEFAULTS = { theme: 'light', autoReset: DEFAULT_RESET, share: DEFAULT_SHARE, notify: DEFAULT_NOTIFY };

let cache = null;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

async function write(next) {
  await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [KEY, JSON.stringify(next)]);
  cache = next;
  return next;
}

exports.get = async function () {
  if (cache) return cache;
  const row = await get('SELECT value FROM app_meta WHERE key = ?', [KEY]);
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch (e) { stored = {}; }
  cache = Object.assign({}, DEFAULTS, stored, {
    autoReset: Object.assign({}, DEFAULT_RESET, stored.autoReset || {}),
    share: Object.assign({}, DEFAULT_SHARE, stored.share || {}),
    notify: Object.assign({}, DEFAULT_NOTIFY, stored.notify || {})
  });
  if (!THEMES.includes(cache.theme)) cache.theme = DEFAULTS.theme;
  return cache;
};

/** When the next automatic reset is due (a Date), or null while it is off. */
exports.nextReset = function (a) {
  if (!a || !a.enabled) return null;
  const base = new Date(a.lastRunAt || a.since || Date.now());
  const [h, m] = String(a.at || '00:00').split(':').map(Number);
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + a.everyDays, h, m, 0, 0);
  return next;
};

exports.save = async function (body, username) {
  const b = body || {};
  const cur = await exports.get();
  const theme = b.theme == null ? cur.theme : String(b.theme);
  if (!THEMES.includes(theme)) throw invalid('Choose Light, Dark or Match system.');

  let autoReset = cur.autoReset;
  if (b.autoReset) {
    const r = b.autoReset;
    const everyDays = parseInt(r.everyDays, 10);
    if (!(everyDays >= 1 && everyDays <= 365)) throw invalid('Auto reset: "every" must be between 1 and 365 days.');
    const at = String(r.at || '');
    if (!AT_RE.test(at)) throw invalid('Auto reset: the time must be HH:MM, e.g. 00:00.');
    const checks = r.checks !== false, events = r.events !== false;
    const enabled = !!r.enabled;
    if (enabled && !checks && !events) throw invalid('Auto reset: choose what to clear, check history, incidents or both.');
    // A schedule turned on or changed starts counting from now.
    const changed = enabled && (!cur.autoReset.enabled || cur.autoReset.everyDays !== everyDays || cur.autoReset.at !== at);
    autoReset = Object.assign({}, cur.autoReset, { enabled, everyDays, at, checks, events }, changed ? { since: new Date().toISOString(), lastRunAt: null } : {});
  }
  const notify = b.notify ? { health: b.notify.health !== false, public: b.notify.public !== false } : cur.notify;
  return write(Object.assign({}, cur, { theme, autoReset, notify, updatedBy: username || '', updatedAt: new Date().toISOString() }));
};

/** Records an automatic reset that ran. */
/**
 * The public status page: { enabled, title, showTargets, regenerate }. A token is made the first time it is
 * turned on; regenerate makes a new one (the old link stops working).
 */
exports.saveShare = async function (body, username) {
  const b = body || {};
  const cur = await exports.get();
  const title = String(b.title == null ? cur.share.title : b.title).trim().slice(0, 80) || DEFAULT_SHARE.title;
  const enabled = b.enabled == null ? cur.share.enabled : !!b.enabled;
  let token = cur.share.token;
  if (!token || b.regenerate) token = require('crypto').randomBytes(18).toString('base64url');
  const share = {
    enabled, token, title,
    showTargets: b.showTargets == null ? cur.share.showTargets : !!b.showTargets,
    expandGroups: b.expandGroups == null ? cur.share.expandGroups !== false : !!b.expandGroups,
    updatedBy: username || '', updatedAt: new Date().toISOString()
  };
  return write(Object.assign({}, cur, { share }));
};

/** The share settings when `token` is the live public link, else null. */
exports.shareFor = async function (token) {
  const s = (await exports.get()).share;
  if (!s.enabled || !s.token || typeof token !== 'string' || token.length !== s.token.length) return null;
  return require('crypto').timingSafeEqual(Buffer.from(token), Buffer.from(s.token)) ? s : null;
};

exports.recordAutoReset = async function (result) {
  const cur = await exports.get();
  return write(Object.assign({}, cur, { autoReset: Object.assign({}, cur.autoReset, { lastRunAt: new Date().toISOString(), lastResult: result }) }));
};

exports.THEMES = THEMES;
