const { run, get, all } = require('../../config/sqlite');
const { grantablePermissions } = require('../../permissions');

const USERS_TABLE = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`;

// Adds columns that later versions introduced, leaving existing rows as they are.
async function addMissingColumns(table, columns) {
  const existing = new Set((await all(`PRAGMA table_info(${table})`)).map((c) => c.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) await run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

// users.role first shipped with CHECK (role IN ('admin', 'user')); custom roles need it gone.
// SQLite cannot drop a constraint, so the table is rebuilt with its rows.
async function dropUsersRoleCheck() {
  const table = await get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  if (!table || !/CHECK\s*\(\s*role/i.test(table.sql)) return;
  await run('BEGIN');
  try {
    await run('ALTER TABLE users RENAME TO users_old');
    await run(USERS_TABLE);
    await run(`INSERT INTO users (id, username, name, password_hash, role, is_active, last_login_at, created_at, updated_at)
               SELECT id, username, name, password_hash, role, is_active, last_login_at, created_at, updated_at FROM users_old`);
    await run('DROP TABLE users_old');
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

// Bootstrap color names used in link.config.js -> stored hex colors.
const LEGACY_COLORS = {
  primary: '#2563eb', success: '#16a34a', danger: '#dc2626', warning: '#ca8a04',
  info: '#0891b2', secondary: '#64748b', dark: '#334155'
};

// Imports the shortcuts from link.config.js once, the first time the shortcut tables exist.
// Recorded in app_meta, so deleting every group later does not bring them back.
async function seedShortcutsFromConfig() {
  if (await get("SELECT 1 FROM app_meta WHERE key = 'shortcuts_seeded'")) return;
  const groups = Array.isArray(global.links) ? global.links : [];
  for (const [g, group] of groups.entries()) {
    const color = LEGACY_COLORS[group.color] || (/^#[0-9a-f]{6}$/i.test(group.color || '') ? group.color : '');
    const created = await run('INSERT INTO shortcut_groups (name, color, sort_order) VALUES (?, ?, ?)',
      [String(group.header || 'Shortcuts'), color, g]);
    const items = (group.items || []).filter((item) => item.active !== false && /^https?:\/\//i.test(item.link || ''));
    for (const [i, item] of items.entries()) {
      await run('INSERT INTO shortcuts (group_id, title, url, sort_order) VALUES (?, ?, ?, ?)',
        [created.lastID, String(item.text || item.link), item.link, i]);
    }
  }
  await run("INSERT INTO app_meta (key, value) VALUES ('shortcuts_seeded', datetime('now'))");
}

// Built-in roles. "user" starts with every menu item so upgrading does not take access away.
async function seedRoles() {
  await run(`INSERT OR IGNORE INTO roles (key, name, description, is_system)
             VALUES ('admin', 'Administrator', 'Full access, including user and role management.', 1)`);
  const created = await run(`INSERT OR IGNORE INTO roles (key, name, description, is_system)
             VALUES ('user', 'User', 'Standard access to the tools.', 1)`);
  if (created.changes) {
    for (const permission of grantablePermissions()) {
      await run('INSERT OR IGNORE INTO role_permissions (role_key, permission) VALUES (?, ?)', ['user', permission]);
    }
  }
}

async function ensureSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS db_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mongodb_host TEXT,
      mongodb_port TEXT,
      mongodb_username TEXT,
      mongodb_password TEXT,
      mongodb_replica_set TEXT,
      mongodb_auth_source TEXT,
      mongodb_db TEXT,
      default_site_code TEXT,
      centrix_base_url TEXT,
      jasperserver_db_ip TEXT,
      jasperserver_db_port TEXT,
      jasperserver_db_user TEXT,
      jasperserver_db_pass TEXT,
      jasperserver_db_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Connection editor settings (see app/modules/setting/models/mongouri.helper.js).
  // conn_type NULL = saved before the editor existed: replica set if mongodb_replica_set is set.
  await addMissingColumns('db_connections', {
    conn_type: 'TEXT',
    use_srv: 'INTEGER NOT NULL DEFAULT 0',
    read_preference: "TEXT NOT NULL DEFAULT ''",
    auth_mechanism: "TEXT NOT NULL DEFAULT ''",
    tls: 'INTEGER NOT NULL DEFAULT 0',
    tls_insecure: 'INTEGER NOT NULL DEFAULT 0',
    connect_timeout_ms: "TEXT NOT NULL DEFAULT ''",
    app_name: "TEXT NOT NULL DEFAULT ''",
    color: "TEXT NOT NULL DEFAULT ''"
  });
  await run(USERS_TABLE);
  await dropUsersRoleCheck();
  await run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // permission = a menu link from menu.config.js, e.g. '/billing/bills'
  await run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_key TEXT NOT NULL COLLATE NOCASE,
      permission TEXT NOT NULL,
      PRIMARY KEY (role_key, permission)
    )
  `);
  await seedRoles();

  await run(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS shortcut_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS shortcuts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await seedShortcutsFromConfig();

  // Query Data: queries a user saved by name (private to that user).
  await run(`
    CREATE TABLE IF NOT EXISTS saved_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      collection TEXT NOT NULL DEFAULT '',
      query TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (username, name)
    )
  `);
  // type: 'query' (Query Data) or 'jasper' (Jaspersoft MongoDB query); meta: JSON, e.g. a Jasper query's parameters
  await addMissingColumns('saved_queries', { type: "TEXT NOT NULL DEFAULT 'query'", meta: "TEXT NOT NULL DEFAULT ''" });

  // Query Data audit: every query run, counted or explained, by whom, against which connection.
  await run(`
    CREATE TABLE IF NOT EXISTS query_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      executed_at TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
      role TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      connection_name TEXT NOT NULL DEFAULT '',
      db_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT '',
      collection TEXT NOT NULL DEFAULT '',
      query TEXT NOT NULL DEFAULT '',
      page INTEGER,
      page_size INTEGER,
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      docs_returned INTEGER,
      has_more INTEGER,
      total INTEGER
    )
  `);
  // Export: format, rows written, file name, ... as JSON
  await addMissingColumns('query_audit', { detail: "TEXT NOT NULL DEFAULT ''" });
  await run('CREATE INDEX IF NOT EXISTS idx_query_audit_time ON query_audit (executed_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_query_audit_user ON query_audit (username, executed_at)');

  await upgradeStoredPaths();
  await removeStoredPaths();
}

