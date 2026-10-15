// Service Monitor > Service Health: the dashboard of services by group, and their create / edit /
// delete, pause, check now and certificate details. Everything is in SQLite (no Mongo connection).
const view = require('../../../app/core/view').addon('servicemonitor');
const { actionsFor } = require('../../../app/core/permissions');
const model = require('../models/services.model');
const checker = require('../models/checker.service');
const settings = require('../models/settings.model');

const LINK = '/service-monitor';
const HOURS = [1, 6, 24, 72, 168];

const username = (req) => (req.user && req.user.username) || '';
const id = (req) => parseInt(req.params.id, 10);

// Errors marked expose (bad input, not found) go to the page as they are; others are logged.
function fail(res, err, what) {
  if (err && err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`Service Monitor: ${what}:`, err);
  return res.status(500).json({ error: `The ${what} failed. The details are in the server log.` });
}

exports.index = async function (req, res) {
  return res.renderPage(view('servicemonitor'), {
    theme: (await settings.get()).theme,
    notifyAllowed: (await settings.get()).notify.health !== false,
    isAdmin: !!req.user && req.user.role === require('../../../app/core/permissions').ADMIN_ROLE,
    title: 'Service Health',
    can: actionsFor(req.user, LINK),
    dnsTypes: model.DNS_TYPES,
    checkDays: model.CHECK_DAYS
  });
};

exports.data = async function (req, res) {
  try {
    res.json(await model.dashboard());
  } catch (err) { fail(res, err, 'reading of the services'); }
};

exports.detail = async function (req, res) {
  try {
    const hours = HOURS.includes(parseInt(req.query.hours, 10)) ? parseInt(req.query.hours, 10) : 24;
    const d = await model.detail(id(req), hours);
    if (!d) return res.status(404).json({ error: 'Service not found.' });
    res.json(d);
  } catch (err) { fail(res, err, 'reading of the service'); }
};

// Create: saved, then checked once at once so the page shows a status straight away.
exports.create = async function (req, res) {
  try {
    const row = await model.create(model.normalize(req.body), username(req));
    const service = row.enabled ? await checker.checkNow(row, { forceCert: true }).catch(() => model.get(row.id)) : model.view(row);
    res.json({ service });
  } catch (err) { fail(res, err, 'saving of the service'); }
};

exports.update = async function (req, res) {
  try {
    const row = await model.update(id(req), model.normalize(req.body), username(req));
    if (!row) return res.status(404).json({ error: 'Service not found.' });
    const service = row.enabled ? await checker.checkNow(row, { forceCert: true }).catch(() => model.get(row.id)) : model.view(row);
    res.json({ service });
  } catch (err) { fail(res, err, 'saving of the service'); }
};

exports.toggle = async function (req, res) {
  try {
    const row = await model.setEnabled(id(req), !!(req.body && req.body.enabled), username(req));
    if (!row) return res.status(404).json({ error: 'Service not found.' });
    res.json({ service: model.view(row) });
  } catch (err) { fail(res, err, 'change of the service'); }
};

