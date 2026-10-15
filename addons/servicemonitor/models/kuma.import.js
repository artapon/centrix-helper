// Service Monitor > Settings > Import from Uptime Kuma: turns the monitors of an Uptime Kuma backup
// (1.x: Settings > Backup > Export, a JSON file with "monitorList") into Service Monitor monitors and groups.
//   http, keyword, json-query -> HTTP(S)   (json-query: the JSON query itself is not checked)
//   port -> TCP host:port   ping -> Ping   dns -> DNS   group -> a group (its children go in it)
// Anything else (push, docker, databases, MQTT, ...) is listed as skipped, with the reason.
// The page sends only the monitor list (no heartbeats), so large backups stay small.
const services = require('./services.model');

const HTTP_TYPES = ['http', 'keyword', 'json-query'];
const SUPPORTED = HTTP_TYPES.concat(['port', 'ping', 'dns']);
const DNS_OK = services.DNS_TYPES;
const COLORS = ['#2563eb', '#0e7490', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#7c3aed', '#db2777', '#475569'];
const TYPE_NAMES = {
  push: 'Push', docker: 'Docker container', 'real-browser': 'Browser engine', steam: 'Steam game server', gamedig: 'GameDig',
  mongodb: 'MongoDB', mysql: 'MySQL / MariaDB', postgres: 'PostgreSQL', sqlserver: 'SQL Server', redis: 'Redis', radius: 'Radius',
  mqtt: 'MQTT', 'grpc-keyword': 'gRPC keyword', 'tailscale-ping': 'Tailscale ping', 'kafka-producer': 'Kafka producer'
};

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

/** The monitors of a backup, checked: { monitors: [...] } -> array. */
function monitorsOf(backup) {
  const list = backup && (Array.isArray(backup.monitorList) ? backup.monitorList : Array.isArray(backup) ? backup : null);
  if (!list) throw invalid('This is not an Uptime Kuma backup: it has no "monitorList". Export it in Uptime Kuma under Settings > Backup.');
  if (list.length > 2000) throw invalid('The backup has more than 2,000 monitors.');
  return list.filter((m) => m && typeof m === 'object');
}

const str = (v) => (v == null ? '' : String(v).trim());
const hostPort = (host, port) => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host) + ':' + port;

// One Kuma monitor -> the Service Monitor form fields, or { skip: reason }. Notes list what did not carry over.
function convert(m) {
  const type = str(m.type) || 'http';
  if (type === 'group') return { group: true };
  if (!SUPPORTED.includes(type)) return { skip: `${TYPE_NAMES[type] || type} monitors are not supported` };
  if (m.upsideDown) return { skip: 'Upside-down mode is not supported' };
  const notes = [];
  const interval = parseInt(m.interval, 10) || 60;
  const f = {
    name: str(m.name) || 'Unnamed monitor',
    intervalSec: Math.max(20, interval),
    retries: Math.max(0, parseInt(m.maxretries, 10) || 0),
    retryIntervalSec: parseInt(m.retryInterval, 10) || 0,
    timeoutMs: Math.round((parseFloat(m.timeout) > 0 ? parseFloat(m.timeout) : interval * 0.8) * 1000),
    enabled: m.active !== false && m.active !== 0,
    checkDomain: false,
    notes: str(m.description)
  };
  if (f.retryIntervalSec === f.intervalSec) f.retryIntervalSec = 0;

  if (HTTP_TYPES.includes(type)) {
    const method = str(m.method).toUpperCase() || 'GET';
    Object.assign(f, {
      type: 'http', target: str(m.url),
      method: ['GET', 'HEAD', 'POST'].includes(method) ? method : 'GET',
      expectedStatus: (Array.isArray(m.accepted_statuscodes) && m.accepted_statuscodes.length ? m.accepted_statuscodes : ['200-299']).join(', '),
      keyword: type === 'keyword' ? str(m.keyword) : '',
      maxRedirects: m.maxredirects == null ? 5 : Math.min(20, Math.max(0, parseInt(m.maxredirects, 10) || 0)),
      ignoreTls: !!m.ignoreTls,
      checkCert: !!m.expiryNotification || /^https:/i.test(str(m.url))
    });
    if (!['GET', 'HEAD', 'POST'].includes(method)) notes.push(`method ${method} imported as GET`);
    if (type === 'keyword' && m.invertKeyword) notes.push('"invert keyword" is not supported: the keyword must be present');
    if (type === 'json-query') notes.push('the JSON query is not checked, only the status code');
    if (m.body || m.headers) notes.push('request body / headers are not sent');
    if (m.authMethod && m.authMethod !== 'null') notes.push('authentication is not sent');
  } else if (type === 'port') {
    Object.assign(f, { type: 'tcp', target: hostPort(str(m.hostname), parseInt(m.port, 10)), checkCert: false });
  } else if (type === 'ping') {
    Object.assign(f, { type: 'ping', target: str(m.hostname), checkCert: false });
  } else {
    const rr = str(m.dns_resolve_type).toUpperCase() || 'A';
    const server = str(m.dns_resolve_server).split(/[\s,]+/)[0] || '';
    Object.assign(f, { type: 'dns', target: str(m.hostname), dnsType: DNS_OK.includes(rr) ? rr : 'A', dnsServer: server, checkCert: false });
    if (!DNS_OK.includes(rr)) notes.push(`record type ${rr} imported as A`);
    if (str(m.dns_resolve_server).split(/[\s,]+/).filter(Boolean).length > 1) notes.push('only the first DNS server is used');
  }
  return { fields: f, notes };
}