// Pages that were removed: their role permissions and shortcut links are dropped.
const REMOVED_PATHS = [
  '/migration/counts', '/data/validate/migration',  // นับจำนวน Migration
  '/exports', '/data/export'                         // Export Data
];

async function removeStoredPaths() {
  const marks = REMOVED_PATHS.map(() => '?').join(', ');
  await run(`DELETE FROM role_permissions WHERE permission IN (${marks})`, REMOVED_PATHS);
  await run(`DELETE FROM shortcuts WHERE url IN (${marks})`, REMOVED_PATHS);
}

// Role permissions and shortcut links saved with the old URLs (/data/..., /tool/..., /settings/...)
// move to the domain URLs in core/routemap.js. Runs on every start; rows already moved are skipped.
async function upgradeStoredPaths() {
  const { upgrade } = require('../../routemap');
  const perms = await all('SELECT role_key, permission FROM role_permissions');
  for (const row of perms) {
    const next = upgrade(row.permission);
    if (!next) continue;
    await run('INSERT OR IGNORE INTO role_permissions (role_key, permission) VALUES (?, ?)', [row.role_key, next]);
    await run('DELETE FROM role_permissions WHERE role_key = ? AND permission = ?', [row.role_key, row.permission]);
  }
  const links = await all("SELECT id, url FROM shortcuts WHERE url LIKE '/%'");
  for (const row of links) {
    const next = upgrade(row.url);
    if (next) await run('UPDATE shortcuts SET url = ? WHERE id = ?', [next, row.id]);
  }
}

module.exports = { ensureSchema };
