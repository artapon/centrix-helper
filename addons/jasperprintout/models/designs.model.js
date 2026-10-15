// Jasper Designer: saved report designs (SQLite), shared by everyone who can open the designer.
// Each row keeps the design JSON and its images ({ name: data URL }) apart, so listing is cheap.
// Designs live in folders ("path", e.g. "Lab/Results"; '' is the top level). Folders are rows of
// jasper_design_folders, so an empty folder stays until it is deleted.
// Saving over a design first copies what was saved before into jasper_design_versions; the last
// KEEP_VERSIONS copies of each design are kept. An auto save only adds a copy when the newest one is
// at least AUTO_VERSION_MINUTES old, so a run of auto saves doesn't push out the manual versions.
const { run, get, all } = require('../../../app/core/config/sqlite');

const KEEP_VERSIONS = 3;
const AUTO_VERSION_MINUTES = 10;
exports.KEEP_VERSIONS = KEEP_VERSIONS;

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS jasper_designs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          design TEXT NOT NULL,
          images TEXT NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      await run('CREATE INDEX IF NOT EXISTS idx_jasper_designs_updated ON jasper_designs (updated_at)');
      const cols = new Set((await all('PRAGMA table_info(jasper_designs)')).map((c) => c.name));
      if (!cols.has('path')) await run("ALTER TABLE jasper_designs ADD COLUMN path TEXT NOT NULL DEFAULT ''");
      await run(`
        CREATE TABLE IF NOT EXISTS jasper_design_folders (
          path TEXT PRIMARY KEY,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      await run(`
        CREATE TABLE IF NOT EXISTS jasper_design_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          design_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL DEFAULT '',
          design TEXT NOT NULL,
          images TEXT NOT NULL DEFAULT '{}',
          saved_by TEXT NOT NULL DEFAULT '',
          saved_at TEXT,
          archived_at TEXT DEFAULT (datetime('now'))
        )
      `);
      await run('CREATE INDEX IF NOT EXISTS idx_jasper_design_versions_design ON jasper_design_versions (design_id, id)');
      await run(`
        CREATE TABLE IF NOT EXISTS jasper_design_publishes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          design_id INTEGER NOT NULL,
          uri TEXT NOT NULL,
          data_source TEXT NOT NULL DEFAULT '',
          his_code TEXT NOT NULL DEFAULT '',
          his_name TEXT NOT NULL DEFAULT '',
          his_locale TEXT NOT NULL DEFAULT '',
          his_site TEXT NOT NULL DEFAULT '',
          published_by TEXT NOT NULL DEFAULT '',
          published_at TEXT DEFAULT (datetime('now'))
        )
      `);
      await run('CREATE INDEX IF NOT EXISTS idx_jasper_design_publishes_design ON jasper_design_publishes (design_id, id)');
      const pubCols = new Set((await all('PRAGMA table_info(jasper_design_publishes)')).map((c) => c.name));
      if (!pubCols.has('server')) await run("ALTER TABLE jasper_design_publishes ADD COLUMN server TEXT NOT NULL DEFAULT ''");
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

exports.list = async function () {
  await schema();
  const designs = await all(`SELECT id, name, path, created_by, updated_by, created_at, updated_at, length(design) + length(images) AS size
              FROM jasper_designs ORDER BY updated_at DESC, id DESC`);
  const folders = await all('SELECT path, created_by, created_at FROM jasper_design_folders ORDER BY path');
  return { designs, folders };
};

// Creates the folder and any missing parents. Returns false when it already existed.
exports.createFolder = async function (path, username) {
  await schema();
  const parts = path.split('/');
  let created = false;
  for (let i = 1; i <= parts.length; i++) {
    const r = await run('INSERT OR IGNORE INTO jasper_design_folders (path, created_by) VALUES (?, ?)', [parts.slice(0, i).join('/'), username]);
    if (i === parts.length) created = r.changes > 0;
  }
  return created;
};

// Only an empty folder (no designs, no subfolders) can be deleted.
exports.removeFolder = async function (path) {
  await schema();
  const prefix = path + '/';
  const inside = await get(`SELECT (SELECT COUNT(*) FROM jasper_designs WHERE path = ? OR substr(path, 1, ?) = ?)
                                 + (SELECT COUNT(*) FROM jasper_design_folders WHERE substr(path, 1, ?) = ?) AS n`,
  [path, prefix.length, prefix, prefix.length, prefix]);
  if (inside.n) return 'not-empty';
  const r = await run('DELETE FROM jasper_design_folders WHERE path = ?', [path]);
  return r.changes > 0 ? 'ok' : 'missing';
};

exports.folderExists = async function (path) {
  if (!path) return true;
  await schema();
  return !!(await get('SELECT 1 AS x FROM jasper_design_folders WHERE path = ?', [path]));
};

exports.get = async function (id) {
  await schema();
  const row = await get('SELECT * FROM jasper_designs WHERE id = ?', [id]);
  if (!row) return null;
  let design = null, images = {};
  try { design = JSON.parse(row.design); } catch (e) { design = null; }
  try { images = JSON.parse(row.images) || {}; } catch (e) { images = {}; }
  return { id: row.id, name: row.name, path: row.path || '', design, images, createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at };
};

// Copies the saved design into its versions (unless nothing changed) and trims to KEEP_VERSIONS.
async function archive(id, json, imgs, auto) {
  const cur = await get('SELECT name, path, design, images, updated_by, updated_at FROM jasper_designs WHERE id = ?', [id]);
  if (!cur || (cur.design === json && cur.images === imgs)) return;
  if (auto) {
    const recent = await get(`SELECT 1 AS x FROM jasper_design_versions WHERE design_id = ? AND archived_at > datetime('now', ?)`,
      [id, `-${AUTO_VERSION_MINUTES} minutes`]);
    if (recent) return;
  }
  await run('INSERT INTO jasper_design_versions (design_id, name, path, design, images, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, cur.name, cur.path || '', cur.design, cur.images, cur.updated_by, cur.updated_at]);
  await run(`DELETE FROM jasper_design_versions WHERE design_id = ? AND id NOT IN
               (SELECT id FROM jasper_design_versions WHERE design_id = ? ORDER BY id DESC LIMIT ?)`, [id, id, KEEP_VERSIONS]);
}

exports.versions = async function (id) {
  await schema();
  return all(`SELECT id, name, path, saved_by, saved_at, archived_at, length(design) + length(images) AS size
              FROM jasper_design_versions WHERE design_id = ? ORDER BY id DESC`, [id]);
};

exports.version = async function (id, versionId) {
  await schema();
  const row = await get('SELECT * FROM jasper_design_versions WHERE design_id = ? AND id = ?', [id, versionId]);
  if (!row) return null;
  let design = null, images = {};
  try { design = JSON.parse(row.design); } catch (e) { design = null; }
  try { images = JSON.parse(row.images) || {}; } catch (e) { images = {}; }
  return { id: row.id, designId: row.design_id, name: row.name, path: row.path || '', design, images, savedBy: row.saved_by, savedAt: row.saved_at };
};

exports.save = async function ({ id, name, path, design, images, username, auto }) {
  await schema();
  const json = JSON.stringify(design);
  const imgs = JSON.stringify(images || {});
  path = path || '';
  if (id) {
    await archive(id, json, imgs, auto);
    const r = await run("UPDATE jasper_designs SET name = ?, path = ?, design = ?, images = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
      [name, path, json, imgs, username, id]);
    if (!r.changes) return null;
    return id;
  }
  const r = await run('INSERT INTO jasper_designs (name, path, design, images, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)', [name, path, json, imgs, username, username]);
  return r.lastID;
};

exports.remove = async function (id) {
  await schema();
  const r = await run('DELETE FROM jasper_designs WHERE id = ?', [id]);
  await run('DELETE FROM jasper_design_versions WHERE design_id = ?', [id]);
  await run('DELETE FROM jasper_design_publishes WHERE design_id = ?', [id]);
  return r.changes > 0;
};

// Reports > Publish: each publish of a saved design (to JasperServer, and to HIS when his_code is set).
exports.recordPublish = async function ({ designId, uri, dataSource, server, hisCode, hisName, hisLocale, hisSite, username }) {
  await schema();
  await run(`INSERT INTO jasper_design_publishes (design_id, uri, data_source, server, his_code, his_name, his_locale, his_site, published_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [designId, uri, dataSource || '', server || '', hisCode || '', hisName || '', hisLocale || '', hisSite || '', username]);
};

