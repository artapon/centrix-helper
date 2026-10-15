// E-Learning > Courses: the catalogue, a course's page, the lesson player and the course editor;
// E-Learning > Settings: the shared folders videos may play from. Everything is in SQLite (no Mongo connection).
const view = require('../../../app/core/view').addon('elearning');
const { actionsFor, canDo, canAccessPath } = require('../../../app/core/permissions');
const courses = require('../models/courses.model');
const settings = require('../models/settings.model');
const categories = require('../models/categories.model');
const video = require('../models/video.service');
const quiz = require('../models/quiz.model');
const assignments = require('../models/assignments.model');

const LINK = '/e-learning';

const username = (req) => (req.user && req.user.username) || '';
const canManage = (req) => canDo(req.user, LINK, 'manage');
const id = (v) => parseInt(v, 10);

function fail(res, err, what) {
  if (err && err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`E-Learning: ${what}:`, err);
  return res.status(500).json({ error: `The ${what} failed. The details are in the server log.` });
}

function notFound(req, res) {
  return res.status(404).renderPage(view.shared('error'), { title: 'Course not found', heading: 'Course not found', showConnections: false, message: 'This course does not exist, or it is not published yet.' });
}

// A course the user may see: published, or any course for those who manage courses.
async function visible(req, courseId) {
  const status = await courses.status(courseId);
  return !!status && (status === 'published' || canManage(req));
}

exports.index = async function (req, res) {
  const manage = canManage(req);
  return res.renderPage(view('catalog'), {
    title: 'Courses',
    can: actionsFor(req.user, LINK),
    courses: await courses.list(req.user.id, manage),
    levels: courses.LEVELS,
    base: LINK
  });
};

exports.course = async function (req, res) {
  const course = await courses.get(id(req.params.id), { userId: req.user.id });
  if (!course || (course.status !== 'published' && !canManage(req))) return notFound(req, res);
  if (canManage(req) && course.assignments) course.pending = await assignments.pending(course.id);
  return res.renderPage(view('course'), { title: course.title, can: actionsFor(req.user, LINK), course, base: `${LINK}/courses/${course.id}`, home: LINK, guest: null, canShare: canAccessPath(req.user, `${LINK}/share`) });
};

exports.lesson = async function (req, res) {
  const courseId = id(req.params.id);
  const course = await courses.get(courseId, { userId: req.user.id });
  if (!course || (course.status !== 'published' && !canManage(req))) return notFound(req, res);
  const lesson = await courses.lesson(courseId, id(req.params.lessonId));
  if (!lesson) return notFound(req, res);
  await courses.touch(req.user.id, courseId, lesson.id);
  return res.renderPage(view('lesson'), {
    title: lesson.title, can: actionsFor(req.user, LINK), course, lesson: await forLearner(req.user.id, lesson), base: `${LINK}/courses/${courseId}`, guest: null
  });
};

// A lesson as the learner's page gets it: a quiz without its answers, with the learner's attempts;
// an assignment with the learner's submission. base: links of a shared course (/learn/<token>) instead of /e-learning.
async function forLearner(userId, lesson, base) {
  const out = Object.assign({}, lesson);
  delete out.settings;
  if (lesson.type === 'quiz') {
    out.quiz = quiz.forLearner(lesson.settings);
    out.mine = await quiz.mine(userId, lesson.id);
  } else if (lesson.type === 'assignment') {
    out.assignment = Object.assign({}, lesson.settings, { fileTypes: assignments.FILE_TYPES });
    out.mine = relinkFiles(await assignments.mine(userId, lesson), base);
  }
  if (base && out.player && out.player.kind === 'file') out.player = Object.assign({}, out.player, { src: `${base}/media/${lesson.id}` });
  return out;
}
exports.forLearner = forLearner;

// Links to handed-in files under a shared course's link.
function relinkFiles(mine, base) {
  if (!base || !mine) return mine;
  const fix = (s) => (s && s.file ? Object.assign({}, s, { file: Object.assign({}, s.file, { url: `${base}/submissions/${s.id}/file` }) }) : s);
  return Object.assign({}, mine, { latest: fix(mine.latest), history: (mine.history || []).map(fix) });
}
exports.relinkFiles = relinkFiles;

