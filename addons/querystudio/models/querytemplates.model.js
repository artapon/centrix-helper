const { run, get, all } = require('../../../app/core/config/sqlite');
const helper = require('./template.helper');
const BUILT_INS = require('./templates.seed');

// Query templates (Query Template page), shared by everyone who can open it and used from Query Data.
// params and queries are JSON (see template.helper.js). builtin is the key of the built-in template a
// row came from (templates.seed.js): each built-in is added once, and Restore built-ins adds back
// the ones that were deleted.
const SEEDED_KEY = 'querystudio.templates_seeded';

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS query_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          params TEXT NOT NULL DEFAULT '[]',
          queries TEXT NOT NULL DEFAULT '[]',
          builtin TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      // Each built-in is added once (app_meta keeps the keys added), so a deleted one stays deleted
      // and one shipped in a later version still arrives. '1' was the value before keys were kept.
      const row = await get('SELECT value FROM app_meta WHERE key = ?', [SEEDED_KEY]);
      let done = [];
      if (row && row.value === '1') done = ['patient-summary', 'patient-visits', 'patient-merges'];
      else if (row) { try { done = JSON.parse(row.value) || []; } catch (e) { done = []; } }
      const todo = BUILT_INS.map((b) => b.key).filter((k) => !done.includes(k));
      if (todo.length) {
        await addBuiltIns('', todo);
        await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [SEEDED_KEY, JSON.stringify(done.concat(todo))]);
      }
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function fromRow(r) {
  const json = (s) => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };
  const queries = json(r.queries);
  return {
    id: r.id, name: r.name, category: r.category, description: r.description,
    params: json(r.params),
    queries: queries.map((q) => Object.assign({}, q, { collection: helper.collectionOf(q.query) })),
    builtin: r.builtin, created_by: r.created_by, updated_by: r.updated_by, created_at: r.created_at, updated_at: r.updated_at
  };
}

// Sort key within a category: an "… Items" template follows its list ("Patient Bills", then
// "Patient Bill Items"), so a list and its items sit together.
function sortKey(name) {
  const n = String(name || '').trim().toLowerCase();
  const items = / items?$/.test(n);
  const base = n.replace(/ items?$/, '').replace(/s$/, '');
  return [base, items ? 1 : 0, n];
}
function byName(a, b) {
  const x = sortKey(a.name), y = sortKey(b.name);
  for (let i = 0; i < x.length; i++) {
    const c = x[i] < y[i] ? -1 : x[i] > y[i] ? 1 : 0;
    if (c) return c;
  }
  return 0;
}

exports.list = async function () {
  await schema();
  const rows = await all('SELECT * FROM query_templates ORDER BY category COLLATE NOCASE, name COLLATE NOCASE');
  const cat = (r) => String(r.category || '').toLowerCase();
  return rows.sort((a, b) => (cat(a) < cat(b) ? -1 : cat(a) > cat(b) ? 1 : byName(a, b))).map(fromRow);
};

exports.get = async function (id) {
  await schema();
  const row = await get('SELECT * FROM query_templates WHERE id = ?', [id]);
  return row ? fromRow(row) : null;
};

const nameTaken = (name, id) => get('SELECT id FROM query_templates WHERE name = ? COLLATE NOCASE AND id != ?', [name, id || 0]);

/** Creates (no id) or updates a template; the input is checked first. Returns the saved template. */
exports.save = async function (input, username) {
  await schema();
  const t = helper.normalize(input);
  const id = parseInt(input && input.id, 10) || 0;
  if (await nameTaken(t.name, id)) {
    const err = new Error(`There is already a template named "${t.name}". Choose another name.`);
    err.status = 409;
    throw err;
  }
  const params = JSON.stringify(t.params), queries = JSON.stringify(t.queries);
  if (id) {
    const res = await run(
      "UPDATE query_templates SET name = ?, category = ?, description = ?, params = ?, queries = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
      [t.name, t.category, t.description, params, queries, username, id]
    );
    if (!res.changes) {
      const err = new Error('That template no longer exists. Reload the list.');
      err.status = 404;
      throw err;
    }
    return exports.get(id);
  }
  const res = await run(
    'INSERT INTO query_templates (name, category, description, params, queries, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [t.name, t.category, t.description, params, queries, username, username]
  );
  return exports.get(res.lastID);
};

exports.remove = async function (id) {
  await schema();
  return run('DELETE FROM query_templates WHERE id = ?', [id]);
};

// Adds the built-ins that aren't there (by key); one whose name is taken by another template gets " (built-in)".
// keys (optional): only these built-ins.
async function addBuiltIns(username, keys) {
  const have = new Set((await all("SELECT builtin FROM query_templates WHERE builtin != ''")).map((r) => r.builtin));
  const added = [];
  for (const b of BUILT_INS) {
    if (have.has(b.key) || (keys && !keys.includes(b.key))) continue;
    const t = helper.normalize(b);
    let name = t.name;
    if (await nameTaken(name, 0)) name = `${t.name} (built-in)`;
    if (await nameTaken(name, 0)) continue;
    await run(
      'INSERT INTO query_templates (name, category, description, params, queries, builtin, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, t.category, t.description, JSON.stringify(t.params), JSON.stringify(t.queries), b.key, username, username]
    );
    added.push(name);
  }
  return added;
}

exports.restoreBuiltIns = async function (username) {
  await schema();
  return { added: await addBuiltIns(username), total: BUILT_INS.length };
};
