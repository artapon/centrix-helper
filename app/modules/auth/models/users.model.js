const { run, get, all } = require('../../../core/config/sqlite');
const password = require('../../../core/helpers/password');

const PUBLIC_COLUMNS = 'id, username, name, role, is_active, last_login_at, created_at, updated_at';
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

exports.USERNAME_RE = USERNAME_RE;

exports.count = async function () {
  const row = await get('SELECT COUNT(*) AS n FROM users');
  return row.n;
};

exports.list = function () {
  return all(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY username COLLATE NOCASE`);
};

exports.getById = function (id) {
  return get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [id]);
};

exports.countActiveAdmins = async function () {
  const row = await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1");
  return row.n;
};

// Returns the user when the credentials match an active account, otherwise null.
exports.authenticate = async function (username, plain) {
  const row = await get('SELECT * FROM users WHERE username = ?', [String(username || '').trim()]);
  if (!row || !row.is_active) {
    // Hash anyway so unknown usernames take as long as wrong passwords.
    await password.verify(plain, 'scrypt$00$00');
    return null;
  }
  if (!(await password.verify(plain, row.password_hash))) return null;
  await exports.recordLogin(row.id);
  return exports.getById(row.id);
};

exports.recordLogin = function (id) {
  return run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [id]);
};

exports.create = async function ({ username, name, role, plainPassword }) {
  const hash = await password.hash(plainPassword);
  const result = await run(
    'INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)',
    [username.trim(), (name || '').trim(), role, hash]
  );
  return exports.getById(result.lastID);
};

// Creates the first admin only while the table is still empty; returns null if someone else got there first.
exports.createInitialAdmin = async function ({ username, name, plainPassword }) {
  const hash = await password.hash(plainPassword);
  const result = await run(
    `INSERT INTO users (username, name, role, password_hash)
     SELECT ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
    [username.trim(), (name || '').trim(), hash]
  );
  return result.changes ? exports.getById(result.lastID) : null;
};

exports.update = function (id, { name, role, isActive }) {
  return run(
    "UPDATE users SET name = ?, role = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?",
    [(name || '').trim(), role, isActive ? 1 : 0, id]
  );
};

exports.setPassword = async function (id, plainPassword) {
  const hash = await password.hash(plainPassword);
  return run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [hash, id]);
};

exports.verifyPassword = async function (id, plain) {
  const row = await get('SELECT password_hash FROM users WHERE id = ?', [id]);
  return !!row && password.verify(plain, row.password_hash);
};

exports.remove = function (id) {
  return run('DELETE FROM users WHERE id = ?', [id]);
};