// The lesson of a course the user may see, or null.
async function lessonFor(req) {
  const courseId = id(req.params.id);
  if (!(await visible(req, courseId))) return null;
  return courses.lesson(courseId, id(req.params.lessonId));
}

// The editor: a new course (no :id) or an existing one with every lesson's text and link.
exports.editor = async function (req, res) {
  let course = null;
  if (req.params.id) {
    course = await courses.get(id(req.params.id), { withContent: true });
    if (!course) return notFound(req, res);
  }
  const { folders } = await settings.get();
  return res.renderPage(view('editor'), {
    title: course ? `Edit: ${course.title}` : 'New course',
    course,
    categories: await categories.names(),
    canCategories: canAccessPath(req.user, `${LINK}/categories`),
    levels: courses.LEVELS,
    folders: folders.map((f) => ({ key: f.key, name: f.name })),
    me: (req.user && (req.user.name || req.user.username)) || '',
    isAdmin: req.user.role === require('../../../app/core/permissions').ADMIN_ROLE
  });
};

exports.save = async function (req, res) {
  try {
    const courseId = req.params.id ? id(req.params.id) : null;
    let body;
    try { body = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch (e) { return res.status(400).json({ error: 'The course could not be read.' }); }
    const saved = await courses.save(courseId, await courses.normalize(body), username(req));
    if (!saved) return res.status(404).json({ error: 'Course not found.' });
    res.json({ course: await courses.get(saved, { withContent: true }) });
  } catch (err) { fail(res, err, 'saving of the course'); }
};

exports.remove = async function (req, res) {
  try {
    if (!(await courses.remove(id(req.params.id)))) return res.status(404).json({ error: 'Course not found.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'deletion of the course'); }
};

exports.thumb = async function (req, res) {
  if (!(await visible(req, id(req.params.id)))) return res.status(404).end();
  const t = await courses.thumb(id(req.params.id));
  if (!t) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=604800').type(t.type).send(t.data);
};

exports.complete = async function (req, res) {
  try {
    const lesson = await lessonFor(req);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
    if (lesson.type === 'quiz' || lesson.type === 'assignment') return res.status(409).json({ error: `A ${lesson.type} is completed by passing it.` });
    res.json({ done: !!(req.body && req.body.done), progress: await courses.setDone(req.user.id, id(req.params.id), lesson.id, !!(req.body && req.body.done)) });
  } catch (err) { fail(res, err, 'saving of your progress'); }
};

// ---- quizzes ----

// Submit answers: graded here; a pass completes the lesson.
exports.quizSubmit = async function (req, res) {
  try {
    const lesson = await lessonFor(req);
    if (!lesson || lesson.type !== 'quiz') return res.status(404).json({ error: 'Quiz not found.' });
    const courseId = id(req.params.id);
    const out = await quiz.submit(req.user.id, courseId, lesson, req.body && req.body.answers);
    const progress = out.attempt.passed ? await courses.setDone(req.user.id, courseId, lesson.id, true) : null;
    res.json(Object.assign(out, { mine: await quiz.mine(req.user.id, lesson.id), progress }));
  } catch (err) { fail(res, err, 'grading of the quiz'); }
};

exports.quizAttempt = async function (req, res) {
  try {
    const lesson = await lessonFor(req);
    if (!lesson || lesson.type !== 'quiz') return res.status(404).json({ error: 'Quiz not found.' });
    const r = await quiz.attemptReview(req.user.id, lesson, id(req.params.attemptId));
    if (!r) return res.status(404).json({ error: 'Attempt not found.' });
    res.json(r);
  } catch (err) { fail(res, err, 'reading of the attempt'); }
};

// ---- assignments ----

// Hand in (JSON in a text/plain body: a file is sent as base64).
exports.assignmentSubmit = async function (req, res) {
  try {
    const lesson = await lessonFor(req);
    if (!lesson || lesson.type !== 'assignment') return res.status(404).json({ error: 'Assignment not found.' });
    let body;
    try { body = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch (e) { return res.status(400).json({ error: 'The submission could not be read.' }); }
    res.json({ mine: await assignments.submit(req.user.id, id(req.params.id), lesson, body) });
  } catch (err) { fail(res, err, 'submission'); }
};

// A handed-in file: for the learner who handed it in and for course managers; always a download.
exports.submissionFile = async function (req, res) {
  const sub = await assignments.get(id(req.params.sid));
  if (!sub || !sub.file || (sub.userId !== req.user.id && !canManage(req))) return res.status(404).type('text').send('File not found.');
  const full = assignments.filePath(sub.filePath);
  if (!full) return res.status(404).type('text').send('File not found.');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.download(full, sub.file.name, { headers: { 'Content-Type': 'application/octet-stream' } }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text').send('The file is no longer on the server.');
  });
};

// ---- grading (Manage courses) ----

exports.grading = async function (req, res) {
  const course = await courses.get(id(req.params.id));
  if (!course) return notFound(req, res);
  const [submissions, results] = await Promise.all([assignments.list(course.id), quiz.results(course.id)]);
  const items = [];
  for (const s of course.curriculum) {
    for (const l of s.lessons) {
      if (l.type !== 'quiz' && l.type !== 'assignment') continue;
      const full = await courses.lesson(course.id, l.id);
      const st = full.settings || {};
      items.push({
        id: l.id, title: l.title, type: l.type, section: s.title,
        settings: l.type === 'assignment' ? st : { passPct: st.passPct, maxAttempts: st.maxAttempts, questions: (st.questions || []).length }
      });
    }
  }
  return res.renderPage(view('grading'), {
    title: `Grading: ${course.title}`,
    course: { id: course.id, title: course.title, learners: course.learners },
    items,
    submissions,
    results: results.map((r) => ({ lessonId: r.lesson_id, userId: r.user_id, learner: r.learner, username: r.username, attempts: r.attempts, best: r.best, lastPct: r.last_pct, passed: !!r.passed, lastAt: r.last_at, guest: !!r.guest }))
  });
};

exports.submission = async function (req, res) {
  try {
    const sub = await assignments.get(id(req.params.sid));
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });
    delete sub.filePath;
    res.json({ submission: sub });
  } catch (err) { fail(res, err, 'reading of the submission'); }
};

// A grade: passing completes the assignment for the learner, failing re-opens it.
exports.grade = async function (req, res) {
  try {
    const sub = await assignments.get(id(req.params.sid));
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });
    const lesson = await courses.lesson(sub.courseId, sub.lessonId);
    if (!lesson) return res.status(404).json({ error: 'The assignment no longer exists.' });
    const graded = await assignments.grade(sub.id, lesson, req.body, username(req));
    await courses.setDone(sub.userId, sub.courseId, sub.lessonId, graded.passed);
    delete graded.filePath;
    res.json({ submission: graded });
  } catch (err) { fail(res, err, 'saving of the grade'); }
};

