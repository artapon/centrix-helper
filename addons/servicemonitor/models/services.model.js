// Service Monitor: the groups, the services and their check history, in SQLite.
//   sm_groups    a named, coloured group of services (a service without one is "Ungrouped")
//   sm_services  what to check and how, plus its latest result, certificate and domain registration
//   sm_checks    one row per check (kept CHECK_DAYS days) for uptime and response-time history
//   sm_events    a row each time a service's settled status changes (incidents, kept EVENT_DAYS days)
// Retries: a failed check of a service that is not down yet makes it 'retry' (checked again after
// retry_interval_sec) until more than `retries` checks in a row failed; only then it is 'down'.
// `settled` is the last status other than 'retry', so up -> retry -> up is no incident.
// Times are ISO strings in UTC, so they sort and compare as text.
const net = require('net');
const { run, get, all } = require('../../../app/core/config/sqlite');

const CHECK_DAYS = 14;
const EVENT_DAYS = 180;
const SPARK = 60;                   // checks shown in each service's heartbeat bar
const TYPES = ['http', 'tcp', 'ping', 'dns'];
const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
const HOST_RE = /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,62})(\.[a-z0-9_]([a-z0-9_-]{0,62}))*\.?$/i;
const METHODS = ['GET', 'HEAD', 'POST'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const OK = "('up', 'slow', 'retry')";       // statuses that count as answered (uptime)
const DASHBOARD_TTL_MS = 3000;          // every open Service Health page shares one read for this long

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS sm_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#2563eb',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`);
      await run(`
        CREATE TABLE IF NOT EXISTS sm_services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'http',
          target TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT 'GET',
          expected_status TEXT NOT NULL DEFAULT '200-399',
          keyword TEXT NOT NULL DEFAULT '',
          dns_type TEXT NOT NULL DEFAULT 'A',
          dns_server TEXT NOT NULL DEFAULT '',
          timeout_ms INTEGER NOT NULL DEFAULT 10000,
          interval_sec INTEGER NOT NULL DEFAULT 60,
          retries INTEGER NOT NULL DEFAULT 0,
          retry_interval_sec INTEGER NOT NULL DEFAULT 0,
          slow_ms INTEGER NOT NULL DEFAULT 0,
          check_cert INTEGER NOT NULL DEFAULT 1,
          check_domain INTEGER NOT NULL DEFAULT 0,
          cert_warn_days INTEGER NOT NULL DEFAULT 30,
          cert_crit_days INTEGER NOT NULL DEFAULT 7,
          ignore_tls INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          notes TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          last_checked_at TEXT,
          last_ms INTEGER,
          last_code INTEGER,
          last_error TEXT NOT NULL DEFAULT '',
          last_change_at TEXT,
          fail_count INTEGER NOT NULL DEFAULT 0,
          settled TEXT NOT NULL DEFAULT 'pending',
          cert TEXT,
          cert_checked_at TEXT,
          domain TEXT,
          domain_checked_at TEXT
        )`);
      await run(`
        CREATE TABLE IF NOT EXISTS sm_checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_id INTEGER NOT NULL,
          at TEXT NOT NULL,
          status TEXT NOT NULL,
          ms INTEGER,
          code INTEGER,
          error TEXT NOT NULL DEFAULT ''
        )`);
      await run('CREATE INDEX IF NOT EXISTS idx_sm_checks_service ON sm_checks (service_id, id)');
      await run('CREATE INDEX IF NOT EXISTS idx_sm_checks_at ON sm_checks (at)');
      await run(`
        CREATE TABLE IF NOT EXISTS sm_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_id INTEGER NOT NULL,
          at TEXT NOT NULL,
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT ''
        )`);
      await run('CREATE INDEX IF NOT EXISTS idx_sm_events_service ON sm_events (service_id, id)');
      // Domain expiry thresholds of their own (they first shared the certificate's).
      const cols = new Set((await all('PRAGMA table_info(sm_services)')).map((c) => c.name));
      if (!cols.has('domain_warn_days')) await run('ALTER TABLE sm_services ADD COLUMN domain_warn_days INTEGER NOT NULL DEFAULT 30');
      if (!cols.has('domain_crit_days')) await run('ALTER TABLE sm_services ADD COLUMN domain_crit_days INTEGER NOT NULL DEFAULT 7');
      // HTTP: redirects to follow before judging the page (0 = judge the redirect itself by the accepted codes)
      if (!cols.has('max_redirects')) await run('ALTER TABLE sm_services ADD COLUMN max_redirects INTEGER NOT NULL DEFAULT 0');
      // Hourly totals per monitor (hour = 'YYYY-MM-DDTHH', UTC), kept up to date by record(): uptime and average
      // response read these instead of scanning every check. Filled from sm_checks once, when it is created.
      const hourlyExists = await get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sm_hourly'");
      await run(`
        CREATE TABLE IF NOT EXISTS sm_hourly (
          service_id INTEGER NOT NULL,
          hour TEXT NOT NULL,
          n INTEGER NOT NULL DEFAULT 0,
          ok INTEGER NOT NULL DEFAULT 0,
          down INTEGER NOT NULL DEFAULT 0,
          degraded INTEGER NOT NULL DEFAULT 0,
          ms_sum REAL NOT NULL DEFAULT 0,
          ms_n INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (service_id, hour)
        ) WITHOUT ROWID`);
      await run('CREATE INDEX IF NOT EXISTS idx_sm_hourly_hour ON sm_hourly (hour)');
      // On start: build the totals from the checks, all of them the first time, else from the latest hour
      // recorded on (checks written meanwhile by an older version of the add-on are counted too).
      const last = hourlyExists && (await get('SELECT MAX(hour) AS h FROM sm_hourly')).h;
      await run(`INSERT OR REPLACE INTO sm_hourly (service_id, hour, n, ok, down, degraded, ms_sum, ms_n)
                 SELECT service_id, substr(at, 1, 13), COUNT(*), SUM(status IN ${OK}), SUM(status = 'down'), SUM(status IN ('slow', 'retry')),
                        COALESCE(SUM(CASE WHEN status != 'down' THEN ms END), 0), COUNT(CASE WHEN status != 'down' THEN ms END)
                 FROM sm_checks WHERE at >= ? GROUP BY service_id, substr(at, 1, 13)`, [last || '']);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const now = () => new Date().toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const hourOf = (iso) => iso.slice(0, 13);  // sm_hourly key

// ---- in-memory caches (one process) ----
// Each monitor's last SPARK checks for the heartbeat bar: read from sm_checks once, then kept up to date by record().
let sparkCache = null, sparkLoading = null;
async function sparks() {
  if (sparkCache) return sparkCache;
  if (!sparkLoading) {
    sparkLoading = all(`SELECT service_id, status, ms, at FROM (
                          SELECT id, service_id, status, ms, at, ROW_NUMBER() OVER (PARTITION BY service_id ORDER BY id DESC) AS rn FROM sm_checks
                        ) WHERE rn <= ? ORDER BY service_id, id`, [SPARK])
      .then((rows) => {
        const m = new Map();
        rows.forEach((c) => {
          if (!m.has(c.service_id)) m.set(c.service_id, []);
          m.get(c.service_id).push(Object.freeze({ s: c.status, ms: c.ms, at: c.at }));
        });
        sparkCache = m;
        return m;
      })
      .finally(() => { sparkLoading = null; });
  }
  return sparkLoading;
}
function pushSpark(id, c) {
  if (!sparkCache) return;                // not loaded yet: the first read takes it from the table
  const list = (sparkCache.get(id) || []).concat(Object.freeze(c));
  sparkCache.set(id, list.length > SPARK ? list.slice(-SPARK) : list);
}

// The dashboard's data, shared by every open page for DASHBOARD_TTL_MS; changes that the page must
// see at once (a monitor or group saved, deleted, paused, a reset) drop it.
let dashCache = null;
function changed() { dashCache = null; }
exports.changed = changed;
const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } };
const int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// "200-299, 301" -> [[200, 299], [301, 301]]; throws on anything else.
function statusRanges(spec) {
  const parts = String(spec || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw invalid('Expected status codes are required, e.g. 200-399.');
  return parts.map((p) => {
    const m = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(p);
    if (!m) throw invalid(`"${p}" is not a status code or a range like 200-299.`);
    const lo = +m[1], hi = m[2] ? +m[2] : lo;
    if (lo < 100 || hi > 599 || hi < lo) throw invalid(`"${p}" is not a valid status range.`);
    return [lo, hi];
  });
}
exports.statusRanges = statusRanges;

// tcp targets: host:port (IPv6 as [::1]:port).
function hostPort(target) {
  const m = /^\[?([^\]\s]+?)\]?:(\d{1,5})$/.exec(String(target || '').trim());
  if (!m || +m[2] < 1 || +m[2] > 65535) return null;
  return { host: m[1], port: +m[2] };
}
exports.hostPort = hostPort;

