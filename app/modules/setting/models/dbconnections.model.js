const { run, get, all } = require('../../../core/config/sqlite');
const helpers = require('../../../core/helpers/encryption');
const mongoUri = require('./mongouri.helper');

function encryptIfPresent(value) {
  return value ? helpers.medintEncrypt(value) : '';
}

function decryptIfPresent(value) {
  if (!value) return '';
  try {
    return helpers.medintDecrypt(value);
  } catch (e) {
    return '';
  }
}

// Organisation code used when a connection has no "Default site code".
const DEFAULT_SITE_CODE = '00057';
exports.DEFAULT_SITE_CODE = DEFAULT_SITE_CODE;

const READ_PREFERENCES = ['', 'primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'];
const AUTH_MECHANISMS = ['', 'SCRAM-SHA-256', 'SCRAM-SHA-1'];
const flag = (value) => (mongoUri.truthy(value) ? 1 : 0);

// Shape consumed by server.js / monitor / jasperserver model (mirrors the legacy db.config.js DB.CONNECTION entries).
// Mongo credentials stay encrypted here since existing callers decrypt them at the point of use;
// Jasper credentials are decrypted since existing callers consume them directly.
function toLegacyShape(row, index) {
  return {
    SITE_INDEX: index,
    ID: row.id,
    NAME: row.name,
    CONN_TYPE: mongoUri.connType(row),
    USE_SRV: !!row.use_srv,
    COLOR: row.color || '',
    TLS: !!row.tls,
    MONGODB_HOST: row.mongodb_host || '',
    MONGODB_PORT: row.mongodb_port || '',
    MONGODB_USERNAME: row.mongodb_username || '',
    MONGODB_PASSWORD: row.mongodb_password || '',
    MONGODB_REPLICA_SET: row.mongodb_replica_set || '',
    MONGODB_AUTH_SOURCE: row.mongodb_auth_source || '',
    MONGODB_DB: row.mongodb_db || '',
    DEFAULT_SITE_CODE: row.default_site_code || DEFAULT_SITE_CODE,
    CENTRIX_BASE_URL: row.centrix_base_url || '',
    JASPERSERVER_DB_IP: row.jasperserver_db_ip || '',
    JASPERSERVER_DB_PORT: row.jasperserver_db_port || '',
    JASPERSERVER_DB_USER: row.jasperserver_db_user || '',
    JASPERSERVER_DB_PASS: decryptIfPresent(row.jasperserver_db_pass),
    JASPERSERVER_DB_NAME: row.jasperserver_db_name || '',
  };
}

exports.list = async function () {
  const rows = await all('SELECT * FROM db_connections ORDER BY id ASC');
  return rows.map(toLegacyShape);
};

// Name and index only: safe to embed in pages (no hosts or credentials).
exports.listForPicker = async function () {
  return (await exports.list()).map((c) => ({ SITE_INDEX: c.SITE_INDEX, NAME: c.NAME, COLOR: c.COLOR }));
};

exports.getByIndex = async function (index) {
  const list = await exports.list();
  return list[index] || null;
};

exports.indexOfId = async function (id) {
  const list = await exports.list();
  return list.findIndex((c) => String(c.ID) === String(id));
};

// Connection settings with decrypted credentials, for connecting and testing (server side only).
exports.getSettings = async function (id) {
  const row = await get('SELECT * FROM db_connections WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    conn_type: mongoUri.connType(row),
    mongodb_username: decryptIfPresent(row.mongodb_username),
    mongodb_password: decryptIfPresent(row.mongodb_password),
    jasperserver_db_pass: decryptIfPresent(row.jasperserver_db_pass),
  };
};

// Record for the edit form. Passwords are never sent to the browser: has_* says whether one is stored.
exports.getRawById = async function (id) {
  const settings = await exports.getSettings(id);
  if (!settings) return null;
  const { mongodb_password, jasperserver_db_pass, created_at, updated_at, ...rest } = settings;
  return {
    ...rest,
    use_srv: !!settings.use_srv,
    tls: !!settings.tls,
    tls_insecure: !!settings.tls_insecure,
    has_mongodb_password: !!mongodb_password,
    has_jasperserver_db_pass: !!jasperserver_db_pass,
  };
};