const publishRow = (r) => ({ id: r.id, uri: r.uri, dataSource: r.data_source, server: r.server || '', hisCode: r.his_code, hisName: r.his_name, hisLocale: r.his_locale, hisSite: r.his_site, by: r.published_by, at: r.published_at });

// Every publish of one design, newest first.
exports.publishHistory = async function (designId, limit = 100) {
  await schema();
  const rows = await all('SELECT * FROM jasper_design_publishes WHERE design_id = ? ORDER BY id DESC LIMIT ?', [designId, limit]);
  return rows.map(publishRow);
};

// The latest publish of every design, and the latest one registered in HIS: { [designId]: { last, his } }.
exports.lastPublishes = async function () {
  await schema();
  const rows = await all(`SELECT p.* FROM jasper_design_publishes p
                            JOIN (SELECT MAX(id) AS id FROM jasper_design_publishes GROUP BY design_id
                                  UNION SELECT MAX(id) FROM jasper_design_publishes WHERE his_code <> '' GROUP BY design_id) m ON m.id = p.id
                           ORDER BY p.id`);
  const out = {};
  rows.forEach((r) => {
    const row = publishRow(r);
    const e = out[r.design_id] || (out[r.design_id] = { last: null, his: null });
    e.last = row;                       // rows are in id order, so the newest wins
    if (r.his_code) e.his = row;
  });
  return out;
};
