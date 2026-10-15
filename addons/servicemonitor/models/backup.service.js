// Service Monitor > Settings > Backup & restore: the groups, monitors (every setting, no history) and the
// add-on's settings as one JSON file, and restoring one: added to what is here, or replacing it.
//   { app: 'centrix-service-monitor', version: 1, exportedAt, exportedBy, settings, groups: [...], monitors: [...] }
// Monitors refer to their group by name. Restoring goes through services.normalize(), as the form does.
const services = require('./services.model');
const settings = require('./settings.model');

const APP = 'centrix-service-monitor';
const VERSION = 1;
const MAX_MONITORS = 5000;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

/** The backup of everything here, as an object (the controller sends it as a file). */
exports.build = async function (username) {
  const [dash, groups, s] = await Promise.all([services.dashboard(), services.groups(), settings.get()]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return {
    app: APP,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: username || '',
    settings: {
      theme: s.theme,
      autoReset: { enabled: !!s.autoReset.enabled, everyDays: s.autoReset.everyDays, at: s.autoReset.at, checks: s.autoReset.checks, events: s.autoReset.events }
    },
    groups: groups.map((g) => ({ name: g.name, description: g.description || '', color: g.color, sortOrder: g.sortOrder })),
    monitors: dash.services.map((m) => ({
      name: m.name, group: groupName.get(m.groupId) || '', type: m.type, target: m.target,
      method: m.method, expectedStatus: m.expectedStatus, keyword: m.keyword, maxRedirects: m.maxRedirects || 0,
      dnsType: m.dnsType, dnsServer: m.dnsServer,
      intervalSec: m.intervalSec, retries: m.retries, retryIntervalSec: m.retryIntervalSec, timeoutMs: m.timeoutMs, slowMs: m.slowMs,
      checkCert: m.checkCert, certWarnDays: m.certWarnDays, certCritDays: m.certCritDays,
      checkDomain: m.checkDomain, domainWarnDays: m.domainWarnDays, domainCritDays: m.domainCritDays,
      ignoreTls: m.ignoreTls, enabled: m.enabled, notes: m.notes
    }))
  };
};

/** Parses and checks a backup file's text. */
exports.parse = function (text) {
  let b;
  try { b = JSON.parse(String(text || '')); } catch (e) { throw invalid('This file is not JSON. Choose a .json file made with Backup.'); }
  if (!b || b.app !== APP || !Array.isArray(b.monitors)) throw invalid('This is not a Service Monitor backup. Choose a .json file made with Settings › Backup.');
  if (b.version > VERSION) throw invalid(`This backup was made by a newer version of Service Monitor (format ${b.version}).`);
  if (b.monitors.length > MAX_MONITORS) throw invalid(`The backup has more than ${MAX_MONITORS} monitors.`);
  return b;
};

/**
 * What a restore would do. mode 'add': monitors already here (same type and target) are 'exists';
 * mode 'replace': everything here goes first, so every valid monitor is imported.
 * { mode, groups: [{ name, exists }], rows: [{ i, name, type, target, group, enabled, action, reason }], settings, current }
 */
exports.plan = async function (b, { mode = 'add' } = {}) {
  const replace = mode === 'replace';
  const [dash, groups] = await Promise.all([services.dashboard(), services.groups()]);
  const here = new Set(replace ? [] : dash.services.map((s) => s.type + '|' + s.target.toLowerCase()));
  const inFile = new Map();
  const rows = b.monitors.map((m, i) => {
    const row = { i, name: String((m && m.name) || 'Unnamed monitor'), type: String((m && m.type) || ''), target: String((m && m.target) || ''), group: String((m && m.group) || ''), enabled: !(m && m.enabled === false) };
    let f;
    try { f = services.normalize(m || {}); } catch (err) { return Object.assign(row, { action: 'skip', reason: err.message }); }
    row.target = f.target;
    const key = f.type + '|' + f.target.toLowerCase();
    if (here.has(key)) return Object.assign(row, { action: 'exists', reason: 'Already monitored (same type and target)' });
    if (inFile.has(key)) return Object.assign(row, { action: 'skip', reason: `Same type and target as "${inFile.get(key)}" in this backup` });
    inFile.set(key, row.name);
    return Object.assign(row, { action: 'import' });
  });
  const names = [...new Set((b.groups || []).map((g) => String(g.name || '')).concat(rows.map((r) => r.group)).filter(Boolean))];
  return {
    mode: replace ? 'replace' : 'add',
    groups: names.map((name) => ({ name, exists: !replace && groups.some((g) => g.name.toLowerCase() === name.toLowerCase()) })),
    rows,
    settings: b.settings ? { theme: b.settings.theme, autoReset: !!(b.settings.autoReset && b.settings.autoReset.enabled) } : null,
    current: { monitors: dash.services.length, groups: groups.length },
    exportedAt: b.exportedAt || null, exportedBy: b.exportedBy || ''
  };
};

/**
 * Restores a backup. 'replace' deletes every monitor (with its history) and group here first.
 * restoreSettings: also the theme and the auto reset schedule. Returns the counts.
 */
exports.run = async function (b, { mode = 'add', includeExisting = false, restoreSettings = false } = {}, username) {
  const p = await exports.plan(b, { mode });
  const removed = { monitors: 0, groups: 0 };
  if (p.mode === 'replace') {
    for (const s of (await services.dashboard()).services) { await services.remove(s.id); removed.monitors++; }
    for (const g of await services.groups()) { await services.removeGroup(g.id); removed.groups++; }
  }
  // Groups: the backup's (colour, order, description), then any a monitor names; existing ones are reused by name.
  const ids = new Map((await services.groups()).map((g) => [g.name.toLowerCase(), g.id]));
  let createdGroups = 0;
  const ensure = async (g) => {
    const key = g.name.toLowerCase();
    if (!g.name || ids.has(key)) return;
    const saved = await services.saveGroup(null, { name: g.name, description: g.description || '', color: g.color, sortOrder: g.sortOrder == null ? ids.size : g.sortOrder });
    ids.set(key, saved.id);
    createdGroups++;
  };
  for (const g of b.groups || []) await ensure({ name: String(g.name || ''), description: g.description, color: g.color, sortOrder: g.sortOrder });

  let imported = 0;
  for (const r of p.rows) {
    if (!(r.action === 'import' || (includeExisting && r.action === 'exists'))) continue;
    const m = b.monitors[r.i];
    if (m.group) await ensure({ name: String(m.group) });
    const fields = services.normalize(Object.assign({}, m, { groupId: m.group ? ids.get(String(m.group).toLowerCase()) : null }));
    await services.create(fields, username);
    imported++;
  }
  if (restoreSettings && b.settings) {
    await settings.save({ theme: b.settings.theme, autoReset: Object.assign({ enabled: false, everyDays: 30, at: '00:00', checks: true, events: true }, b.settings.autoReset || {}) }, username);
  }
  return {
    mode: p.mode, imported, createdGroups, removed,
    skipped: p.rows.filter((r) => r.action === 'skip').length,
    existing: includeExisting ? 0 : p.rows.filter((r) => r.action === 'exists').length,
    settings: !!(restoreSettings && b.settings)
  };
};
