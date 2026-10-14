const { run, get, all } = require('../../../core/config/sqlite');

const KEY_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
exports.KEY_RE = KEY_RE;

// Roles with how many users hold them and how many menu items they grant.
exports.list = function () {
  return all(`
    SELECT r.id, r.key, r.name, r.description, r.is_system,
           (SELECT COUNT(*) FROM users u WHERE u.role = r.key) AS user_count,
           (SELECT COUNT(*) FROM role_permissions p WHERE p.role_key = r.key) AS permission_count
    FROM roles r
    ORDER BY r.is_system DESC, r.name COLLATE NOCASE`);
};

exports.getByKey = function (key) {
  return get('SELECT id, key, name, description, is_system FROM roles WHERE key = ?', [key]);
};

exports.permissions = async function (key) {
  const rows = await all('SELECT permission FROM role_permissions WHERE role_key = ?', [key]);
  return rows.map((row) => row.permission);
};

// All role -> permissions, for the roles page.
exports.permissionMap = async function () {
  const rows = await all('SELECT role_key, permission FROM role_permissions');
  const map = {};
  rows.forEach((row) => { (map[row.role_key] = map[row.role_key] || []).push(row.permission); });
  return map;
};

exports.create = function ({ key, name, description }) {
  return run('INSERT INTO roles (key, name, description) VALUES (?, ?, ?)', [key, name.trim(), (description || '').trim()]);
};

exports.update = function (key, { name, description }) {
  return run("UPDATE roles SET name = ?, description = ?, updated_at = datetime('now') WHERE key = ?",
    [name.trim(), (description || '').trim(), key]);
};

exports.setPermissions = async function (key, permissions) {
  await run('BEGIN');
  try {
    await run('DELETE FROM role_permissions WHERE role_key = ?', [key]);
    for (const permission of permissions) {
      await run('INSERT INTO role_permissions (role_key, permission) VALUES (?, ?)', [key, permission]);
    }
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
};

/**
 * Page actions (core/permissions.js) seen for the first time are granted to every role that has
 * their page, so adding an action takes nothing away; an administrator then narrows it per role.
 * The actions already introduced are kept in app_meta, so taking one away later sticks.
 * grantable: permissions.grantableMenu().
 */
const KNOWN_ACTIONS_KEY = 'permissions.actions.known';
exports.grantNewActions = async function (grantable) {
  const row = await get('SELECT value FROM app_meta WHERE key = ?', [KNOWN_ACTIONS_KEY]);
  let known = [];
  try { known = row ? JSON.parse(row.value) || [] : []; } catch (e) { known = []; }
  const seen = new Set(known);
  const fresh = [];
  grantable.forEach((section) => section.items.forEach((item) => (item.actions || []).forEach((a) => {
    if (!seen.has(a.permission)) fresh.push({ page: item.permission, permission: a.permission });
  })));
  if (!fresh.length) return 0;

  let granted = 0;
  await run('BEGIN');
  try {
    for (const f of fresh) {
      const r = await run(`INSERT INTO role_permissions (role_key, permission)
        SELECT p.role_key, ? FROM role_permissions p
        WHERE p.permission = ? AND NOT EXISTS (SELECT 1 FROM role_permissions q WHERE q.role_key = p.role_key AND q.permission = ?)`,
      [f.permission, f.page, f.permission]);
      granted += (r && r.changes) || 0;
    }
    await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [KNOWN_ACTIONS_KEY, JSON.stringify(known.concat(fresh.map((f) => f.permission)))]);
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
  console.log(`Page actions ${fresh.map((f) => f.permission).join(', ')} granted to the roles that have their page (${granted} grant${granted === 1 ? '' : 's'}).`);
  return granted;
};

exports.remove = async function (key) {
  await run('DELETE FROM role_permissions WHERE role_key = ?', [key]);
  return run('DELETE FROM roles WHERE key = ? AND is_system = 0', [key]);
};