exports.remove = async function (req, res) {
  try {
    if (!(await model.remove(id(req)))) return res.status(404).json({ error: 'Service not found.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'deletion of the service'); }
};

exports.check = async function (req, res) {
  try {
    const row = await model.raw(id(req));
    if (!row) return res.status(404).json({ error: 'Service not found.' });
    res.json({ service: await checker.checkNow(row, { forceCert: true }) });
  } catch (err) { fail(res, err, 'check'); }
};

// Every enabled service (of one group with ?group=), at most 8 at a time.
exports.checkAll = async function (req, res) {
  try {
    const group = req.body && req.body.groupId != null ? String(req.body.groupId) : null;
    const rows = (await model.enabled()).filter((s) => group == null || String(s.group_id || '') === (group === '0' ? '' : group));
    for (let i = 0; i < rows.length; i += 8) {
      await Promise.all(rows.slice(i, i + 8).map((s) => checker.checkNow(s, { forceCert: true }).catch(() => null)));
    }
    res.json({ checked: rows.length });
  } catch (err) { fail(res, err, 'check'); }
};

// Try a service form without saving it.
exports.test = async function (req, res) {
  try {
    const f = model.normalize(req.body);
    const { result, cert, domain } = await checker.probe(Object.assign({ id: 0 }, f));
    const days = (iso) => (iso ? Math.floor((new Date(iso).getTime() - Date.now()) / 86400000) : null);
    res.json({
      result,
      cert: cert ? Object.assign(cert, { daysLeft: days(cert.validTo) }) : null,
      domain: domain ? Object.assign(domain, { daysLeft: days(domain.expiresAt) }) : null
    });
  } catch (err) { fail(res, err, 'test'); }
};

exports.saveGroup = async function (req, res) {
  try {
    res.json({ group: await model.saveGroup(req.params.id ? id(req) : null, req.body || {}) });
  } catch (err) { fail(res, err, 'saving of the group'); }
};

exports.removeGroup = async function (req, res) {
  try {
    if (!(await model.removeGroup(id(req)))) return res.status(404).json({ error: 'Group not found.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'deletion of the group'); }
};

// ---- Reset statistics ----

const RESET_AGES = [0, 1, 7, 30];       // days: 0 = everything

// The reset form -> { ids, before, checks, events, label }; throws a 400 on bad input.
async function resetRequest(body) {
  const b = body || {};
  const scope = ['all', 'group', 'service'].includes(b.scope) ? b.scope : 'all';
  const ids = await model.resetIds({ scope, groupId: parseInt(b.groupId, 10) || 0, serviceId: parseInt(b.serviceId, 10) || 0 });
  const age = RESET_AGES.includes(parseInt(b.olderThanDays, 10)) ? parseInt(b.olderThanDays, 10) : 0;
  const checks = b.checks !== false, events = b.events !== false;
  if (!checks && !events) throw Object.assign(new Error('Choose what to clear: check history, incidents or both.'), { status: 400, expose: true });
  return {
    ids, checks, events,
    before: age ? new Date(Date.now() - age * 86400000).toISOString() : null,
    label: `${scope}${scope === 'group' ? ' ' + (parseInt(b.groupId, 10) || 0) : scope === 'service' ? ' ' + parseInt(b.serviceId, 10) : ''}${age ? `, older than ${age} d` : ''}`
  };
}

exports.resetPreview = async function (req, res) {
  try {
    res.json(await model.resetPreview(await resetRequest(req.body)));
  } catch (err) { fail(res, err, 'reset preview'); }
};

exports.reset = async function (req, res) {
  try {
    const r = await resetRequest(req.body);
    const done = await model.reset(r);
    console.log(`Service Monitor: statistics reset by ${username(req)} (${r.label}): ${done.checks} checks, ${done.events} incidents deleted.`);
    res.json(done);
  } catch (err) { fail(res, err, 'reset'); }
};

// ---- Settings (administrators only) ----

// The settings as the page sees them, with when the next automatic reset is due.
const settingsView = (s) => {
  const next = settings.nextReset(s.autoReset);
  return {
    theme: s.theme, notify: s.notify, updatedBy: s.updatedBy || '', updatedAt: s.updatedAt || '',
    autoReset: Object.assign({}, s.autoReset, { nextAt: next ? next.toISOString() : null })
  };
};

exports.settingsIndex = async function (req, res) {
  const s = await settings.get();
  return res.renderPage(view('settings'), { title: 'Service Monitor Settings', theme: s.theme, saved: settingsView(s), checkDays: model.CHECK_DAYS });
};

exports.settingsSave = async function (req, res) {
  try {
    res.json(settingsView(await settings.save(req.body, username(req))));
  } catch (err) { fail(res, err, 'saving of the settings'); }
};

// ---- Settings > Import from Uptime Kuma (administrators only) ----

const kuma = require('../models/kuma.import');

exports.kumaPreview = async function (req, res) {
  try {
    const p = await kuma.plan(req.body && req.body.backup);
    res.json({ groups: p.groups, rows: p.rows.map((r) => { const o = Object.assign({}, r); delete o.fields; return o; }) });
  } catch (err) { fail(res, err, 'reading of the backup'); }
};

exports.kumaImport = async function (req, res) {
  try {
    const result = await kuma.run(req.body && req.body.backup, { includeExisting: !!(req.body && req.body.includeExisting) }, username(req));
    console.log(`Service Monitor: Uptime Kuma import by ${username(req)}: ${result.imported} monitors, ${result.createdGroups} new groups (${result.skipped} skipped, ${result.existing} already monitored).`);
    res.json(result);
  } catch (err) { fail(res, err, 'import'); }
};

// ---- Settings > Backup & restore (administrators only) ----

const backup = require('../models/backup.service');

exports.backupDownload = async function (req, res) {
  try {
    const b = await backup.build(username(req));
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="service-monitor-backup-${day}.json"`);
    res.send(JSON.stringify(b, null, 2));
  } catch (err) { fail(res, err, 'backup'); }
};

// The restore requests carry the backup file as text/plain (larger than the app's JSON body limit);
// the options come in the query string.
exports.restorePreview = async function (req, res) {
  try {
    res.json(await backup.plan(backup.parse(req.body), { mode: req.query.mode }));
  } catch (err) { fail(res, err, 'reading of the backup'); }
};

exports.restore = async function (req, res) {
  try {
    const q = req.query;
    if (q.mode === 'replace' && q.confirm !== 'replace') {
      return res.status(400).json({ error: 'Replacing every monitor needs the confirmation ticked.' });
    }
    const result = await backup.run(backup.parse(req.body), { mode: q.mode, includeExisting: q.includeExisting === '1', restoreSettings: q.settings === '1' }, username(req));
    console.log(`Service Monitor: restore (${result.mode}) by ${username(req)}: ${result.imported} monitors, ${result.createdGroups} groups` +
      (result.mode === 'replace' ? `, after deleting ${result.removed.monitors} monitors and ${result.removed.groups} groups` : '') + (result.settings ? ', settings restored' : '') + '.');
    res.json(result);
  } catch (err) { fail(res, err, 'restore'); }
};

// ---- Share: the public, view-only status page (/status/<token>) ----

const path = require('path');

const shareView = (s, req) => ({
  enabled: s.enabled, title: s.title, showTargets: s.showTargets, expandGroups: s.expandGroups !== false, updatedBy: s.updatedBy, updatedAt: s.updatedAt,
  url: s.token ? `${req.protocol}://${req.get('host')}/status/${s.token}` : ''
});

exports.shareGet = async function (req, res) {
  try { res.json(shareView((await settings.get()).share, req)); } catch (err) { fail(res, err, 'reading of the share settings'); }
};

exports.shareSave = async function (req, res) {
  try {
    const s = (await settings.saveShare(req.body, username(req))).share;
    console.log(`Service Monitor: public status page ${s.enabled ? 'on' : 'off'}${req.body && req.body.regenerate ? ', new link' : ''} (by ${username(req)}).`);
    res.json(shareView(s, req));
  } catch (err) { fail(res, err, 'saving of the share settings'); }
};

// The public page: a standalone file (no app layout, no sign-in); it reads its data from /status/<token>/data.
exports.publicPage = async function (req, res) {
  if (!(await settings.shareFor(req.params.token))) return res.status(404).type('text').send('This status page is not available.');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.sendFile(path.join(__dirname, '..', 'views', 'status.html'));
};

// Only what a status page needs: names, statuses, heartbeats, uptime and response times. Targets (URLs, hosts)
// and error texts, which tell internal addresses, only with "show targets". No ids, settings or certificates.
// A monitor's reference on the public page: derived from the share token, so it tells nothing of the monitor's
// id and changes with a new link.
const publicRef = (token, id) => require('crypto').createHmac('sha256', token).update('monitor:' + id).digest('base64url').slice(0, 12);

// One monitor, view only: its public fields, checks of the last `hours` and status changes. Codes, error texts
// and causes only with "show targets".
exports.publicDetail = async function (req, res) {
  try {
    const share = await settings.shareFor(req.params.token);
    if (!share) return res.status(404).json({ error: 'This status page is not available.' });
    const d = await model.dashboard();
    const m = d.services.find((x) => publicRef(share.token, x.id) === req.params.ref);
    if (!m) return res.status(404).json({ error: 'This service is not on the status page.' });
    const hours = HOURS.includes(parseInt(req.query.hours, 10)) ? parseInt(req.query.hours, 10) : 24;
    const det = await model.detail(m.id, hours);
    const t = share.showTargets;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json({
      hours,
      service: Object.assign({
        ref: req.params.ref, name: m.name, status: m.status, kind: m.type === 'http' ? (/^https:/i.test(m.target) ? 'HTTPS' : 'HTTP') : m.type.toUpperCase(),
        intervalSec: m.intervalSec, uptime24: m.uptime24, uptime7: m.uptime7, avgMs24: m.avgMs24, lastMs: m.lastMs,
        lastCheckedAt: m.lastCheckedAt, lastChangeAt: m.lastChangeAt
      }, t ? { target: m.target, error: m.status === 'up' ? '' : m.lastError } : {}),
      checks: det.checks.map((c) => Object.assign({ at: c.at, status: c.status, ms: c.ms }, t ? { code: c.code, error: c.error } : {})),
      events: det.events.map((e) => Object.assign({ at: e.at, from: e.from, to: e.to }, t ? { message: e.message } : {}))
    });
  } catch (err) { fail(res, err, 'reading of the service'); }
};

exports.publicData = async function (req, res) {
  try {
    const share = await settings.shareFor(req.params.token);
    if (!share) return res.status(404).json({ error: 'This status page is not available.' });
    const [d, s] = await Promise.all([model.dashboard(), settings.get()]);
    const known = new Set(d.groups.map((g) => g.id));
    const ref = new Map(d.services.map((m) => [m.id, publicRef(share.token, m.id)]));
    const kind = (m) => (m.type === 'http' ? (/^https:/i.test(m.target) ? 'HTTPS' : 'HTTP') : m.type === 'dns' ? 'DNS' : m.type === 'tcp' ? 'TCP' : 'PING');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json({
      title: share.title, theme: s.theme, showTargets: share.showTargets, expandGroups: share.expandGroups !== false, notify: s.notify.public !== false, now: d.now,
      groups: d.groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
      services: d.services.map((m) => Object.assign({
        ref: ref.get(m.id), group: known.has(m.groupId) ? m.groupId : 0, name: m.name, kind: kind(m), status: m.status,
        lastMs: m.lastMs, avgMs24: m.avgMs24, uptime24: m.uptime24, uptime7: m.uptime7, lastCheckedAt: m.lastCheckedAt, lastChangeAt: m.lastChangeAt,
        spark: m.spark.map((c) => ({ s: c.s, ms: c.ms, at: c.at }))
      }, share.showTargets ? { target: m.target, error: m.status === 'up' ? '' : m.lastError } : {})),
      events: d.events.slice(0, 20).map((e) => Object.assign({ ref: ref.get(e.serviceId) || 0, name: e.name, at: e.at, from: e.from, to: e.to },
        share.showTargets ? { message: e.message } : {}))
    });
  } catch (err) { fail(res, err, 'reading of the status page'); }
};