// ping / dns targets: a host name or an IP address (never starting with "-", so it is no ping option).
const isHost = (v) => net.isIP(v) > 0 || HOST_RE.test(v);
exports.isHost = isHost;

/** A service form as sent by the page -> the stored fields; throws a 400 on bad input. */
exports.normalize = function (body) {
  const b = body || {};
  const type = TYPES.includes(b.type) ? b.type : 'http';
  const name = text(b.name, 120);
  if (!name) throw invalid('The service needs a name.');
  let target = text(b.target, 2000);
  if (type === 'http') {
    if (target && !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = 'https://' + target;
    let url;
    try { url = new URL(target); } catch (e) { throw invalid('The URL is not valid, e.g. https://his.example.org/health.'); }
    if (!/^https?:$/.test(url.protocol)) throw invalid('Only http:// and https:// URLs can be checked.');
  } else if (type === 'tcp') {
    if (!hostPort(target)) throw invalid('A TCP service needs host:port, e.g. 10.0.0.5:5432.');
  } else if (type === 'ping') {
    if (!isHost(target)) throw invalid('Ping needs a host name or an IP address, e.g. 10.0.0.5.');
  } else if (net.isIP(target) || !HOST_RE.test(target)) {
    throw invalid('DNS needs a host name to resolve, e.g. his.example.org.');
  }
  const dnsServer = text(b.dnsServer, 60);
  if (type === 'dns' && dnsServer && !hostPort(dnsServer) && !net.isIP(dnsServer)) throw invalid('The DNS server must be an IP address (optionally ip:port).');
  const expected = text(b.expectedStatus, 100) || '200-399';
  if (type === 'http') statusRanges(expected);
  // Expiry thresholds, certificate and domain each: warn when fewer than N days, critical when fewer than M < N.
  const thresholds = (what, w, c) => {
    const warn = int(w, 30, 1, 3650), crit = int(c, 7, 0, 3650);
    if (crit >= warn) throw invalid(`${what}: "Critical when fewer than" (${crit} days) must be less than "Warn when fewer than" (${warn} days).`);
    return [warn, crit];
  };
  const [certWarn, certCrit] = thresholds('Certificate expiry', b.certWarnDays, b.certCritDays);
  const [domainWarn, domainCrit] = thresholds('Domain name expiry', b.domainWarnDays, b.domainCritDays);
  const retryEvery = int(b.retryIntervalSec, 0, 0, 86400);
  return {
    group_id: b.groupId ? int(b.groupId, null, 1, Number.MAX_SAFE_INTEGER) : null,
    name,
    type,
    target,
    method: METHODS.includes(String(b.method).toUpperCase()) ? String(b.method).toUpperCase() : 'GET',
    expected_status: expected,
    keyword: text(b.keyword, 200),
    max_redirects: type === 'http' ? int(b.maxRedirects, 0, 0, 20) : 0,
    dns_type: DNS_TYPES.includes(String(b.dnsType).toUpperCase()) ? String(b.dnsType).toUpperCase() : 'A',
    dns_server: type === 'dns' ? dnsServer : '',
    timeout_ms: int(b.timeoutMs, 10000, 1000, 300000),
    interval_sec: int(b.intervalSec, 60, 20, 86400),
    retries: int(b.retries, 0, 0, 20),
    retry_interval_sec: retryEvery ? Math.max(20, retryEvery) : 0,      // 0: the heartbeat interval
    slow_ms: int(b.slowMs, 0, 0, 300000),
    // on by default for https URLs; a TCP port only when it is said to speak TLS
    check_cert: (type === 'http' && !(b.checkCert === false || b.checkCert === 0)) || (type === 'tcp' && (b.checkCert === true || b.checkCert === 1)) ? 1 : 0,
    check_domain: b.checkDomain ? 1 : 0,
    cert_warn_days: certWarn,
    cert_crit_days: certCrit,
    domain_warn_days: domainWarn,
    domain_crit_days: domainCrit,
    ignore_tls: b.ignoreTls ? 1 : 0,
    enabled: b.enabled === false || b.enabled === 0 ? 0 : 1,
    notes: text(b.notes, 1000)
  };
};

// Whether a service has a TLS certificate to read: https URLs, or TCP ports marked as TLS.
const hasCert = (s) => !!s.check_cert && (s.type === 'http' ? /^https:/i.test(s.target) : s.type === 'tcp');
exports.hasCert = hasCert;

// The host name a service's target names (for the domain registration check), or ''.
function hostOf(s) {
  if (s.type === 'http') { try { return new URL(s.target).hostname; } catch (e) { return ''; } }
  if (s.type === 'tcp') { const hp = hostPort(s.target); return hp ? hp.host : ''; }
  return String(s.target || '').trim();
}
exports.hostOf = hostOf;

const daysUntil = (iso) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);

