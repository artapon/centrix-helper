// E-Learning: courses, their curriculum and each learner's progress, in SQLite.
//   el_courses     a course: its details, thumbnail (a data: URL, resized in the browser) and draft / published
//   el_sections    the sections of a course's curriculum, in order
//   el_lessons     the lessons of a section, in order: text (Markdown), a video (see video.service.js),
//                  a quiz (quiz.model.js) or an assignment (assignments.model.js); `settings` holds the last two's JSON
//   el_progress    a lesson a learner marked complete
//   el_enrolments  a learner who opened a course, and the lesson they were last on ("Continue learning")
// Drafts are seen only by those who may manage courses. Times are ISO strings in UTC.
const { run, get, all } = require('../../../app/core/config/sqlite');
const video = require('./video.service');
const quiz = require('./quiz.model');
const assignments = require('./assignments.model');
const categories = require('./categories.model');

const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'];
const STATUSES = ['draft', 'published'];
const TYPES = ['text', 'video', 'quiz', 'assignment'];
const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_THUMB = 1500000;            // characters of the data: URL (about 1.1 MB of image)
const MAX_CONTENT = 200000;
const MAX_SECTIONS = 100;
const MAX_LESSONS = 500;

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS el_courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          level TEXT NOT NULL DEFAULT 'all',
          instructor TEXT NOT NULL DEFAULT '',
          instructor_bio TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          thumb TEXT,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          published_at TEXT
        )`);
      await run(`
        CREATE TABLE IF NOT EXISTS el_sections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0
        )`);
      await run('CREATE INDEX IF NOT EXISTS idx_el_sections_course ON el_sections (course_id, sort_order)');
      await run(`
        CREATE TABLE IF NOT EXISTS el_lessons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL,
          section_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'text',
          content TEXT NOT NULL DEFAULT '',
          video_source TEXT NOT NULL DEFAULT '',
          video_url TEXT NOT NULL DEFAULT '',
          video_ref TEXT NOT NULL DEFAULT '',
          duration_min INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        )`);
      await run('CREATE INDEX IF NOT EXISTS idx_el_lessons_course ON el_lessons (course_id, sort_order)');
      await run(`
        CREATE TABLE IF NOT EXISTS el_progress (
          user_id INTEGER NOT NULL,
          lesson_id INTEGER NOT NULL,
          course_id INTEGER NOT NULL,
          completed_at TEXT NOT NULL,
          PRIMARY KEY (user_id, lesson_id)
        ) WITHOUT ROWID`);
      await run('CREATE INDEX IF NOT EXISTS idx_el_progress_course ON el_progress (course_id, user_id)');
      await run(`
        CREATE TABLE IF NOT EXISTS el_enrolments (
          user_id INTEGER NOT NULL,
          course_id INTEGER NOT NULL,
          last_lesson_id INTEGER,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, course_id)
        ) WITHOUT ROWID`);
      await run('CREATE INDEX IF NOT EXISTS idx_el_enrolments_course ON el_enrolments (course_id)');
      // Quizzes and assignments (added after the first version): their questions / rules as JSON
      const cols = new Set((await all('PRAGMA table_info(el_lessons)')).map((c) => c.name));
      if (!cols.has('settings')) await run("ALTER TABLE el_lessons ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
      await quiz.schema();
      await assignments.schema();
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}
exports.schema = schema;

const now = () => new Date().toISOString();
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const invalid = (message) => Object.assign(new Error(message), { status: 400, expose: true });
const thumbUrl = (c) => (c.has_thumb ? `/e-learning/courses/${c.id}/thumb?v=${encodeURIComponent(c.updated_at)}` : null);

// One writer at a time: a course is saved as several statements in one transaction.
let queue = Promise.resolve();
function exclusive(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}
async function transaction(fn) {
  return exclusive(async () => {
    await run('BEGIN IMMEDIATE');
    try {
      const out = await fn();
      await run('COMMIT');
      return out;
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

const card = (c, mine) => ({
  id: c.id,
  title: c.title,
  summary: c.summary,
  category: c.category,                                  // the main one (its colour)
  categories: c.categories || (c.category ? [c.category] : []),
  level: c.level,
  instructor: c.instructor,
  status: c.status,
  thumbUrl: thumbUrl(c),
  sections: c.sections || 0,
  lessons: c.lessons || 0,
  videos: c.videos || 0,
  quizzes: c.quizzes || 0,
  assignments: c.assignments || 0,
  minutes: c.minutes || 0,
  learners: c.learners || 0,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
  publishedAt: c.published_at,
  done: mine ? mine.done : 0,
  started: !!mine,
  lastAt: mine ? mine.at : null
});

const COURSE_COLUMNS = `c.id, c.title, c.summary, c.description, c.category, c.level, c.instructor, c.instructor_bio, c.status,
  c.thumb IS NOT NULL AS has_thumb, c.created_by, c.created_at, c.updated_by, c.updated_at, c.published_at,
  (SELECT COUNT(*) FROM el_sections s WHERE s.course_id = c.id) AS sections,
  (SELECT COUNT(*) FROM el_lessons l WHERE l.course_id = c.id) AS lessons,
  (SELECT COUNT(*) FROM el_lessons l WHERE l.course_id = c.id AND l.type = 'video') AS videos,
  (SELECT COUNT(*) FROM el_lessons l WHERE l.course_id = c.id AND l.type = 'quiz') AS quizzes,
  (SELECT COUNT(*) FROM el_lessons l WHERE l.course_id = c.id AND l.type = 'assignment') AS assignments,
  (SELECT COALESCE(SUM(duration_min), 0) FROM el_lessons l WHERE l.course_id = c.id) AS minutes,
  (SELECT COUNT(*) FROM el_enrolments e WHERE e.course_id = c.id) AS learners`;

/** The catalogue: every published course (and drafts when withDrafts), with the user's progress. */
exports.list = async function (userId, withDrafts) {
  await schema();
  const [rows, mine] = await Promise.all([
    all(`SELECT ${COURSE_COLUMNS} FROM el_courses c ${withDrafts ? '' : "WHERE c.status = 'published'"} ORDER BY COALESCE(c.published_at, c.created_at) DESC, c.id DESC`),
    all(`SELECT e.course_id, e.updated_at AS at, (SELECT COUNT(*) FROM el_progress p JOIN el_lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND p.course_id = e.course_id) AS done
         FROM el_enrolments e WHERE e.user_id = ?`, [userId])
  ]);
  const byCourse = new Map(mine.map((m) => [m.course_id, m]));
  const cats = await categories.ofCourses(null);
  return rows.map((c) => card(Object.assign(c, { categories: cats.get(c.id) || [] }), byCourse.get(c.id)));
};

/**
 * A course with its curriculum: { ...card, description, instructorBio, curriculum: [{ id, title, summary, lessons: [...] }] }.
 * withContent: lessons with their text and video link (the editor); else only what the outline shows.
 * userId: each lesson's done flag and the user's last lesson.
 */
exports.get = async function (id, { withContent = false, userId = null } = {}) {
  await schema();
  const c = await get(`SELECT ${COURSE_COLUMNS} FROM el_courses c WHERE c.id = ?`, [id]);
  if (!c) return null;
  c.categories = (await categories.ofCourses([id])).get(id) || [];
  const [sections, lessons, done, enrol] = await Promise.all([
    all('SELECT id, title, summary FROM el_sections WHERE course_id = ? ORDER BY sort_order, id', [id]),
    all(`SELECT id, section_id, title, type, video_source, duration_min${withContent ? ', content, video_url, video_ref, settings' : ''}
         FROM el_lessons WHERE course_id = ? ORDER BY sort_order, id`, [id]),
    userId ? all('SELECT lesson_id FROM el_progress WHERE user_id = ? AND course_id = ?', [userId, id]) : [],
    userId ? get('SELECT last_lesson_id, updated_at FROM el_enrolments WHERE user_id = ? AND course_id = ?', [userId, id]) : null
  ]);
  const doneSet = new Set(done.map((d) => d.lesson_id));
  const curriculum = sections.map((s) => ({ id: s.id, title: s.title, summary: s.summary, lessons: [] }));
  const bySection = new Map(curriculum.map((s) => [s.id, s]));
  lessons.forEach((l) => {
    const s = bySection.get(l.section_id);
    if (!s) return;
    const lesson = { id: l.id, title: l.title, type: l.type, videoSource: l.video_source, durationMin: l.duration_min, done: doneSet.has(l.id) };
    if (withContent) Object.assign(lesson, { content: l.content, videoUrl: l.video_url, videoRef: l.video_ref, settings: quiz.parse(l.settings, {}) });
    s.lessons.push(lesson);
  });
  const mine = enrol ? { done: lessons.filter((l) => doneSet.has(l.id)).length, at: enrol.updated_at } : null;
  return Object.assign(card(c, mine), {
    description: c.description,
    instructorBio: c.instructor_bio,
    createdBy: c.created_by,
    updatedBy: c.updated_by,
    lastLessonId: enrol ? enrol.last_lesson_id : null,
    curriculum
  });
};

/** One lesson of a course with everything the player needs, or null. */
exports.lesson = async function (courseId, lessonId) {
  await schema();
  const l = await get('SELECT * FROM el_lessons WHERE id = ? AND course_id = ?', [lessonId, courseId]);
  if (!l) return null;
  return {
    id: l.id, sectionId: l.section_id, title: l.title, type: l.type, content: l.content, durationMin: l.duration_min,
    videoSource: l.video_source, videoRef: l.video_ref, settings: quiz.parse(l.settings, {}),
    player: l.type === 'video' ? video.player(l.video_source, l.video_ref, `/e-learning/media/${l.id}`) : null
  };
};

exports.lessonVideo = async function (lessonId) {
  await schema();
  return get("SELECT id, course_id, video_source, video_ref FROM el_lessons WHERE id = ? AND type = 'video'", [lessonId]);
};

exports.status = async function (id) {
  await schema();
  const row = await get('SELECT status FROM el_courses WHERE id = ?', [id]);
  return row ? row.status : null;
};

exports.thumb = async function (id) {
  await schema();
  const row = await get('SELECT thumb, updated_at FROM el_courses WHERE id = ?', [id]);
  const m = row && row.thumb && /^data:(image\/[a-z]+);base64,(.*)$/.exec(row.thumb);
  return m ? { type: m[1], data: Buffer.from(m[2], 'base64'), at: row.updated_at } : null;
};

/** The editor's course as sent -> validated fields and curriculum; checks every video link. Throws a 400. */
exports.normalize = async function (body) {
  const b = body || {};
  const title = text(b.title, 200);
  if (!title) throw invalid('The course needs a title.');
  const cats = await categories.resolve(Array.isArray(b.categories) ? b.categories : [b.category]);
  let thumb;                                             // undefined: keep the current one
  if (b.thumb === null || b.thumb === '') thumb = null;
  else if (typeof b.thumb === 'string') {
    if (!THUMB_RE.test(b.thumb)) throw invalid('The thumbnail must be a JPEG, PNG or WebP image.');
    if (b.thumb.length > MAX_THUMB) throw invalid('The thumbnail is too large; choose a smaller image.');
    thumb = b.thumb;
  }
  const sections = Array.isArray(b.curriculum) ? b.curriculum : [];
  if (sections.length > MAX_SECTIONS) throw invalid(`A course can have at most ${MAX_SECTIONS} sections.`);
  let count = 0;
  const curriculum = [];
  for (const [si, s] of sections.entries()) {
    const sTitle = text(s && s.title, 200);
    if (!sTitle) throw invalid(`Section ${si + 1} needs a title.`);
    const lessons = [];
    for (const [li, l] of (Array.isArray(s.lessons) ? s.lessons : []).entries()) {
      if (++count > MAX_LESSONS) throw invalid(`A course can have at most ${MAX_LESSONS} lessons.`);
      const where = `"${sTitle}", lesson ${li + 1}`;
      const lTitle = text(l && l.title, 200);
      if (!lTitle) throw invalid(`${where} needs a title.`);
      const type = TYPES.includes(l.type) ? l.type : 'text';
      const content = String(l.content == null ? '' : l.content).slice(0, MAX_CONTENT);
      let source = '', url = '', ref = '', settings = {};
      if (type === 'quiz') settings = quiz.normalize(l.settings, `${where} ("${lTitle}")`);
      else if (type === 'assignment') {
        settings = assignments.normalize(l.settings, `${where} ("${lTitle}")`);
        if (!content.trim()) throw invalid(`${where} ("${lTitle}") needs instructions: what should learners hand in?`);
      } else if (type === 'video') {
        source = String(l.videoSource || '');
        url = text(l.videoUrl, 2000);
        try { ref = await video.normalize(source, url); } catch (err) { throw invalid(`${where} ("${lTitle}"): ${err.message}`); }
      } else if (type === 'text' && !content.trim()) throw invalid(`${where} ("${lTitle}") has no text yet.`);
      lessons.push({ id: int(l.id, null, 1, Number.MAX_SAFE_INTEGER), title: lTitle, type, content, source, url, ref, settings, duration: int(l.durationMin, 0, 0, 100000) });
    }
    curriculum.push({ id: int(s.id, null, 1, Number.MAX_SAFE_INTEGER), title: sTitle, summary: text(s.summary, 1000), lessons });
  }
  return {
    title,
    summary: text(b.summary, 500),
    description: String(b.description == null ? '' : b.description).slice(0, MAX_CONTENT),
    categories: cats,
    category: cats.length ? cats[0].name : '',
    level: LEVELS.includes(b.level) ? b.level : 'all',
    instructor: text(b.instructor, 120),
    instructorBio: text(b.instructorBio, 2000),
    status: STATUSES.includes(b.status) ? b.status : 'draft',
    thumb,
    curriculum
  };
};

/**
 * Creates (id null) or updates a course from normalize(). Sections and lessons that keep their id are
 * updated (so learners keep their progress), new ones are added and the ones left out are deleted.
 */
exports.save = async function (id, f, username) {
  await schema();
  return transaction(async () => {
    const at = now();
    let courseId = id;
    if (id) {
      const cur = await get('SELECT status, published_at FROM el_courses WHERE id = ?', [id]);
      if (!cur) return null;
      const publishedAt = f.status === 'published' ? cur.published_at || at : cur.published_at;
      await run(`UPDATE el_courses SET title = ?, summary = ?, description = ?, category = ?, level = ?, instructor = ?, instructor_bio = ?,
                 status = ?, updated_by = ?, updated_at = ?, published_at = ?${f.thumb !== undefined ? ', thumb = ?' : ''} WHERE id = ?`,
      [f.title, f.summary, f.description, f.category, f.level, f.instructor, f.instructorBio, f.status, username, at, publishedAt]
        .concat(f.thumb !== undefined ? [f.thumb] : [], [id]));
    } else {
      const r = await run(`INSERT INTO el_courses (title, summary, description, category, level, instructor, instructor_bio, status, thumb,
                           created_by, created_at, updated_by, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.title, f.summary, f.description, f.category, f.level, f.instructor, f.instructorBio, f.status, f.thumb || null,
        username, at, username, at, f.status === 'published' ? at : null]);
      courseId = r.lastID;
    }
    await categories.setForCourse(courseId, f.categories);

    const oldSections = new Set((await all('SELECT id FROM el_sections WHERE course_id = ?', [courseId])).map((r) => r.id));
    const oldLessons = new Set((await all('SELECT id FROM el_lessons WHERE course_id = ?', [courseId])).map((r) => r.id));
    const keepSections = new Set();
    const keepLessons = new Set();
    for (const [si, s] of f.curriculum.entries()) {
      let sid = s.id && oldSections.has(s.id) ? s.id : null;
      if (sid) await run('UPDATE el_sections SET title = ?, summary = ?, sort_order = ? WHERE id = ?', [s.title, s.summary, si, sid]);
      else sid = (await run('INSERT INTO el_sections (course_id, title, summary, sort_order) VALUES (?, ?, ?, ?)', [courseId, s.title, s.summary, si])).lastID;
      keepSections.add(sid);
      for (const [li, l] of s.lessons.entries()) {
        const vals = [sid, l.title, l.type, l.content, l.source, l.url, l.ref, JSON.stringify(l.settings || {}), l.duration, li];
        if (l.id && oldLessons.has(l.id) && !keepLessons.has(l.id)) {
          await run(`UPDATE el_lessons SET section_id = ?, title = ?, type = ?, content = ?, video_source = ?, video_url = ?, video_ref = ?,
                     settings = ?, duration_min = ?, sort_order = ? WHERE id = ?`, vals.concat(l.id));
          keepLessons.add(l.id);
        } else {
          keepLessons.add((await run(`INSERT INTO el_lessons (course_id, section_id, title, type, content, video_source, video_url, video_ref, settings, duration_min, sort_order)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [courseId].concat(vals))).lastID);
        }
      }
    }
    const gone = [...oldLessons].filter((x) => !keepLessons.has(x));
    if (gone.length) {
      const marks = gone.map(() => '?').join(',');
      await run(`DELETE FROM el_lessons WHERE id IN (${marks})`, gone);
      await run(`DELETE FROM el_progress WHERE lesson_id IN (${marks})`, gone);
      await run(`UPDATE el_enrolments SET last_lesson_id = NULL WHERE last_lesson_id IN (${marks})`, gone);
      await quiz.removeFor(`lesson_id IN (${marks})`, gone);
      await assignments.removeFor(`lesson_id IN (${marks})`, gone);
    }
    const goneSections = [...oldSections].filter((x) => !keepSections.has(x));
    if (goneSections.length) await run(`DELETE FROM el_sections WHERE id IN (${goneSections.map(() => '?').join(',')})`, goneSections);
    return courseId;
  });
};

exports.remove = async function (id) {
  await schema();
  return transaction(async () => {
    const r = await run('DELETE FROM el_courses WHERE id = ?', [id]);
    if (!r.changes) return false;
    for (const table of ['el_sections', 'el_lessons', 'el_progress', 'el_enrolments']) await run(`DELETE FROM ${table} WHERE course_id = ?`, [id]);
    await quiz.removeFor('course_id = ?', [id]);
    await assignments.removeFor('course_id = ?', [id]);
    await require('./share.model').removeCourse(id);
    await categories.removeCourse(id);
    return true;
  });
};

/** The learner opened a lesson: they are enrolled, and it is where "Continue learning" goes. */
exports.touch = async function (userId, courseId, lessonId) {
  await schema();
  const at = now();
  await run(`INSERT INTO el_enrolments (user_id, course_id, last_lesson_id, started_at, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, course_id) DO UPDATE SET last_lesson_id = excluded.last_lesson_id, updated_at = excluded.updated_at`,
  [userId, courseId, lessonId, at, at]);
};

/** Marks a lesson complete (or not) for the learner; returns the course's progress { done, total }. */
exports.setDone = async function (userId, courseId, lessonId, done) {
  await schema();
  if (done) {
    await run('INSERT OR IGNORE INTO el_progress (user_id, lesson_id, course_id, completed_at) VALUES (?, ?, ?, ?)', [userId, lessonId, courseId, now()]);
  } else {
    await run('DELETE FROM el_progress WHERE user_id = ? AND lesson_id = ?', [userId, lessonId]);
  }
  const row = await get(`SELECT (SELECT COUNT(*) FROM el_lessons WHERE course_id = ?) AS total,
                                (SELECT COUNT(*) FROM el_progress p JOIN el_lessons l ON l.id = p.lesson_id WHERE p.user_id = ? AND p.course_id = ?) AS done`,
  [courseId, userId, courseId]);
  return { done: row.done, total: row.total };
};

exports.LEVELS = LEVELS;
