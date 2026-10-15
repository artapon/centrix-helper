// E-Learning > Categories: the list a course's categories are picked from (the course editor).
//   el_categories         a category: its name (unique, case-insensitive), a description and its place in the list
//   el_course_categories  the categories of a course, in the order picked; the first is the course's main one,
//                         whose name is also kept in el_courses.category (its colour, the course page's breadcrumb)
// Deleting a category takes it off its courses. Categories typed on courses before this list existed are added to
// it on start-up.
const { run, get, all } = require('../../../app/core/config/sqlite');

const MAX_NAME = 80;

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await require('./courses.model').schema();
      await run(`
        CREATE TABLE IF NOT EXISTS el_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          description TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`);
      await run(`
        CREATE TABLE IF NOT EXISTS el_course_categories (
          course_id INTEGER NOT NULL,
          category_id INTEGER NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (course_id, category_id)
        ) WITHOUT ROWID`);
      await run('CREATE INDEX IF NOT EXISTS idx_el_course_categories_cat ON el_course_categories (category_id)');
      const at = now();
      await run(`INSERT OR IGNORE INTO el_categories (name, sort_order, created_at, updated_at)
                 SELECT DISTINCT category, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM el_categories), ?, ? FROM el_courses WHERE category != ''`, [at, at]);
      // a course's one category from before courses had many
      await run(`INSERT OR IGNORE INTO el_course_categories (course_id, category_id, position)
                 SELECT c.id, k.id, 0 FROM el_courses c JOIN el_categories k ON k.name = c.category COLLATE NOCASE
                 WHERE c.category != '' AND NOT EXISTS (SELECT 1 FROM el_course_categories j WHERE j.course_id = c.id)`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}
exports.schema = schema;

const now = () => new Date().toISOString();
const text = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
const invalid = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

const view = (c) => ({
  id: c.id, name: c.name, description: c.description, sortOrder: c.sort_order, courses: c.courses || 0,
  createdBy: c.created_by, createdAt: c.created_at, updatedBy: c.updated_by, updatedAt: c.updated_at
});

/** Every category in order, with how many courses are in it. */
exports.list = async function () {
  await schema();
  return (await all(`SELECT c.*, (SELECT COUNT(*) FROM el_course_categories j WHERE j.category_id = c.id) AS courses
                     FROM el_categories c ORDER BY c.sort_order, c.name COLLATE NOCASE`)).map(view);
};

/** The names, in order (the editor's select). */
exports.names = async function () {
  return (await exports.list()).map((c) => c.name);
};

async function clean(b, id) {
  const name = text(b && b.name, MAX_NAME);
  if (!name) throw invalid('Enter the category name.');
  const same = await get('SELECT id FROM el_categories WHERE name = ? COLLATE NOCASE AND id != ?', [name, id || 0]);
  if (same) throw invalid(`There is already a category "${name}".`, 409);
  return { name, description: text(b.description, 500) };
}

exports.create = async function (b, username) {
  await schema();
  const f = await clean(b);
  const at = now();
  const r = await run(`INSERT INTO el_categories (name, description, sort_order, created_by, created_at, updated_by, updated_at)
                       VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM el_categories), ?, ?, ?, ?)`, [f.name, f.description, username, at, username, at]);
  return exports.get(r.lastID);
};

exports.get = async function (id) {
  await schema();
  const c = await get(`SELECT c.*, (SELECT COUNT(*) FROM el_course_categories j WHERE j.category_id = c.id) AS courses
                       FROM el_categories c WHERE c.id = ?`, [id]);
  return c ? view(c) : null;
};

/** Changes a category (a new name is also its courses' main category's name). Null when it does not exist. */
exports.update = async function (id, b, username) {
  await schema();
  const cur = await get('SELECT * FROM el_categories WHERE id = ?', [id]);
  if (!cur) return null;
  const f = await clean(b, id);
  await run('UPDATE el_categories SET name = ?, description = ?, updated_by = ?, updated_at = ? WHERE id = ?', [f.name, f.description, username, now(), id]);
  if (f.name !== cur.name) await run('UPDATE el_courses SET category = ? WHERE category = ? COLLATE NOCASE', [f.name, cur.name]);
  return exports.get(id);
};

/** Deletes a category and takes it off its courses (their next category becomes the main one). False when it does not exist. */
exports.remove = async function (id) {
  await schema();
  const cur = await get('SELECT name FROM el_categories WHERE id = ?', [id]);
  if (!cur) return false;
  const courses = (await all('SELECT course_id FROM el_course_categories WHERE category_id = ?', [id])).map((r) => r.course_id);
  await run('DELETE FROM el_course_categories WHERE category_id = ?', [id]);
  await run('DELETE FROM el_categories WHERE id = ?', [id]);
  for (const courseId of courses) await mainCategory(courseId);
  return true;
};

// el_courses.category: the name of the course's first category, or ''.
async function mainCategory(courseId) {
  await run(`UPDATE el_courses SET category = COALESCE((SELECT k.name FROM el_course_categories j JOIN el_categories k ON k.id = j.category_id
                                                        WHERE j.course_id = el_courses.id ORDER BY j.position LIMIT 1), '') WHERE id = ?`, [courseId]);
}

/** Names as the editor sends them -> [{ id, name }] in that order, without repeats. Throws a 400 for a name not in the list. */
exports.resolve = async function (names) {
  await schema();
  const out = [];
  for (const n of Array.isArray(names) ? names : []) {
    const name = text(n, MAX_NAME);
    if (!name) continue;
    const c = await get('SELECT id, name FROM el_categories WHERE name = ? COLLATE NOCASE', [name]);
    if (!c) throw invalid(`There is no category "${name}" (it may have been deleted). Reload the page and pick again.`);
    if (!out.some((x) => x.id === c.id)) out.push(c);
  }
  return out;
};

/** Sets a course's categories (from resolve()); the first is its main one. Run inside the course's transaction. */
exports.setForCourse = async function (courseId, list) {
  await run('DELETE FROM el_course_categories WHERE course_id = ?', [courseId]);
  for (const [i, c] of list.entries()) await run('INSERT INTO el_course_categories (course_id, category_id, position) VALUES (?, ?, ?)', [courseId, c.id, i]);
  await mainCategory(courseId);
};

/** courseId -> [category names, main first], for the given courses (or all when ids is null). */
exports.ofCourses = async function (ids) {
  await schema();
  const where = ids ? `WHERE j.course_id IN (${ids.map(() => '?').join(',') || 'NULL'})` : '';
  const rows = await all(`SELECT j.course_id, k.name FROM el_course_categories j JOIN el_categories k ON k.id = j.category_id
                          ${where} ORDER BY j.course_id, j.position`, ids || []);
  const out = new Map();
  rows.forEach((r) => { if (!out.has(r.course_id)) out.set(r.course_id, []); out.get(r.course_id).push(r.name); });
  return out;
};

exports.removeCourse = async function (courseId) {
  await schema();
  await run('DELETE FROM el_course_categories WHERE course_id = ?', [courseId]);
};

/** The order of the list: the ids, first to last (ids not given keep their place after them). */
exports.reorder = async function (ids) {
  await schema();
  const list = (Array.isArray(ids) ? ids : []).map((v) => parseInt(v, 10)).filter(Number.isFinite);
  for (let i = 0; i < list.length; i++) await run('UPDATE el_categories SET sort_order = ? WHERE id = ?', [i + 1, list[i]]);
  return exports.list();
};
