// E-Learning > Share Courses: course managers share a course by link and password (signed in), and guests open it
// at /learn/<token> without an account (routes.open.js). A guest's pages are the course and lesson views of the app,
// in a page of their own (no sidebar, no menu), with links under /learn/<token>. The share of every course
// (share.ALL) opens the catalogue at /learn/<token> and each published course at /learn/<token>/courses/<id>.
const fs = require('fs');
const view = require('../../../app/core/view').addon('elearning');
const courses = require('../models/courses.model');
const share = require('../models/share.model');
const quiz = require('../models/quiz.model');
const assignments = require('../models/assignments.model');
const video = require('../models/video.service');
const { forLearner, relinkFiles } = require('./elearning.controller');

const COOKIE = 'el_guest';
const id = (v) => parseInt(v, 10);
const username = (req) => (req.user && req.user.username) || '';

function fail(res, err, what) {
  if (err && err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`E-Learning share: ${what}:`, err);
  return res.status(500).json({ error: `The ${what} failed. The details are in the server log.` });
}

// ---------------------------------------------------------------- Share Courses page (signed in)

exports.index = async function (req, res) {
  return res.renderPage(view('share'), { title: 'Share Courses', courses: await share.overview(), catalogue: await share.catalogue(), minPassword: share.MIN_PASSWORD, guestDays: share.GUEST_DAYS });
};

exports.save = async function (req, res) {
  try {
    const courseId = id(req.params.id);
    if (courseId !== share.ALL && !(await courses.status(courseId))) return res.status(404).json({ error: 'Course not found.' });
    res.json({ share: await share.save(courseId, req.body, username(req)) });
  } catch (err) { fail(res, err, 'saving of the share'); }
};

exports.regenerate = async function (req, res) {
  try {
    const s = await share.forCourse(id(req.params.id));
    if (!s) return res.status(404).json({ error: 'This course is not shared.' });
    res.json({ share: await share.regenerate(s.courseId, username(req)) });
  } catch (err) { fail(res, err, 'new link'); }
};

exports.remove = async function (req, res) {
  try {
    await share.remove(id(req.params.id));
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'stopping of the share'); }
};

exports.guests = async function (req, res) {
  try {
    res.json({ guests: await share.guests(id(req.params.id)) });
  } catch (err) { fail(res, err, 'reading of the guests'); }
};

