// MongoDB connection strings <-> connection settings, for connecting, "Test Connection"
// and the editor's "From URI" / "To URI" buttons.
//
// Settings shape (as stored in db_connections, decrypted):
//   conn_type 'single' | 'replicaset', use_srv, mongodb_host, mongodb_port,
//   mongodb_replica_set, read_preference, mongodb_username, mongodb_password,
//   mongodb_auth_source, auth_mechanism, tls, tls_insecure, mongodb_db,
//   connect_timeout_ms, app_name
// For a replica set, mongodb_host holds the members as "host1:27017,host2:27017".

const DEFAULT_PORT = 27017;
const DEFAULT_APP_NAME = 'MedintHelper';

const truthy = (value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on';

// "h1:27017, h2" -> [{ host: 'h1', port: 27017 }, { host: 'h2', port: 27017 }]
function parseMembers(text, fallbackPort) {
  return String(text || '').split(/[\s,]+/).filter(Boolean).map((member) => {
    const ipv6 = member.match(/^\[(.+)\](?::(\d+))?$/);
    if (ipv6) return { host: ipv6[1], port: Number(ipv6[2] || fallbackPort || DEFAULT_PORT) };
    const [host, port] = member.split(':');
    return { host, port: Number(port || fallbackPort || DEFAULT_PORT) };
  });
}

const formatMember = ({ host, port }) => `${host.includes(':') ? `[${host}]` : host}:${port || DEFAULT_PORT}`;

function connType(settings) {
  if (settings.conn_type === 'replicaset' || settings.conn_type === 'single') return settings.conn_type;
  return settings.mongodb_replica_set ? 'replicaset' : 'single';   // rows saved before conn_type existed
}

// Host part of the URI ("h1:27017,h2:27017" or "cluster.example.com" for SRV).
function hostList(settings) {
  if (connType(settings) === 'single' && truthy(settings.use_srv)) return String(settings.mongodb_host || '').trim();
  if (connType(settings) === 'single') {
    const [member] = parseMembers(settings.mongodb_host, settings.mongodb_port);
    return member ? formatMember({ host: member.host, port: settings.mongodb_port || member.port }) : '';
  }
  return parseMembers(settings.mongodb_host, settings.mongodb_port).map(formatMember).join(',');
}

// Driver options that are not part of the URI.
function clientOptions(settings) {
  const options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    connectTimeoutMS: Number(settings.connect_timeout_ms) || 3000,
    serverSelectionTimeoutMS: Math.max(Number(settings.connect_timeout_ms) || 3000, 5000),
    poolSize: 10,             // pages run their queries in parallel (driver default is 5)
    appname: settings.app_name || DEFAULT_APP_NAME
  };
  if (settings.mongodb_username) options.authSource = settings.mongodb_auth_source || 'centrixdb';
  if (settings.mongodb_username && settings.auth_mechanism) options.authMechanism = settings.auth_mechanism;
  if (connType(settings) === 'replicaset' && settings.mongodb_replica_set) options.replicaSet = settings.mongodb_replica_set;
  if (connType(settings) === 'replicaset' && settings.read_preference) options.readPreference = settings.read_preference;
  if (truthy(settings.tls)) {
    options.tls = true;
    if (truthy(settings.tls_insecure)) {
      options.tlsAllowInvalidCertificates = true;
      options.tlsAllowInvalidHostnames = true;
    }
  }
  if (settings.mongodb_db) options.dbName = settings.mongodb_db;
  return options;
}

/**
 * Full connection string. With { maskPassword: true } the password is replaced by
 * <password> (used for "To URI", so a stored password never reaches the browser).
 */
function build(settings, { maskPassword = false } = {}) {
  const srv = connType(settings) === 'single' && truthy(settings.use_srv);
  let auth = '';
  if (settings.mongodb_username) {
    const password = maskPassword
      ? (settings.mongodb_password ? '<password>' : '')
      : encodeURIComponent(settings.mongodb_password || '');
    auth = encodeURIComponent(settings.mongodb_username) + (password ? ':' + password : '') + '@';
  }
  const opts = clientOptions(settings);
  const params = new URLSearchParams();
  ['replicaSet', 'readPreference', 'authSource', 'authMechanism'].forEach((key) => { if (opts[key]) params.set(key, opts[key]); });
  if (opts.tls && !srv) params.set('tls', 'true');   // mongodb+srv implies TLS
  if (opts.tlsAllowInvalidCertificates) params.set('tlsAllowInvalidCertificates', 'true');
  if (opts.tlsAllowInvalidHostnames) params.set('tlsAllowInvalidHostnames', 'true');
  if (settings.connect_timeout_ms) params.set('connectTimeoutMS', String(opts.connectTimeoutMS));
  params.set('appName', opts.appname);
  return `${srv ? 'mongodb+srv' : 'mongodb'}://${auth}${hostList(settings)}/${encodeURIComponent(settings.mongodb_db || '')}?${params}`;
}

// Parses a mongodb:// or mongodb+srv:// URI into editor settings; throws on invalid input.
function parse(uri) {
  const match = String(uri || '').trim().match(/^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/);
  if (!match) throw new Error('Not a MongoDB connection string (mongodb:// or mongodb+srv://).');
  const [, scheme, userinfo, hosts, db, query] = match;
  const params = new URLSearchParams(query || '');
  const [username, password] = userinfo ? userinfo.split(':') : [];
  const decode = (value) => (value ? decodeURIComponent(value) : '');
  const members = parseMembers(hosts);
  const srv = scheme === 'mongodb+srv';
  const replicaset = !srv && (members.length > 1 || params.has('replicaSet'));

  return {
    conn_type: replicaset ? 'replicaset' : 'single',
    use_srv: srv,
    mongodb_host: srv ? hosts : (replicaset ? members.map(formatMember).join(',') : (members[0] ? members[0].host : '')),
    mongodb_port: srv || replicaset ? '' : String(members[0] ? members[0].port : DEFAULT_PORT),
    mongodb_replica_set: params.get('replicaSet') || '',
    read_preference: params.get('readPreference') || '',
    mongodb_username: decode(username),
    mongodb_password: decode(password),
    mongodb_auth_source: params.get('authSource') || '',
    auth_mechanism: params.get('authMechanism') || '',
    tls: truthy(params.get('tls')) || truthy(params.get('ssl')) || srv,
    tls_insecure: truthy(params.get('tlsAllowInvalidCertificates')) || truthy(params.get('tlsInsecure')),
    mongodb_db: decode(db),
    connect_timeout_ms: params.get('connectTimeoutMS') || '',
    app_name: params.get('appName') || ''
  };
}

module.exports = { build, parse, clientOptions, parseMembers, connType, truthy, DEFAULT_PORT };