// Normalises editor input into column values.
function columnsFrom(data) {
  const connType = data.conn_type === 'replicaset' ? 'replicaset' : 'single';
  return {
    name: String(data.name || '').trim(),
    conn_type: connType,
    use_srv: connType === 'single' ? flag(data.use_srv) : 0,
    mongodb_host: String(data.mongodb_host || '').trim(),
    mongodb_port: connType === 'single' && !flag(data.use_srv) ? String(data.mongodb_port || '').trim() : '',
    mongodb_replica_set: connType === 'replicaset' ? String(data.mongodb_replica_set || '').trim() : '',
    read_preference: connType === 'replicaset' && READ_PREFERENCES.includes(data.read_preference) ? data.read_preference : '',
    mongodb_auth_source: String(data.mongodb_auth_source || '').trim(),
    auth_mechanism: AUTH_MECHANISMS.includes(data.auth_mechanism) ? data.auth_mechanism : '',
    tls: flag(data.tls),
    tls_insecure: flag(data.tls) ? flag(data.tls_insecure) : 0,
    mongodb_db: String(data.mongodb_db || '').trim(),
    connect_timeout_ms: /^\d+$/.test(String(data.connect_timeout_ms || '')) ? String(data.connect_timeout_ms) : '',
    app_name: String(data.app_name || '').trim(),
    color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : '',
    default_site_code: String(data.default_site_code || '').trim() || DEFAULT_SITE_CODE,
    centrix_base_url: String(data.centrix_base_url || '').trim(),
    jasperserver_db_ip: String(data.jasperserver_db_ip || '').trim(),
    jasperserver_db_port: String(data.jasperserver_db_port || '').trim(),
    jasperserver_db_user: String(data.jasperserver_db_user || '').trim(),
    jasperserver_db_name: String(data.jasperserver_db_name || '').trim(),
  };
}

/**
 * Editor input merged over a stored connection (when editing): a blank password keeps the
 * stored one; auth_mode 'none' clears the credentials. Used by save and "Test Connection".
 */
exports.resolveSettings = async function (data, id) {
  const stored = id ? await exports.getSettings(id) : null;
  const columns = columnsFrom(data);
  const noAuth = data.auth_mode === 'none';
  return {
    ...columns,
    mongodb_username: noAuth ? '' : String(data.mongodb_username || '').trim(),
    mongodb_password: noAuth ? '' : (data.mongodb_password || (stored ? stored.mongodb_password : '')),
    jasperserver_db_pass: data.jasperserver_db_pass || (stored ? stored.jasperserver_db_pass : ''),
  };
};

async function save(id, settings) {
  const values = {
    ...settings,
    mongodb_username: encryptIfPresent(settings.mongodb_username),
    mongodb_password: encryptIfPresent(settings.mongodb_password),
    jasperserver_db_pass: encryptIfPresent(settings.jasperserver_db_pass),
  };
  const names = Object.keys(values);
  if (id) {
    await run(
      `UPDATE db_connections SET ${names.map((n) => `${n} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...names.map((n) => values[n]), id]
    );
    return id;
  }
  const result = await run(
    `INSERT INTO db_connections (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    names.map((n) => values[n])
  );
  return result.lastID;
}

// Returns the new connection's id.
exports.create = async function (data) {
  return save(null, await exports.resolveSettings(data));
};

exports.update = async function (id, data) {
  const existing = await get('SELECT id FROM db_connections WHERE id = ?', [id]);
  if (!existing) throw new Error('Connection not found');
  return save(id, await exports.resolveSettings(data, id));
};

exports.remove = async function (id) {
  await run('DELETE FROM db_connections WHERE id = ?', [id]);
};