/**
 * What an import would do: { groups: [{ name, exists }], rows: [{ kumaId, name, type, target, group, action, reason, notes }] }.
 * action: 'import' | 'exists' (same type and target already monitored) | 'skip'.
 */
exports.plan = async function (backup) {
  const list = monitorsOf(backup);
  const existing = (await services.dashboard()).services;
  const existingGroups = await services.groups();
  const seen = new Set(existing.map((s) => s.type + '|' + s.target.toLowerCase()));
  const inBackup = new Map();                         // key -> name of the first monitor of the backup with it
  const kumaGroups = new Map(list.filter((m) => m.type === 'group').map((m) => [m.id, str(m.name) || 'Group']));
  const groupNames = [...new Set(list.filter((m) => m.type !== 'group' && kumaGroups.has(m.parent)).map((m) => kumaGroups.get(m.parent)))];

  const rows = list.filter((m) => m.type !== 'group').map((m) => {
    const c = convert(m);
    const row = { kumaId: m.id, name: str(m.name) || 'Unnamed monitor', type: str(m.type) || 'http', group: kumaGroups.get(m.parent) || '', notes: c.notes || [] };
    if (c.skip) return Object.assign(row, { action: 'skip', reason: c.skip, target: str(m.url) || str(m.hostname) });
    let fields;
    try { fields = services.normalize(c.fields); } catch (err) {
      return Object.assign(row, { action: 'skip', reason: err.message, target: c.fields.target });
    }
    row.target = fields.target;
    row.as = fields.type;
    row.enabled = !!fields.enabled;
    const key = fields.type + '|' + fields.target.toLowerCase();
    if (seen.has(key)) return Object.assign(row, { action: 'exists', reason: 'Already monitored (same type and target)' });
    // A target twice in the backup is imported once.
    if (inBackup.has(key)) return Object.assign(row, { action: 'skip', reason: `Same type and target as "${inBackup.get(key)}" in this backup` });
    inBackup.set(key, row.name);
    return Object.assign(row, { action: 'import', fields: c.fields });
  });
  return {
    groups: groupNames.map((name) => ({ name, exists: existingGroups.some((g) => g.name.toLowerCase() === name.toLowerCase()) })),
    rows
  };
};

/** Imports the plan's 'import' rows (and, with includeExisting, the 'exists' ones too). Returns the counts. */
exports.run = async function (backup, { includeExisting = false } = {}, username) {
  const p = await exports.plan(backup);
  const groups = await services.groups();
  const groupId = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));
  let createdGroups = 0, imported = 0, order = groups.length;
  const list = monitorsOf(backup);
  for (const r of p.rows) {
    if (!(r.action === 'import' || (includeExisting && r.action === 'exists'))) continue;
    const fields = r.fields || convert(list.find((m) => m.id === r.kumaId)).fields;
    if (r.group) {
      const key = r.group.toLowerCase();
      if (!groupId.has(key)) {
        const g = await services.saveGroup(null, { name: r.group, color: COLORS[order % COLORS.length], sortOrder: order });
        groupId.set(key, g.id); order++; createdGroups++;
      }
      fields.groupId = groupId.get(key);
    }
    await services.create(services.normalize(fields), username);
    imported++;
  }
  return { imported, createdGroups, skipped: p.rows.filter((r) => r.action === 'skip').length, existing: includeExisting ? 0 : p.rows.filter((r) => r.action === 'exists').length };
};
