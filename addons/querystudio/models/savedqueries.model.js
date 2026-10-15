const { run, get, all } = require('../../../app/core/config/sqlite');

// Saved queries are private to the user who saved them; a name is unique per user (ignoring case).
// type 'query' is a Query Data query; type 'jasper' a Jaspersoft MongoDB query (for JRXML reports),
// saved from Query Data's "To Jasper" and picked through the Saved Jasper queries widget. meta is JSON (a Jasper
// query's parameters: [{ name, cls, def }]).
const MAX_NAME = 120;
const MAX_QUERY = 100000;
const TYPES = ['query', 'jasper'];

exports.MAX_NAME = MAX_NAME;
exports.MAX_QUERY = MAX_QUERY;
exports.TYPES = TYPES;

const typeOf = (t) => (TYPES.includes(t) ? t : 'query');

exports.list = async function (username, type) {
  const rows = await all(
    'SELECT id, name, collection, query, type, meta, created_at, updated_at FROM saved_queries WHERE username = ? AND type = ? ORDER BY updated_at DESC, id DESC',
    [username, typeOf(type)]
  );
  return rows.map((r) => {
    let meta = {};
    try { meta = r.meta ? JSON.parse(r.meta) : {}; } catch (e) { meta = {}; }
    return Object.assign(r, { meta });
  });
};

exports.findByName = function (username, name) {
  return get('SELECT id, type FROM saved_queries WHERE username = ? AND name = ? COLLATE NOCASE', [username, name]);
};

/**
 * Saves under a name; an existing query of the same type with that name is replaced. A name
 * already used by the other type is refused (names are unique per user). Returns the row id.
 */
exports.save = async function (username, { name, collection, query, type, meta }) {
  const t = typeOf(type);
  const json = meta ? JSON.stringify(meta) : '';
  const existing = await exports.findByName(username, name);
  if (existing) {
    if ((existing.type || 'query') !== t) {
      const err = new Error(`"${name}" is already the name of a saved ${existing.type === 'jasper' ? 'Jasper query' : 'Query Data query'}. Choose another name.`);
      err.status = 409;
      throw err;
    }
    await run(
      "UPDATE saved_queries SET name = ?, collection = ?, query = ?, meta = ?, updated_at = datetime('now') WHERE id = ?",
      [name, collection, query, json, existing.id]
    );
    return existing.id;
  }
  const res = await run('INSERT INTO saved_queries (username, name, collection, query, type, meta) VALUES (?, ?, ?, ?, ?, ?)', [username, name, collection, query, t, json]);
  return res.lastID;
};

exports.remove = function (username, id, type) {
  if (type) return run('DELETE FROM saved_queries WHERE id = ? AND username = ? AND type = ?', [id, username, typeOf(type)]);
  return run('DELETE FROM saved_queries WHERE id = ? AND username = ?', [id, username]);
};