// Expiry state (certificate or domain) from its days left: "warn / critical when fewer than N days".
function expiryState(validTo, warn, crit) {
  if (!validTo) return 'error';
  const days = daysUntil(validTo);
  if (days < 0) return 'expired';
  if (days < crit) return 'critical';
  if (days < warn) return 'warning';
  return 'ok';
}

// The row as the page sees it.
const view = (r) => {
  if (!r) return null;
  const cert = hasCert(r) ? parse(r.cert, null) : null;
  const domain = r.check_domain ? parse(r.domain, null) : null;
  return {
    id: r.id, groupId: r.group_id, name: r.name, type: r.type, target: r.target, method: r.method,
    expectedStatus: r.expected_status, keyword: r.keyword, maxRedirects: r.max_redirects || 0, dnsType: r.dns_type, dnsServer: r.dns_server, timeoutMs: r.timeout_ms, intervalSec: r.interval_sec,
    retries: r.retries, retryIntervalSec: r.retry_interval_sec, failCount: r.fail_count,
    slowMs: r.slow_ms, checkCert: !!r.check_cert, checkDomain: !!r.check_domain, certWarnDays: r.cert_warn_days, certCritDays: r.cert_crit_days,
    domainWarnDays: r.domain_warn_days, domainCritDays: r.domain_crit_days,
    ignoreTls: !!r.ignore_tls, enabled: !!r.enabled, notes: r.notes,
    createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
    status: r.enabled ? r.status : 'paused',
    lastCheckedAt: r.last_checked_at, lastMs: r.last_ms, lastCode: r.last_code, lastError: r.last_error,
    lastChangeAt: r.last_change_at,
    cert: cert ? Object.assign({}, cert, {
      daysLeft: cert.validTo ? daysUntil(cert.validTo) : null,
      state: expiryState(cert.validTo, r.cert_warn_days, r.cert_crit_days), checkedAt: r.cert_checked_at
    }) : null,
    // { domain, expiresAt, registrar, error } or { skipped: reason } when the host is no registrable domain
    domain: domain ? Object.assign({}, domain, domain.skipped ? { state: 'skipped' } : {
      daysLeft: domain.expiresAt ? daysUntil(domain.expiresAt) : null,
      state: expiryState(domain.expiresAt, r.domain_warn_days, r.domain_crit_days)
    }, { checkedAt: r.domain_checked_at }) : null
  };
};
exports.view = view;

