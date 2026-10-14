// Shortcut groups and their links (sqlite). Imported once from link.config.js; see
// seedShortcutsFromConfig in core/migrations/sqlite/migrate.js.
const { run, get, all } = require('../../../core/config/sqlite');

const URL_RE = /^https?:\/\/[^\s]+$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
exports.URL_RE = URL_RE;

const clean = (value, max) => String(value || '').trim().slice(0, max);

// Groups in order, each with its links in order.
exports.listGrouped = async function () {
  const [groups, links] = await Promise.all([
    all('SELECT id, name, color, sort_order FROM shortcut_groups ORDER BY sort_order, id'),
    all('SELECT id, group_id, title, url, description, sort_order FROM shortcuts ORDER BY sort_order, id')
  ]);
  return groups.map((group) => ({ ...group, links: links.filter((link) => link.group_id === group.id) }));
};

exports.getGroup = (id) => get('SELECT * FROM shortcut_groups WHERE id = ?', [id]);
exports.getLink = (id) => get('SELECT * FROM shortcuts WHERE id = ?', [id]);

exports.createGroup = async function ({ name, color }) {
  const last = await get('SELECT COALESCE(MAX(sort_order), -1) AS n FROM shortcut_groups');
  return run('INSERT INTO shortcut_groups (name, color, sort_order) VALUES (?, ?, ?)',
    [clean(name, 80), COLOR_RE.test(color || '') ? color : '', last.n + 1]);
};

exports.updateGroup = function (id, { name, color }) {
  return run("UPDATE shortcut_groups SET name = ?, color = ?, updated_at = datetime('now') WHERE id = ?",
    [clean(name, 80), COLOR_RE.test(color || '') ? color : '', id]);
};

exports.removeGroup = async function (id) {
  await run('DELETE FROM shortcuts WHERE group_id = ?', [id]);
  return run('DELETE FROM shortcut_groups WHERE id = ?', [id]);
};

exports.createLink = async function ({ group_id, title, url, description }) {
  const last = await get('SELECT COALESCE(MAX(sort_order), -1) AS n FROM shortcuts WHERE group_id = ?', [group_id]);
  return run('INSERT INTO shortcuts (group_id, title, url, description, sort_order) VALUES (?, ?, ?, ?, ?)',
    [group_id, clean(title, 80), clean(url, 2000), clean(description, 200), last.n + 1]);
};

// Moving a link to another group puts it at the end of that group.
exports.updateLink = async function (id, { group_id, title, url, description }) {
  const current = await exports.getLink(id);
  let sortOrder = current.sort_order;
  if (Number(group_id) !== current.group_id) {
    const last = await get('SELECT COALESCE(MAX(sort_order), -1) AS n FROM shortcuts WHERE group_id = ?', [group_id]);
    sortOrder = last.n + 1;
  }
  return run(`UPDATE shortcuts SET group_id = ?, title = ?, url = ?, description = ?, sort_order = ?,
              updated_at = datetime('now') WHERE id = ?`,
    [group_id, clean(title, 80), clean(url, 2000), clean(description, 200), sortOrder, id]);
};

exports.removeLink = (id) => run('DELETE FROM shortcuts WHERE id = ?', [id]);

/**
 * Moves a group, or a link within its group, one place up (-1) or down (+1) by
 * renumbering the list in its new order.
 */
async function move(table, id, direction, scope) {
  const where = scope ? `WHERE ${scope.column} = ?` : '';
  const rows = await all(`SELECT id FROM ${table} ${where} ORDER BY sort_order, id`, scope ? [scope.value] : []);
  const ids = rows.map((row) => row.id);
  const from = ids.indexOf(Number(id));
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  for (const [index, rowId] of ids.entries()) {
    await run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [index, rowId]);
  }
}

exports.moveGroup = (id, direction) => move('shortcut_groups', id, direction);

exports.moveLink = async function (id, direction) {
  const link = await exports.getLink(id);
  if (link) await move('shortcuts', id, direction, { column: 'group_id', value: link.group_id });
};
