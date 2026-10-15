// E-Learning assignments: an assignment lesson's rules (el_lessons.settings), learners' submissions and their grades.
//   settings        { maxPoints, passPoints, allowText, allowFile, maxFileMb, resubmit }
//   el_submissions  one row per hand-in (a resubmission is a new row; the latest counts), with its grade once graded
//   files           data/elearning/submissions/<user id>/<time>-<name>, sent back only as downloads
// A passing grade marks the lesson complete for the learner; a failing one leaves it open (resubmit, if allowed).
const fs = require('fs');
const path = require('path');
const { run, get, all } = require('../../../app/core/config/sqlite');

const FILES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'elearning', 'submissions');
const FILE_TYPES = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.txt', '.csv', '.rtf',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.zip', '.7z', '.rar'];
const MAX_FILE_MB = 25;
const MAX_TEXT = 100000;

const invalid = (message) => Object.assign(new Error(message), { status: 400, expose: true });
const int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

let ready = null;
function schema() {
  if (!ready) ready = create().catch((err) => { ready = null; throw err; });
  return ready;
}
async function create() {
  await require('./share.model').schema();      // guests' names (el_guests) in the grading list
  await run(`
    CREATE TABLE IF NOT EXISTS el_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted',
      score INTEGER,
      passed INTEGER,
      feedback TEXT NOT NULL DEFAULT '',
      graded_by TEXT NOT NULL DEFAULT '',
      graded_at TEXT,
      submitted_at TEXT NOT NULL
    )`);
  await run('CREATE INDEX IF NOT EXISTS idx_el_submissions_lesson ON el_submissions (lesson_id, user_id, id)');
  await run('CREATE INDEX IF NOT EXISTS idx_el_submissions_course ON el_submissions (course_id, status)');
}
exports.schema = schema;

/** The editor's assignment settings -> stored settings. */
exports.normalize = function (s, where) {
  s = s || {};
  const maxPoints = int(s.maxPoints, 100, 1, 1000);
  const out = {
    maxPoints,
    passPoints: int(s.passPoints, Math.ceil(maxPoints / 2), 0, maxPoints),
    allowText: s.allowText !== false,
    allowFile: s.allowFile !== false,
    maxFileMb: int(s.maxFileMb, 10, 1, MAX_FILE_MB),
    resubmit: s.resubmit !== false
  };
  if (!out.allowText && !out.allowFile) throw invalid(`${where}: allow a text answer, a file, or both.`);
  return out;
};

const view = (r, withText = true) => r && ({
  id: r.id, userId: r.user_id, lessonId: r.lesson_id, status: r.status, score: r.score, passed: r.passed == null ? null : !!r.passed,
  feedback: r.feedback, gradedBy: r.graded_by, gradedAt: r.graded_at, submittedAt: r.submitted_at,
  text: withText ? r.text : undefined, file: r.file_name ? { name: r.file_name, size: r.file_size, url: `/e-learning/submissions/${r.id}/file` } : null,
  learner: r.learner, username: r.username, guest: !!r.guest
});

/** The learner's latest submission of an assignment and how many they made: { latest, count, canSubmit } */
exports.mine = async function (userId, lesson) {
  await schema();
  const rows = await all('SELECT * FROM el_submissions WHERE user_id = ? AND lesson_id = ? ORDER BY id DESC', [userId, lesson.id]);
  const latest = rows[0] || null;
  const s = lesson.settings || {};
  // a first hand-in; an ungraded one can be replaced; a graded one only when it failed and resubmitting is allowed
  const canSubmit = !latest || latest.status === 'submitted' || (!latest.passed && !!s.resubmit);
  return { latest: view(latest), count: rows.length, canSubmit, history: rows.slice(1, 10).map((r) => view(r, false)) };
};

const safeName = (name) => path.basename(String(name || 'file')).replace(/[^\w.\- ()฀-๿]+/g, '_').slice(-120) || 'file';

