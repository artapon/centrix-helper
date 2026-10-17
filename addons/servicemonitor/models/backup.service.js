// Service Monitor > Settings > Backup & restore: the organizations, groups, monitors (every setting, no history)
// and the add-on's settings as one JSON file, and restoring one: added to what is here, or replacing it.
//   { app: 'centrix-service-monitor', version: 2, exportedAt, exportedBy, settings,
//     organizations: [...], groups: [{ ..., organization }], monitors: [{ ..., organization, group }] }
// Groups and monitors refer to their organization and group by name. Version 1 files have no organizations.
// A restore goes into one organization (an existing one or a new one), or, "as in the backup", into the
// backup's own organizations (by name, made when missing; a version 1 file's monitors go to the first one here).
// Restoring goes through services.normalize(), as the form does.
const services = require('./services.model');
const settings = require('./settings.model');

const APP = 'centrix-service-monitor';
const VERSION = 2;
const MAX_MONITORS = 5000;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

const lower = (v) => String(v || '').toLowerCase();

/** The backup of everything here, as an object (the controller sends it as a file). */
exports.build = async function (username) {
  const [dash, groups, s] = await Promise.all([services.dashboard(), services.groups(), settings.get()]);
  const orgName = new Map(dash.orgs.map((o) => [o.id, o.name]));
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
    organizations: dash.orgs.map((o) => ({ name: o.name, description: o.description || '', color: o.color, sortOrder: o.sortOrder })),
    groups: groups.map((g) => ({ organization: orgName.get(g.orgId) || '', name: g.name, description: g.description || '', color: g.color, sortOrder: g.sortOrder })),
    monitors: dash.services.map((m) => ({
      organization: orgName.get(m.orgId) || '', name: m.name, group: groupName.get(m.groupId) || '', type: m.type, target: m.target,
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
 * Where each monitor and group of the backup goes: { single, org (single only), orgName(x) }.
 * target: { asBackup } the backup's own organizations, { orgId } an existing one, { newOrg } a new one by name.
 */
async function destination(b, target) {
  const orgs = await services.orgs();
  if (target && target.asBackup) {
    const first = orgs[0].name;
    return { single: false, orgName: (x) => String((x && x.organization) || '').trim().slice(0, 80) || first };
  }
  const org = await services.importOrg(target || {});
  return { single: true, org, orgName: () => org.name };
}

/**
 * What a restore would do. mode 'add': monitors already in their organization here (same type and target) are
 * 'exists'; mode 'replace': the monitors and groups of the organizations restored into go first (all of them
 * "as in the backup"), so every valid monitor is restored.
 * { mode, into, orgs: [{ name, exists }], groups: [{ name, organization, exists }],
 *   rows: [{ i, name, type, target, organization, group, enabled, action, reason }], settings, current }
 */
exports.plan = async function (b, { mode = 'add', asBackup = false, orgId = 0, newOrg = '' } = {}) {
  const replace = mode === 'replace';
  const dest = await destination(b, { asBackup, orgId, newOrg });
  const [dash, groups] = await Promise.all([services.dashboard(), services.groups()]);
  const orgId2name = new Map(dash.orgs.map((o) => [o.id, lower(o.name)]));
  const here = (dest.single ? [dest.org] : dash.orgs).filter((o) => o.id);
  const hereIds = new Set(here.map((o) => o.id));
  // what 'replace' deletes: the monitors and groups of the destination organizations
  const current = {
    monitors: dash.services.filter((s) => (dest.single ? hereIds.has(s.orgId) : true)).length,
    groups: groups.filter((g) => (dest.single ? hereIds.has(g.orgId) : true)).length
  };
  const key = (org, type, target) => lower(org) + '|' + type + '|' + lower(target);
  const exist = new Set(replace ? [] : dash.services.map((s) => key(orgId2name.get(s.orgId), s.type, s.target)));
  const inFile = new Map();
  const rows = b.monitors.map((m, i) => {
    const organization = dest.orgName(m);
    const row = { i, name: String((m && m.name) || 'Unnamed monitor'), type: String((m && m.type) || ''), target: String((m && m.target) || ''), organization, group: String((m && m.group) || ''), enabled: !(m && m.enabled === false) };
    let f;
    try { f = services.normalize(Object.assign({}, m || {}, { orgId: null, groupId: null })); } catch (err) { return Object.assign(row, { action: 'skip', reason: err.message }); }
    row.target = f.target;
    const k = key(organization, f.type, f.target);
    if (exist.has(k)) return Object.assign(row, { action: 'exists', reason: 'Already monitored in this organization (same type and target)' });
    if (inFile.has(k)) return Object.assign(row, { action: 'skip', reason: `Same type and target as "${inFile.get(k)}" in this backup` });
    inFile.set(k, row.name);
    return Object.assign(row, { action: 'import' });
  });
  // groups: the backup's and those a monitor names, each in its organization
  const gkeys = new Map();
  (b.groups || []).concat(b.monitors.filter((m) => m && m.group).map((m) => ({ organization: m.organization, name: m.group })))
    .forEach((g) => {
      const name = String((g && g.name) || '').trim();
      if (!name) return;
      const organization = dest.orgName(g);
      const k = lower(organization) + '|' + lower(name);
      if (!gkeys.has(k)) {
        const exists = !replace && groups.some((x) => lower(x.name) === lower(name) && orgId2name.get(x.orgId) === lower(organization));
        gkeys.set(k, { name, organization, exists });
      }
    });
  const orgNames = [...new Set(rows.map((r) => r.organization).concat([...gkeys.values()].map((g) => g.organization)))];
  return {
    mode: replace ? 'replace' : 'add',
    asBackup: !dest.single,
    into: dest.single ? dest.org.name : 'as in the backup',
    orgs: orgNames.map((name) => ({ name, exists: dash.orgs.some((o) => lower(o.name) === lower(name)) })),
    groups: [...gkeys.values()],
    rows,
    settings: b.settings ? { theme: b.settings.theme, autoReset: !!(b.settings.autoReset && b.settings.autoReset.enabled) } : null,
    current,
    exportedAt: b.exportedAt || null, exportedBy: b.exportedBy || ''
  };
};

/**
 * Restores a backup (target and mode as for plan()). 'replace' deletes the monitors (with their history) and
 * groups of the destination organizations first. restoreSettings: also the theme and the auto reset schedule.
 * Returns the counts.
 */
exports.run = async function (b, { mode = 'add', asBackup = false, orgId = 0, newOrg = '', includeExisting = false, restoreSettings = false } = {}, username) {
  const p = await exports.plan(b, { mode, asBackup, orgId, newOrg });
  const removed = { monitors: 0, groups: 0 };
  // the organizations, by name: existing ones, and new ones made (with the backup's colour and order) when needed
  const fromFile = new Map((b.organizations || []).map((o) => [lower(o && o.name), o || {}]));
  const orgIds = new Map((await services.orgs()).map((o) => [lower(o.name), o.id]));
  let createdOrgs = 0;
  const orgOf = async (name) => {
    if (!orgIds.has(lower(name))) {
      const o = fromFile.get(lower(name)) || {};
      const saved = await services.importOrg({ newOrg: name }, true, { description: o.description || '', color: o.color, sortOrder: o.sortOrder });
      orgIds.set(lower(name), saved.id);
      createdOrgs++;
    }
    return orgIds.get(lower(name));
  };
  if (p.mode === 'replace') {
    const ids = new Set(p.asBackup ? [...orgIds.values()] : [orgIds.get(lower(p.into))].filter(Boolean));
    for (const s of (await services.dashboard()).services) if (ids.has(s.orgId)) { await services.remove(s.id); removed.monitors++; }
    for (const g of await services.groups()) if (ids.has(g.orgId)) { await services.removeGroup(g.id); removed.groups++; }
  }
  // Groups: the backup's (colour, order, description), then any a monitor names; existing ones are reused by name.
  const groupIds = new Map((await services.groups()).map((g) => [g.orgId + '|' + lower(g.name), g.id]));
  let createdGroups = 0;
  const ensure = async (organization, g) => {
    if (!g.name) return null;
    const oid = await orgOf(organization);
    const k = oid + '|' + lower(g.name);
    if (!groupIds.has(k)) {
      const saved = await services.saveGroup(null, { orgId: oid, name: g.name, description: g.description || '', color: g.color, sortOrder: g.sortOrder == null ? groupIds.size : g.sortOrder });
      groupIds.set(k, saved.id);
      createdGroups++;
    }
    return groupIds.get(k);
  };
  const dest = await destination(b, { asBackup, orgId, newOrg });
  const todo = p.rows.filter((r) => r.action === 'import' || (includeExisting && r.action === 'exists'));
  if (todo.length) {
    for (const g of b.groups || []) await ensure(dest.orgName(g), { name: String((g && g.name) || '').trim(), description: g.description, color: g.color, sortOrder: g.sortOrder });
  }

  let imported = 0;
  for (const r of todo) {
    const m = b.monitors[r.i];
    const oid = await orgOf(r.organization);
    const groupId = m.group ? await ensure(r.organization, { name: String(m.group).trim() }) : null;
    const fields = services.normalize(Object.assign({}, m, { orgId: oid, groupId }));
    await services.create(fields, username);
    imported++;
  }
  if (restoreSettings && b.settings) {
    await settings.save({ theme: b.settings.theme, autoReset: Object.assign({ enabled: false, everyDays: 30, at: '00:00', checks: true, events: true }, b.settings.autoReset || {}) }, username);
  }
  return {
    mode: p.mode, into: p.into, imported, createdOrgs, createdGroups, removed,
    skipped: p.rows.filter((r) => r.action === 'skip').length,
    existing: includeExisting ? 0 : p.rows.filter((r) => r.action === 'exists').length,
    settings: !!(restoreSettings && b.settings)
  };
};