const groupView = (g) => g && ({ id: g.id, name: g.name, description: g.description, color: g.color, sortOrder: g.sort_order });

// ---- groups ----

exports.groups = async function () {
  await schema();
  return (await all('SELECT * FROM sm_groups ORDER BY sort_order, name COLLATE NOCASE')).map(groupView);
};

exports.saveGroup = async function (id, body) {
  await schema();
  const name = text(body && body.name, 80);
  if (!name) throw invalid('The group needs a name.');
  const color = COLOR_RE.test(String(body.color || '')) ? body.color : '#2563eb';
  const description = text(body.description, 300);
  const order = int(body.sortOrder, 0, -9999, 9999);
  if (id) {
    const r = await run('UPDATE sm_groups SET name = ?, description = ?, color = ?, sort_order = ? WHERE id = ?', [name, description, color, order, id]);
    if (!r.changes) throw Object.assign(new Error('Group not found.'), { status: 404, expose: true });
    changed();
    return groupView(await get('SELECT * FROM sm_groups WHERE id = ?', [id]));
  }
  const r = await run('INSERT INTO sm_groups (name, description, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [name, description, color, order, now()]);
  changed();
  return groupView(await get('SELECT * FROM sm_groups WHERE id = ?', [r.lastID]));
};

/** Deletes a group; its services stay, ungrouped. */
exports.removeGroup = async function (id) {
  await schema();
  await run('UPDATE sm_services SET group_id = NULL WHERE group_id = ?', [id]);
  const r = await run('DELETE FROM sm_groups WHERE id = ?', [id]);
  changed();
  return r.changes > 0;
};

// ---- services ----

async function checkGroup(groupId) {
  if (groupId && !(await get('SELECT 1 FROM sm_groups WHERE id = ?', [groupId]))) throw invalid('That group no longer exists.');
}

exports.raw = async function (id) {
  await schema();
  return get('SELECT * FROM sm_services WHERE id = ?', [id]);
};

exports.get = async (id) => view(await exports.raw(id));

exports.create = async function (fields, username) {
  await schema();
  await checkGroup(fields.group_id);
  const cols = Object.keys(fields);
  const at = now();
  const r = await run(
    `INSERT INTO sm_services (${cols.join(', ')}, created_by, created_at, updated_by, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
    cols.map((c) => fields[c]).concat([username, at, username, at])
  );
  changed();
  return exports.raw(r.lastID);
};

exports.update = async function (id, fields, username) {
  await schema();
  const before = await exports.raw(id);
  if (!before) return null;
  await checkGroup(fields.group_id);
  const cols = Object.keys(fields);
  // A new target or certificate setting: the stored certificate belongs to the old one.
  const resetCert = before.target !== fields.target || before.type !== fields.type || before.check_cert !== fields.check_cert;
  const resetDomain = hostOf(before) !== hostOf(fields) || before.check_domain !== fields.check_domain;
  await run(
    `UPDATE sm_services SET ${cols.map((c) => c + ' = ?').join(', ')}, updated_by = ?, updated_at = ?${resetCert ? ', cert = NULL, cert_checked_at = NULL' : ''}${resetDomain ? ', domain = NULL, domain_checked_at = NULL' : ''} WHERE id = ?`,
    cols.map((c) => fields[c]).concat([username, now(), id])
  );
  changed();
  return exports.raw(id);
};

exports.setEnabled = async function (id, enabled, username) {
  await schema();
  const r = await run('UPDATE sm_services SET enabled = ?, updated_by = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, username, now(), id]);
  changed();
  return r.changes ? exports.raw(id) : null;
};

exports.remove = async function (id) {
  await schema();
  await run('DELETE FROM sm_checks WHERE service_id = ?', [id]);
  await run('DELETE FROM sm_hourly WHERE service_id = ?', [id]);
  await run('DELETE FROM sm_events WHERE service_id = ?', [id]);
  const r = await run('DELETE FROM sm_services WHERE id = ?', [id]);
  if (sparkCache) sparkCache.delete(id);
  changed();
  return r.changes > 0;
};

/** Enabled services, as stored, for the scheduler. */
exports.enabled = async function () {
  await schema();
  return all('SELECT * FROM sm_services WHERE enabled = 1');
};

/**
 * Saves a check: its history row, the service's latest result (after retries, see the top of this
 * file), a status-change event and, when they were read, the certificate and the domain registration.
 * Returns the service as the page sees it.
 */
exports.record = async function (s, result, cert, domain) {
  await schema();
  const at = now();
  const fails = result.status === 'down' ? (s.fail_count || 0) + 1 : 0;
  const status = result.status === 'down' && s.status !== 'down' && fails <= (s.retries || 0) ? 'retry' : result.status;
  const error = status === 'retry' ? `${result.error} (retry ${fails} of ${s.retries})` : result.error || '';
  const ms = result.ms == null ? null : result.ms;
  await run('INSERT INTO sm_checks (service_id, at, status, ms, code, error) VALUES (?, ?, ?, ?, ?, ?)',
    [s.id, at, status, ms, result.code || null, error]);
  const answered = status !== 'down';
  await run(`INSERT INTO sm_hourly (service_id, hour, n, ok, down, degraded, ms_sum, ms_n) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
             ON CONFLICT (service_id, hour) DO UPDATE SET n = n + 1, ok = ok + excluded.ok, down = down + excluded.down,
               degraded = degraded + excluded.degraded, ms_sum = ms_sum + excluded.ms_sum, ms_n = ms_n + excluded.ms_n`,
    [s.id, hourOf(at), answered ? 1 : 0, answered ? 0 : 1, status === 'slow' || status === 'retry' ? 1 : 0,
      answered && ms != null ? ms : 0, answered && ms != null ? 1 : 0]);
  pushSpark(s.id, { s: status, ms, at });
  const settled = status === 'retry' ? s.settled : status;
  if (settled !== s.settled && s.settled !== 'pending') {
    await run('INSERT INTO sm_events (service_id, at, from_status, to_status, message) VALUES (?, ?, ?, ?, ?)',
      [s.id, at, s.settled, settled, result.error || (result.code ? 'HTTP ' + result.code : '')]);
    // Settings > Slack (it gathers the changes of a few seconds before posting)
    require('./slack.service').changed({ id: s.id, name: s.name, groupId: s.group_id, target: s.target, from: s.settled, to: settled, message: result.error || '', at });
  }
  const sets = ['status = ?', 'settled = ?', 'fail_count = ?', 'last_checked_at = ?', 'last_ms = ?', 'last_code = ?', 'last_error = ?'];
  const params = [status, settled, fails, at, result.ms == null ? null : result.ms, result.code || null, error];
  if (s.status !== status) { sets.push('last_change_at = ?'); params.push(at); changed(); }
  if (cert) { sets.push('cert = ?', 'cert_checked_at = ?'); params.push(JSON.stringify(cert), at); }
  if (domain) { sets.push('domain = ?', 'domain_checked_at = ?'); params.push(JSON.stringify(domain), at); }
  await run(`UPDATE sm_services SET ${sets.join(', ')} WHERE id = ?`, params.concat([s.id]));
  return exports.get(s.id);
};

// ---- the page's data ----

/**
 * Everything the dashboard shows: groups, services with uptime and sparkline, recent incidents.
 * Uptime and average response come from the hourly totals (24 h / 7 d = the last 24 / 168 hours, the
 * current hour included); the sparklines from memory. Shared by all callers for DASHBOARD_TTL_MS.
 */
exports.dashboard = async function () {
  if (dashCache && Date.now() - dashCache.at < DASHBOARD_TTL_MS) return dashCache.data;
  const data = readDashboard();
  dashCache = { at: Date.now(), data };
  data.catch(() => { if (dashCache && dashCache.data === data) dashCache = null; });
  return data;
};

async function readDashboard() {
  await schema();
  const [groups, rows, up24, up7, spark, events] = await Promise.all([
    exports.groups(),
    all('SELECT * FROM sm_services ORDER BY sort_order, name COLLATE NOCASE'),
    all('SELECT service_id, SUM(n) AS n, SUM(ok) AS ok, SUM(ms_sum) AS ms_sum, SUM(ms_n) AS ms_n FROM sm_hourly WHERE hour >= ? GROUP BY service_id', [hourOf(ago(23 * 3600000))]),
    all('SELECT service_id, SUM(n) AS n, SUM(ok) AS ok FROM sm_hourly WHERE hour >= ? GROUP BY service_id', [hourOf(ago(167 * 3600000))]),
    sparks(),
    all(`SELECT e.*, s.name FROM sm_events e JOIN sm_services s ON s.id = e.service_id ORDER BY e.id DESC LIMIT 30`)
  ]);
  const by = (list) => new Map(list.map((x) => [x.service_id, x]));
  const u24 = by(up24), u7 = by(up7);
  const pct = (x) => (x && x.n ? Math.round((x.ok / x.n) * 10000) / 100 : null);
  const services = rows.map((r) => {
    const d = u24.get(r.id);
    return Object.assign(view(r), {
      uptime24: pct(d), uptime7: pct(u7.get(r.id)),
      avgMs24: d && d.ms_n ? Math.round(d.ms_sum / d.ms_n) : null,
      spark: spark.get(r.id) || []
    });
  });
  return {
    groups,
    services,
    events: events.map((e) => ({ id: e.id, serviceId: e.service_id, name: e.name, at: e.at, from: e.from_status, to: e.to_status, message: e.message })),
    now: now()
  };
}

/** One service with its checks of the last `hours` hours and its status changes. */
exports.detail = async function (id, hours) {
  await schema();
  const s = await exports.get(id);
  if (!s) return null;
  const since = ago(hours * 3600000);
  const [checks, events] = await Promise.all([
    all('SELECT at, status, ms, code, error FROM sm_checks WHERE service_id = ? AND at >= ? ORDER BY id', [id, since]),
    all('SELECT at, from_status, to_status, message FROM sm_events WHERE service_id = ? ORDER BY id DESC LIMIT 50', [id])
  ]);
  return {
    service: s,
    checks,
    events: events.map((e) => ({ at: e.at, from: e.from_status, to: e.to_status, message: e.message }))
  };
};

/** Drops checks and events older than their retention. */
exports.prune = async function () {
  await schema();
  await run('DELETE FROM sm_checks WHERE at < ?', [ago(CHECK_DAYS * 86400000)]);
  await run('DELETE FROM sm_hourly WHERE hour < ?', [hourOf(ago(CHECK_DAYS * 86400000))]);
  await run('DELETE FROM sm_events WHERE at < ?', [ago(EVENT_DAYS * 86400000)]);
};

// ---- reset statistics ----

/**
 * The monitor ids a reset covers: scope 'all' -> null (every row, also of deleted monitors),
 * 'group' -> that group's monitors (groupId 0: the ungrouped ones), 'service' -> [serviceId].
 */
exports.resetIds = async function ({ scope, groupId, serviceId }) {
  await schema();
  if (scope === 'service') {
    if (!(await get('SELECT 1 FROM sm_services WHERE id = ?', [serviceId]))) throw Object.assign(new Error('Monitor not found.'), { status: 404, expose: true });
    return [serviceId];
  }
  if (scope === 'group') {
    const rows = groupId
      ? await all('SELECT id FROM sm_services WHERE group_id = ?', [groupId])
      : await all('SELECT id FROM sm_services WHERE group_id IS NULL OR group_id NOT IN (SELECT id FROM sm_groups)');
    return rows.map((r) => r.id);
  }
  return null;
};

function resetWhere(ids, before) {
  const where = [], params = [];
  if (ids) { where.push(`service_id IN (${ids.map(() => '?').join(', ') || 'NULL'})`); params.push(...ids); }
  if (before) { where.push('at < ?'); params.push(before); }
  return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

/** What a reset would delete: { checks, events, monitors } (monitors: how many have data in it). */
exports.resetPreview = async function ({ ids, before, checks, events }) {
  await schema();
  const w = resetWhere(ids, before);
  const [c, e] = await Promise.all([
    checks ? get(`SELECT COUNT(*) AS n, COUNT(DISTINCT service_id) AS m FROM sm_checks${w.sql}`, w.params) : { n: 0, m: 0 },
    events ? get(`SELECT COUNT(*) AS n, COUNT(DISTINCT service_id) AS m FROM sm_events${w.sql}`, w.params) : { n: 0, m: 0 }
  ]);
  return { checks: c.n, events: e.n, monitors: Math.max(c.m, e.m) };
};

/**
 * Deletes check history and/or status changes (all, or older than `before`) of the given monitors.
 * The monitors, their settings and their current status stay; uptime and response times start
 * again from the next check. Returns the counts deleted.
 */
exports.reset = async function ({ ids, before, checks, events }) {
  await schema();
  const w = resetWhere(ids, before);
  // No transaction: the app shares one SQLite connection, and the two deletes stand on their own.
  const c = checks ? await run(`DELETE FROM sm_checks${w.sql}`, w.params) : { changes: 0 };
  if (checks) {
    // The hourly totals go with the checks: whole hours before `before` (the hour it falls in stays).
    const h = resetWhere(ids, before && hourOf(before));
    await run(`DELETE FROM sm_hourly${h.sql.replace('at <', 'hour <')}`, h.params);
    sparkCache = null;                   // read again from what is left
  }
  const e = events ? await run(`DELETE FROM sm_events${w.sql}`, w.params) : { changes: 0 };
  changed();
  return { checks: c.changes, events: e.changes };
};

exports.CHECK_DAYS = CHECK_DAYS;
exports.DNS_TYPES = DNS_TYPES;