/** A learner hands in { text, file: { name, data (base64) } }. */
exports.submit = async function (userId, courseId, lesson, body) {
  await schema();
  const s = lesson.settings || {};
  const mine = await exports.mine(userId, lesson);
  if (!mine.canSubmit) throw Object.assign(new Error(mine.latest && mine.latest.passed ? 'This assignment is already graded as passed.' : 'This assignment cannot be submitted again.'), { status: 409, expose: true });
  const text = s.allowText ? String((body && body.text) || '').slice(0, MAX_TEXT) : '';
  const f = s.allowFile && body && body.file && body.file.data ? body.file : null;
  let file = null;
  if (f) {
    const name = safeName(f.name);
    const ext = path.extname(name).toLowerCase();
    if (!FILE_TYPES.includes(ext)) throw invalid(`This type of file can't be handed in. Allowed: ${FILE_TYPES.join(', ')}.`);
    const data = Buffer.from(String(f.data).replace(/^data:[^,]*,/, ''), 'base64');
    if (!data.length) throw invalid('The file is empty.');
    if (data.length > (s.maxFileMb || 10) * 1024 * 1024) throw invalid(`The file is larger than ${s.maxFileMb || 10} MB.`);
    const dir = path.join(FILES_DIR, String(userId));
    await fs.promises.mkdir(dir, { recursive: true });
    const stored = path.join(dir, `${Date.now()}-${name}`);
    await fs.promises.writeFile(stored, data);
    file = { name, size: data.length, path: path.relative(FILES_DIR, stored) };
  } else if (mine.latest && mine.latest.status === 'submitted' && mine.latest.file && body && body.keepFile) {
    // replacing an ungraded hand-in: keep its file when no new one is chosen
    const prev = await get('SELECT file_name, file_path, file_size FROM el_submissions WHERE id = ?', [mine.latest.id]);
    file = { name: prev.file_name, size: prev.file_size, path: prev.file_path };
  }
  if (!text.trim() && !file) throw invalid(s.allowText && s.allowFile ? 'Write an answer or attach a file.' : s.allowFile ? 'Attach a file.' : 'Write your answer.');
  // an ungraded hand-in that is replaced is dropped (its file too, unless kept)
  if (mine.latest && mine.latest.status === 'submitted') {
    const prev = await get('SELECT file_path FROM el_submissions WHERE id = ?', [mine.latest.id]);
    await run('DELETE FROM el_submissions WHERE id = ?', [mine.latest.id]);
    if (prev && prev.file_path && (!file || prev.file_path !== file.path)) await removeFile(prev.file_path);
  }
  await run(`INSERT INTO el_submissions (user_id, lesson_id, course_id, text, file_name, file_path, file_size, status, submitted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
  [userId, lesson.id, courseId, text, file ? file.name : '', file ? file.path : '', file ? file.size : 0, new Date().toISOString()]);
  return exports.mine(userId, lesson);
};

async function removeFile(rel) {
  const full = path.resolve(FILES_DIR, rel);
  if (!full.startsWith(FILES_DIR + path.sep)) return;
  await fs.promises.unlink(full).catch(() => {});
}

exports.get = async function (id) {
  await schema();
  const r = await get(`SELECT s.*, COALESCE(NULLIF(u.name, ''), u.username, g.name || ' (guest)', 'User ' || s.user_id) AS learner, u.username, g.id IS NOT NULL AS guest
                       FROM el_submissions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN el_guests g ON g.id = -s.user_id WHERE s.id = ?`, [id]);
  return r ? Object.assign(view(r), { courseId: r.course_id, filePath: r.file_path }) : null;
};

exports.filePath = (rel) => {
  const full = path.resolve(FILES_DIR, String(rel || ''));
  return rel && full.startsWith(FILES_DIR + path.sep) ? full : null;
};

/** The grading list of a course: every learner's latest submission per assignment. */
exports.list = async function (courseId) {
  await schema();
  const rows = await all(`SELECT s.*, COALESCE(NULLIF(u.name, ''), u.username, g.name || ' (guest)', 'User ' || s.user_id) AS learner, u.username, g.id IS NOT NULL AS guest,
                                 (SELECT COUNT(*) FROM el_submissions x WHERE x.user_id = s.user_id AND x.lesson_id = s.lesson_id) AS count
                          FROM el_submissions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN el_guests g ON g.id = -s.user_id
                          WHERE s.course_id = ? AND s.id = (SELECT MAX(id) FROM el_submissions x WHERE x.user_id = s.user_id AND x.lesson_id = s.lesson_id)
                          ORDER BY s.status = 'submitted' DESC, s.submitted_at DESC`, [courseId]);
  return rows.map((r) => Object.assign(view(r, false), { count: r.count }));
};

exports.pending = async function (courseId) {
  await schema();
  return (await get("SELECT COUNT(*) AS n FROM el_submissions WHERE course_id = ? AND status = 'submitted'", [courseId])).n;
};

/** A course manager grades a submission: { score, feedback }; returns it with passed worked out from passPoints. */
exports.grade = async function (id, lesson, body, username) {
  await schema();
  const s = lesson.settings || {};
  const score = parseInt(body && body.score, 10);
  if (!Number.isFinite(score) || score < 0 || score > (s.maxPoints || 100)) throw invalid(`The score must be a whole number from 0 to ${s.maxPoints || 100}.`);
  const passed = score >= (s.passPoints || 0);
  await run(`UPDATE el_submissions SET status = 'graded', score = ?, passed = ?, feedback = ?, graded_by = ?, graded_at = ? WHERE id = ?`,
    [score, passed ? 1 : 0, String((body && body.feedback) || '').slice(0, 20000), username, new Date().toISOString(), id]);
  return exports.get(id);
};

/** Deletes the submissions (and their files) matching a WHERE on el_submissions. */
exports.removeFor = async function (where, params) {
  await schema();
  const rows = await all(`SELECT file_path FROM el_submissions WHERE ${where} AND file_path != ''`, params);
  await run(`DELETE FROM el_submissions WHERE ${where}`, params);
  for (const r of rows) await removeFile(r.file_path);
};

exports.FILE_TYPES = FILE_TYPES;
exports.MAX_FILE_MB = MAX_FILE_MB;