exports.removeGuest = async function (req, res) {
  try {
    if (!(await share.removeGuest(id(req.params.id), id(req.params.gid)))) return res.status(404).json({ error: 'Guest not found.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'removal of the guest'); }
};

// ---------------------------------------------------------------- guests (no sign-in)

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const serialize = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const CACHE_VIEWS = process.env.NODE_ENV === 'production';
const viewCache = new Map();
function readView(file) {
  if (CACHE_VIEWS && viewCache.has(file)) return viewCache.get(file);
  const blocks = [];
  const template = fs.readFileSync(file, 'utf8').replace(BLOCK_RE, (b) => { blocks.push(b); return ''; });
  const v = { template, blocks };
  if (CACHE_VIEWS) viewCache.set(file, v);
  return v;
}

// A guest's page: the view as a Vue 2 page (as res.renderPage does), in a bar-only layout.
function renderGuest(req, res, name, locals, status = 200) {
  const v = readView(view(name));
  const g = req.guest;
  res.status(status);
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(locals.title)}</title>
<link href="/lib/bootstrap/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="/lib/@fortawesome/fontawesome-free/css/all.min.css" rel="stylesheet">
<link href="/css/app.css" rel="stylesheet">
</head>
<body class="el-public">
<header class="el-pubbar">
  <div class="el-pubbar-in">
    ${req.catalogue ? `<a class="el-pubbar-brand" href="${esc(req.home)}">` : '<span class="el-pubbar-brand">'}<i class="fas fa-graduation-cap" aria-hidden="true"></i> E-Learning${req.catalogue ? '</a>' : '</span>'}
    ${req.courseTitle ? `<a class="el-pubbar-title" href="${esc(req.base)}">${esc(req.courseTitle)}</a>` : '<span class="el-pubbar-title"></span>'}
    ${g ? `<span class="el-pubbar-user"><i class="far fa-user" aria-hidden="true"></i> ${esc(g.name)}</span>
    <form method="post" action="${esc(req.home)}/leave" class="el-pubbar-leave"><button type="submit" title="Lock ${req.catalogue ? 'the courses' : 'this course'} on this browser">Leave</button></form>` : ''}
  </div>
</header>
<main class="el-pubmain"><div id="page-app" class="row"></div></main>
<script type="text/x-template" id="page-template"><div class="row">${v.template}</div></script>
<script src="/lib/vue/dist/vue.min.js"></script>
<script src="/js/page.js"></script>
<script>Page.data = ${serialize(locals)};</script>
${v.blocks.join('\n')}
<script>Page.mount();</script>
</body>
</html>`);
}

function notAvailable(req, res) {
  return renderGuest(req, res, 'unavailable', { title: 'Course not available' }, 404);
}

function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  try { return m ? decodeURIComponent(m.slice(name.length + 1)) : null; } catch (e) { return null; }
}
const secure = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

/**
 * Loads the share of :token (404 when it is off, expired or unknown) and the guest of the cookie (or null).
 * req.home: the link's page (the course, or the catalogue); req.base: the course's links; req.courseId: the course,
 * or null on the catalogue's own page. Under /courses/:courseId only the catalogue's published courses open.
 */
exports.load = async function (req, res, next) {
  try {
    const s = await share.open(req.params.token);
    const isAll = !!s && s.course_id === share.ALL;
    const courseId = req.params.courseId !== undefined ? id(req.params.courseId) : isAll ? null : s && s.course_id;
    const course = s && courseId != null ? await courses.get(courseId) : null;
    const ok = s && (isAll ? courseId == null || (course && course.status === 'published') : course && req.params.courseId === undefined);
    if (!ok) {
      if (req.method === 'GET' && !/\/(media|thumb|submissions)\b/.test(req.path)) return notAvailable(req, res);
      return res.status(404).json({ error: 'This course link is not available.' });
    }
    req.share = s;
    req.catalogue = isAll;
    req.home = `/learn/${s.token}`;
    req.base = isAll && course ? `${req.home}/courses/${course.id}` : req.home;
    req.courseId = course ? course.id : null;
    req.courseTitle = course ? course.title : null;
    req.guest = await share.guest(s, readCookie(req, COOKIE));
    return next();
  } catch (err) { return next(err); }
};

/** Pages and requests of one course: not on the catalogue's own page. */
exports.requireCourse = function (req, res, next) {
  if (req.courseId != null) return next();
  if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html') return notAvailable(req, res);
  return res.status(404).json({ error: 'Course not found.' });
};

/** The rest needs the password entered: pages go to the unlock page, requests get 401. */
exports.requireGuest = function (req, res, next) {
  if (req.guest) return next();
  if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html') return res.redirect(req.home);
  return res.status(401).json({ error: 'Enter the course password again (reload the page).' });
};

const learner = (req) => -req.guest.id;
const thumb = (req, c) => (c.thumbUrl ? `${req.base}/thumb?v=${encodeURIComponent(c.updatedAt)}` : null);

// The course page (or the catalogue's), or the unlock page while the password has not been entered on this browser
// (the catalogue's courses are unlocked on the catalogue's page).
exports.page = async function (req, res) {
  if (req.catalogue && req.courseId == null) return catalogue(req, res);
  if (!req.guest) {
    if (req.catalogue) return res.redirect(req.home);
    const c = await courses.get(req.courseId);
    return renderGuest(req, res, 'unlock', {
      title: c.title,
      course: { title: c.title, summary: c.summary, instructor: c.instructor, category: c.category, level: c.level, lessons: c.lessons, minutes: c.minutes, thumbUrl: thumb(req, c), sections: c.sections },
      unlockUrl: `${req.base}/unlock`
    });
  }
  const course = await courses.get(req.courseId, { userId: learner(req) });
  course.thumbUrl = thumb(req, course);
  return renderGuest(req, res, 'course', { title: course.title, can: {}, course, base: req.base, home: req.catalogue ? req.home : null, guest: { name: req.guest.name } });
};

// The catalogue of every published course, with the guest's progress.
async function catalogue(req, res) {
  const list = (await courses.list(req.guest ? learner(req) : 0, false))
    .map((c) => Object.assign(c, { thumbUrl: c.thumbUrl ? `${req.home}/courses/${c.id}/thumb?v=${encodeURIComponent(c.updatedAt)}` : null }));
  if (!req.guest) {
    return renderGuest(req, res, 'unlock', {
      title: 'Courses', course: null, unlockUrl: `${req.home}/unlock`,
      catalogue: { courses: list.length, lessons: list.reduce((n, c) => n + c.lessons, 0), minutes: list.reduce((n, c) => n + c.minutes, 0), titles: list.slice(0, 8).map((c) => c.title) }
    });
  }
  return renderGuest(req, res, 'catalog', { title: 'Courses', can: {}, courses: list, levels: courses.LEVELS, base: req.home, guest: { name: req.guest.name } });
}

// Wrong passwords: at most UNLOCK_TRIES per address and link in UNLOCK_WINDOW_MS.
const UNLOCK_TRIES = 10;
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const tries = new Map();
setInterval(() => { const t = Date.now(); tries.forEach((v, k) => { if (v.until < t) tries.delete(k); }); }, 10 * 60 * 1000).unref();

exports.unlock = async function (req, res) {
  try {
    const key = `${req.ip}|${req.share.token}`;
    const t = tries.get(key);
    if (t && t.until > Date.now() && t.count >= UNLOCK_TRIES) {
      return res.status(429).json({ error: `Too many wrong passwords. Try again in ${Math.ceil((t.until - Date.now()) / 60000)} minutes.` });
    }
    const b = req.body || {};
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Enter your name.' });
    if (!(await share.checkPassword(req.share, b.password))) {
      const cur = t && t.until > Date.now() ? t : { count: 0, until: Date.now() + UNLOCK_WINDOW_MS };
      cur.count++;
      tries.set(key, cur);
      return res.status(403).json({ error: 'The password is not right.' });
    }
    tries.delete(key);
    const { cookieToken } = await share.unlock(req.share, readCookie(req, COOKIE), b.name);
    res.cookie(COOKIE, cookieToken, { httpOnly: true, sameSite: 'lax', secure: secure(req), path: req.home, maxAge: share.GUEST_DAYS * 86400000 });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'unlocking of the course'); }
};

// Locks the course on this browser again (the guest's progress stays, under the same name, if they come back on it).
exports.leave = function (req, res) {
  res.clearCookie(COOKIE, { path: req.home });
  res.redirect(303, req.home);
};

exports.lesson = async function (req, res) {
  const course = await courses.get(req.courseId, { userId: learner(req) });
  const lesson = await courses.lesson(req.courseId, id(req.params.lessonId));
  if (!lesson) return notAvailable(req, res);
  await courses.touch(learner(req), req.courseId, lesson.id);
  course.thumbUrl = thumb(req, course);
  const out = await forLearner(learner(req), lesson, req.base);
  if (out.assignment && !req.share.allow_assignments) out.assignment.guestBlocked = true;
  return renderGuest(req, res, 'lesson', { title: lesson.title, can: {}, course, lesson: out, base: req.base, guest: { name: req.guest.name } });
};

const lessonOf = (req) => courses.lesson(req.courseId, id(req.params.lessonId));

exports.complete = async function (req, res) {
  try {
    const lesson = await lessonOf(req);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
    if (lesson.type === 'quiz' || lesson.type === 'assignment') return res.status(409).json({ error: `A ${lesson.type} is completed by passing it.` });
    const done = !!(req.body && req.body.done);
    res.json({ done, progress: await courses.setDone(learner(req), req.courseId, lesson.id, done) });
  } catch (err) { fail(res, err, 'saving of your progress'); }
};

exports.quizSubmit = async function (req, res) {
  try {
    const lesson = await lessonOf(req);
    if (!lesson || lesson.type !== 'quiz') return res.status(404).json({ error: 'Quiz not found.' });
    const out = await quiz.submit(learner(req), req.courseId, lesson, req.body && req.body.answers);
    const progress = out.attempt.passed ? await courses.setDone(learner(req), req.courseId, lesson.id, true) : null;
    res.json(Object.assign(out, { mine: await quiz.mine(learner(req), lesson.id), progress }));
  } catch (err) { fail(res, err, 'grading of the quiz'); }
};

exports.quizAttempt = async function (req, res) {
  try {
    const lesson = await lessonOf(req);
    if (!lesson || lesson.type !== 'quiz') return res.status(404).json({ error: 'Quiz not found.' });
    const r = await quiz.attemptReview(learner(req), lesson, id(req.params.attemptId));
    if (!r) return res.status(404).json({ error: 'Attempt not found.' });
    res.json(r);
  } catch (err) { fail(res, err, 'reading of the attempt'); }
};

exports.assignmentSubmit = async function (req, res) {
  try {
    const lesson = await lessonOf(req);
    if (!lesson || lesson.type !== 'assignment') return res.status(404).json({ error: 'Assignment not found.' });
    if (!req.share.allow_assignments) return res.status(403).json({ error: 'Assignments of this shared course can be handed in only by signed-in users.' });
    let body;
    try { body = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch (e) { return res.status(400).json({ error: 'The submission could not be read.' }); }
    res.json({ mine: relinkFiles(await assignments.submit(learner(req), req.courseId, lesson, body), req.base) });
  } catch (err) { fail(res, err, 'submission'); }
};

exports.submissionFile = async function (req, res) {
  const sub = await assignments.get(id(req.params.sid));
  const full = sub && sub.file && sub.userId === learner(req) ? assignments.filePath(sub.filePath) : null;
  if (!full) return res.status(404).type('text').send('File not found.');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.download(full, sub.file.name, { headers: { 'Content-Type': 'application/octet-stream' } }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text').send('The file is no longer on the server.');
  });
};

exports.media = async function (req, res) {
  const l = await courses.lessonVideo(id(req.params.lessonId));
  if (!l || l.course_id !== req.courseId || l.video_source !== 'share') return res.status(404).type('text').send('Video not found.');
  return video.stream(req, res, l.video_ref);
};

exports.thumb = async function (req, res) {
  const t = await courses.thumb(req.courseId);
  if (!t) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=604800').type(t.type).send(t.data);
};
