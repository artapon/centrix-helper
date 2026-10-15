// E-Learning > Share Courses: a course opened by link, without signing in, after entering its password.
// The share of course id 0 (ALL) is the whole catalogue: every published course behind one link and password.
//   el_shares  one per shared course (and one for ALL): the link's token, the password (scrypt hash), when the link expires and
//              what guests may do; `pw_version` goes up with each new password, so every guest must enter it again
//   el_guests  someone who unlocked a shared course: the name they gave and a hash of their cookie's token
// A guest learns like a user: their progress, quiz attempts and submissions are kept under user id -<guest id>
// (users have positive ids), so a guest picks up where they left off on the same browser.
const crypto = require('crypto');
const { run, get, all } = require('../../../app/core/config/sqlite');
const password = require('../../../app/core/helpers/password');

const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
const MIN_PASSWORD = 4;
const GUEST_DAYS = 180;
const ALL = 0;

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS el_shares (
          course_id INTEGER PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          enabled INTEGER NOT NULL DEFAULT 1,
          password_hash TEXT NOT NULL,
          pw_version INTEGER NOT NULL DEFAULT 1,
          expires_at TEXT,
          allow_assignments INTEGER NOT NULL DEFAULT 1,
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`);
      await run(`
        CREATE TABLE IF NOT EXISTS el_guests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          pw_version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_at TEXT NOT NULL
        )`);
      await run('CREATE INDEX IF NOT EXISTS idx_el_guests_course ON el_guests (course_id)');
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}
exports.schema = schema;

const now = () => new Date().toISOString();
const newToken = (bytes) => crypto.randomBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const invalid = (message) => Object.assign(new Error(message), { status: 400, expose: true });

const view = (s) => s && ({
  courseId: s.course_id, token: s.token, link: `/learn/${s.token}`, enabled: !!s.enabled, expiresAt: s.expires_at,
  expired: !!(s.expires_at && s.expires_at < now()), allowAssignments: !!s.allow_assignments, note: s.note,
  createdBy: s.created_by, createdAt: s.created_at, updatedBy: s.updated_by, updatedAt: s.updated_at,
  guests: s.guests || 0, lastGuestAt: s.last_guest_at || null
});

/** Every course with its share (or null): the Share Courses page. */
exports.overview = async function () {
  await schema();
  const rows = await all(`SELECT c.id, c.title, c.status, c.category, c.thumb IS NOT NULL AS has_thumb, c.updated_at,
                                 (SELECT COUNT(*) FROM el_lessons l WHERE l.course_id = c.id) AS lessons,
                                 s.*, (SELECT COUNT(*) FROM el_guests g WHERE g.course_id = c.id) AS guests,
                                 (SELECT MAX(last_at) FROM el_guests g WHERE g.course_id = c.id) AS last_guest_at
                          FROM el_courses c LEFT JOIN el_shares s ON s.course_id = c.id
                          ORDER BY s.enabled IS NULL, s.enabled DESC, c.title COLLATE NOCASE`);
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, category: r.category, lessons: r.lessons,
    thumbUrl: r.has_thumb ? `/e-learning/courses/${r.id}/thumb?v=${encodeURIComponent(r.updated_at)}` : null,
    share: r.token ? view(Object.assign({}, r, { course_id: r.id })) : null
  }));
};

/** The share of every course (or null), with what it opens: { share, courses, lessons }. */
exports.catalogue = async function () {
  await schema();
  const n = await get(`SELECT COUNT(*) AS courses, (SELECT COUNT(*) FROM el_lessons l JOIN el_courses c ON c.id = l.course_id WHERE c.status = 'published') AS lessons
                       FROM el_courses WHERE status = 'published'`);
  return { share: await exports.forCourse(ALL), courses: n.courses, lessons: n.lessons };
};

/**
 * Turns sharing on / changes it: { enabled, password, expiresAt ('YYYY-MM-DD' or ''), allowAssignments, note }.
 * The first share needs a password; later an empty password keeps the current one.
 */
exports.save = async function (courseId, b, username) {
  await schema();
  b = b || {};
  const cur = await get('SELECT * FROM el_shares WHERE course_id = ?', [courseId]);
  const pw = String(b.password || '');
  if (!cur && !pw) throw invalid('Set a password for the shared course.');
  if (pw && pw.length < MIN_PASSWORD) throw invalid(`The password needs at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 200) throw invalid('The password is too long.');
  let expires = null;
  if (b.expiresAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.expiresAt))) throw invalid('The expiry date is not valid.');
    expires = new Date(`${b.expiresAt}T23:59:59`).toISOString();      // end of that day, server time
  }
  const at = now();
  const fields = [b.enabled === false ? 0 : 1, expires, b.allowAssignments === false ? 0 : 1, String(b.note || '').trim().slice(0, 300), username, at];
  if (!cur) {
    await run(`INSERT INTO el_shares (enabled, expires_at, allow_assignments, note, updated_by, updated_at, course_id, token, password_hash, pw_version, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, fields.concat([courseId, newToken(24), await password.hash(pw), username, at]));
  } else if (pw) {
    await run(`UPDATE el_shares SET enabled = ?, expires_at = ?, allow_assignments = ?, note = ?, updated_by = ?, updated_at = ?,
               password_hash = ?, pw_version = pw_version + 1 WHERE course_id = ?`, fields.concat([await password.hash(pw), courseId]));
  } else {
    await run('UPDATE el_shares SET enabled = ?, expires_at = ?, allow_assignments = ?, note = ?, updated_by = ?, updated_at = ? WHERE course_id = ?', fields.concat([courseId]));
  }
  return exports.forCourse(courseId);
};

exports.forCourse = async function (courseId) {
  await schema();
  return view(await get(`SELECT s.*, (SELECT COUNT(*) FROM el_guests g WHERE g.course_id = s.course_id) AS guests,
                                (SELECT MAX(last_at) FROM el_guests g WHERE g.course_id = s.course_id) AS last_guest_at
                         FROM el_shares s WHERE s.course_id = ?`, [courseId]));
};

/** A new link: the old one stops working at once (guests keep their progress, but need the new link). */
exports.regenerate = async function (courseId, username) {
  await schema();
  await run('UPDATE el_shares SET token = ?, updated_by = ?, updated_at = ? WHERE course_id = ?', [newToken(24), username, now(), courseId]);
  return exports.forCourse(courseId);
};

/** Stops sharing and forgets the link and password; guests' records stay until the course is deleted. */
exports.remove = async function (courseId) {
  await schema();
  await run('DELETE FROM el_shares WHERE course_id = ?', [courseId]);
};

/** The share of a link that is on and not expired, with its course id, or null. */
exports.open = async function (token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  await schema();
  const s = await get('SELECT * FROM el_shares WHERE token = ?', [token]);
  if (!s || !s.enabled || (s.expires_at && s.expires_at < now())) return null;
  return s;
};

exports.checkPassword = (share, pw) => password.verify(String(pw || ''), share.password_hash).catch(() => false);

/** The guest of a cookie token for this share, while their password is still the current one. */
exports.guest = async function (share, cookieToken) {
  if (!cookieToken) return null;
  await schema();
  const g = await get('SELECT * FROM el_guests WHERE token_hash = ? AND course_id = ?', [sha(cookieToken), share.course_id]);
  if (!g || g.pw_version !== share.pw_version || g.last_at < new Date(Date.now() - GUEST_DAYS * 86400000).toISOString()) return null;
  // seen at most once a minute, so each request is not a write
  if (g.last_at < new Date(Date.now() - 60000).toISOString()) await run('UPDATE el_guests SET last_at = ? WHERE id = ?', [now(), g.id]);
  return g;
};

/**
 * After the right password: the guest of the cookie (they unlocked before, e.g. before a new password) or a new
 * one. Returns { guest, cookieToken } — the token goes in the guest's cookie; only its hash is stored.
 */
exports.unlock = async function (share, cookieToken, name) {
  await schema();
  const at = now();
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!clean) throw invalid('Enter your name.');
  const known = cookieToken ? await get('SELECT * FROM el_guests WHERE token_hash = ? AND course_id = ?', [sha(cookieToken), share.course_id]) : null;
  if (known) {
    await run('UPDATE el_guests SET name = ?, pw_version = ?, last_at = ? WHERE id = ?', [clean, share.pw_version, at, known.id]);
    return { guest: Object.assign(known, { name: clean, pw_version: share.pw_version }), cookieToken };
  }
  const token = newToken(32);
  const r = await run('INSERT INTO el_guests (course_id, token_hash, name, pw_version, created_at, last_at) VALUES (?, ?, ?, ?, ?, ?)',
    [share.course_id, sha(token), clean, share.pw_version, at, at]);
  return { guest: { id: r.lastID, course_id: share.course_id, name: clean, pw_version: share.pw_version }, cookieToken: token };
};

/** The guests of a course with their progress: { id, name, startedAt, lastAt, done, total, quizzes, submissions } */
// Guests of ALL: their progress over every published course.
exports.guests = async function (courseId) {
  await schema();
  const inCourse = courseId === ALL ? "IN (SELECT id FROM el_courses WHERE status = 'published')" : '= g.course_id';
  return (await all(`SELECT g.id, g.name, g.created_at, g.last_at,
                            (SELECT COUNT(*) FROM el_progress p JOIN el_lessons l ON l.id = p.lesson_id WHERE p.user_id = -g.id AND l.course_id ${inCourse}) AS done,
                            (SELECT COUNT(*) FROM el_lessons l WHERE l.course_id ${inCourse}) AS total,
                            (SELECT COUNT(*) FROM el_quiz_attempts a WHERE a.user_id = -g.id) AS attempts,
                            (SELECT COUNT(*) FROM el_submissions s WHERE s.user_id = -g.id) AS submissions
                     FROM el_guests g WHERE g.course_id = ? ORDER BY g.last_at DESC`, [courseId]))
    .map((g) => ({ id: g.id, name: g.name, startedAt: g.created_at, lastAt: g.last_at, done: g.done, total: g.total, attempts: g.attempts, submissions: g.submissions }));
};

/** Removes a guest and everything they did (their cookie no longer opens the course). */
exports.removeGuest = async function (courseId, guestId) {
  await schema();
  const g = await get('SELECT id FROM el_guests WHERE id = ? AND course_id = ?', [guestId, courseId]);
  if (!g) return false;
  const uid = -g.id;
  await run('DELETE FROM el_progress WHERE user_id = ?', [uid]);
  await run('DELETE FROM el_enrolments WHERE user_id = ?', [uid]);
  await require('./quiz.model').removeFor('user_id = ?', [uid]);
  await require('./assignments.model').removeFor('user_id = ?', [uid]);
  await run('DELETE FROM el_guests WHERE id = ?', [g.id]);
  return true;
};

/** Everything of the course's share and guests (the course is being deleted). */
exports.removeCourse = async function (courseId) {
  await schema();
  await run('DELETE FROM el_shares WHERE course_id = ?', [courseId]);
  await run('DELETE FROM el_guests WHERE course_id = ?', [courseId]);
};

exports.MIN_PASSWORD = MIN_PASSWORD;
exports.GUEST_DAYS = GUEST_DAYS;
exports.ALL = ALL;