// A shared folder video of a lesson, for learners (only the lesson's own file can be played).
exports.media = async function (req, res) {
  const l = await courses.lessonVideo(id(req.params.lessonId));
  if (!l || l.video_source !== 'share' || !(await visible(req, l.course_id))) return res.status(404).type('text').send('Video not found.');
  return video.stream(req, res, l.video_ref);
};

// ---- the editor's helpers (Manage courses) ----

// Check a video link and say what will play: { ref, player }.
exports.checkVideo = async function (req, res) {
  try {
    const b = req.body || {};
    const ref = await video.normalize(String(b.source || ''), b.url);
    res.json({ ref, player: video.player(b.source, ref, `${LINK}/media-preview?ref=${encodeURIComponent(ref)}`) });
  } catch (err) { fail(res, err, 'check of the video'); }
};

// Any video of a shared folder, for the editor's preview before the lesson is saved.
exports.mediaPreview = async function (req, res) {
  return video.stream(req, res, String(req.query.ref || ''));
};

exports.browse = async function (req, res) {
  try {
    res.json(await video.browse(String(req.query.folder || ''), req.query.dir));
  } catch (err) { fail(res, err, 'reading of the folder'); }
};

// ---- Settings (administrators) ----

exports.settingsIndex = async function (req, res) {
  return res.renderPage(view('settings'), { title: 'E-Learning Settings', saved: await settings.get() });
};

exports.settingsSave = async function (req, res) {
  try {
    res.json({ saved: await settings.save(req.body) });
  } catch (err) { fail(res, err, 'saving of the settings'); }
};

exports.settingsTest = async function (req, res) {
  try {
    res.json(await settings.test(req.body && req.body.path));
  } catch (err) { fail(res, err, 'test of the folder'); }
};
