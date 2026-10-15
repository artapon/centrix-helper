// E-Learning quizzes: a quiz lesson's questions (el_lessons.settings) and each learner's attempts.
//   settings  { passPct, maxAttempts (0 = unlimited), showAnswers, shuffle, questions: [question] }
//   question  { id, type: single | multiple | truefalse | short, text (Markdown), points, explain,
//               options: [{ id, text, correct }] (single / multiple / truefalse), answers: [accepted text] (short) }
//   el_quiz_attempts  one row per submitted attempt, graded on the server
// Learners never get the correct answers before they submit (forLearner()); after, only when showAnswers is on.
const crypto = require('crypto');
const { run, get, all } = require('../../../app/core/config/sqlite');

const QTYPES = ['single', 'multiple', 'truefalse', 'short'];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_QUESTIONS = 200;
const MAX_OPTIONS = 12;

const invalid = (message) => Object.assign(new Error(message), { status: 400, expose: true });
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const newId = () => crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').slice(0, 8);
const fold = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } };

let ready = null;
function schema() {
  if (!ready) ready = create().catch((err) => { ready = null; throw err; });
  return ready;
}
async function create() {
  await require('./share.model').schema();      // guests' names (el_guests) in the results
  await run(`
    CREATE TABLE IF NOT EXISTS el_quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      answers TEXT NOT NULL DEFAULT '{}',
      score REAL NOT NULL DEFAULT 0,
      max REAL NOT NULL DEFAULT 0,
      pct INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL
    )`);
  await run('CREATE INDEX IF NOT EXISTS idx_el_quiz_attempts_lesson ON el_quiz_attempts (lesson_id, user_id)');
}
exports.schema = schema;

/** The editor's quiz settings -> stored settings; throws a 400 naming the question. */
exports.normalize = function (s, where) {
  s = s || {};
  const list = Array.isArray(s.questions) ? s.questions : [];
  if (!list.length) throw invalid(`${where}: add at least one question.`);
  if (list.length > MAX_QUESTIONS) throw invalid(`${where}: at most ${MAX_QUESTIONS} questions.`);
  const ids = new Set();
  const uniq = (id) => {
    let v = ID_RE.test(String(id || '')) ? String(id) : newId();
    while (ids.has(v)) v = newId();
    ids.add(v);
    return v;
  };
  const questions = list.map((q, i) => {
    const at = `${where}, question ${i + 1}`;
    const type = QTYPES.includes(q && q.type) ? q.type : 'single';
    const out = { id: uniq(q.id), type, text: text(q.text, 5000), points: int(q.points, 1, 1, 100), explain: text(q.explain, 5000) };
    if (!out.text) throw invalid(`${at} has no question text.`);
    if (type === 'short') {
      out.answers = [...new Set((Array.isArray(q.answers) ? q.answers : String(q.answers || '').split('\n')).map((a) => text(a, 200)).filter(Boolean))].slice(0, 20);
      if (!out.answers.length) throw invalid(`${at}: add at least one accepted answer.`);
      return out;
    }
    if (type === 'truefalse') {
      const isTrue = q.answer === true || q.answer === 'true' || (Array.isArray(q.options) && q.options.some((o) => o && o.id === 'true' && o.correct));
      out.options = [{ id: 'true', text: 'True', correct: isTrue }, { id: 'false', text: 'False', correct: !isTrue }];
      return out;
    }
    const optIds = new Set();
    out.options = (Array.isArray(q.options) ? q.options : []).map((o) => ({ id: o && o.id, text: text(o && o.text, 1000), correct: !!(o && o.correct) }))
      .filter((o) => o.text)
      .slice(0, MAX_OPTIONS)
      .map((o) => {
        let id = ID_RE.test(String(o.id || '')) && !optIds.has(o.id) ? String(o.id) : newId();
        while (optIds.has(id)) id = newId();
        optIds.add(id);
        return Object.assign(o, { id });
      });
    if (out.options.length < 2) throw invalid(`${at} needs at least two answer choices.`);
    const right = out.options.filter((o) => o.correct).length;
    if (!right) throw invalid(`${at}: mark the correct answer.`);
    if (type === 'single' && right > 1) throw invalid(`${at} is single choice but has ${right} correct answers; make it multiple choice or mark one.`);
    return out;
  });
  return {
    passPct: int(s.passPct, 70, 0, 100),
    maxAttempts: int(s.maxAttempts, 0, 0, 100),
    showAnswers: s.showAnswers !== false,
    shuffle: !!s.shuffle,
    questions
  };
};

/** The quiz as a learner sees it before answering: no correct flags, accepted answers or explanations. */
exports.forLearner = function (s) {
  s = s || {};
  return {
    passPct: s.passPct, maxAttempts: s.maxAttempts, showAnswers: !!s.showAnswers, shuffle: !!s.shuffle,
    points: (s.questions || []).reduce((n, q) => n + (q.points || 1), 0),
    questions: (s.questions || []).map((q) => ({
      id: q.id, type: q.type, text: q.text, points: q.points,
      options: q.type === 'short' ? undefined : (q.options || []).map((o) => ({ id: o.id, text: o.text }))
    }))
  };
};

// answers: { questionId: optionId | [optionId] | text }
function grade(s, answers) {
  let score = 0, max = 0;
  const results = (s.questions || []).map((q) => {
    const a = answers ? answers[q.id] : undefined;
    let ok = false;
    if (q.type === 'short') ok = q.answers.some((x) => fold(x) === fold(a)) && fold(a) !== '';
    else if (q.type === 'multiple') {
      const want = q.options.filter((o) => o.correct).map((o) => o.id).sort();
      const got = [...new Set(Array.isArray(a) ? a.map(String) : [])].sort();
      ok = want.length === got.length && want.every((v, i) => v === got[i]);
    } else ok = q.options.some((o) => o.correct && o.id === String(a));
    max += q.points || 1;
    if (ok) score += q.points || 1;
    return { id: q.id, ok };
  });
  const pct = max ? Math.round(score * 100 / max) : 0;
  return { score, max, pct, passed: pct >= (s.passPct || 0), results };
}

// What the learner gets back about each question: right or wrong; with showAnswers also the right answer and why.
function review(s, results, answers) {
  const byId = new Map(results.map((r) => [r.id, r]));
  return (s.questions || []).map((q) => {
    const r = byId.get(q.id) || { ok: false };
    const out = { id: q.id, ok: r.ok, answer: answers ? answers[q.id] : undefined };
    if (s.showAnswers) {
      out.explain = q.explain;
      if (q.type === 'short') out.accepted = q.answers;
      else out.correct = q.options.filter((o) => o.correct).map((o) => o.id);
    }
    return out;
  });
}

const attemptView = (a) => ({ id: a.id, score: a.score, max: a.max, pct: a.pct, passed: !!a.passed, at: a.submitted_at });

/** The learner's attempts at a quiz: { count, best, passed, last, attempts: [...] } */
exports.mine = async function (userId, lessonId) {
  await schema();
  const rows = await all('SELECT * FROM el_quiz_attempts WHERE user_id = ? AND lesson_id = ? ORDER BY id DESC', [userId, lessonId]);
  const best = rows.reduce((b, r) => (!b || r.pct > b.pct ? r : b), null);
  return { count: rows.length, best: best ? best.pct : null, passed: rows.some((r) => r.passed), last: rows[0] ? attemptView(rows[0]) : null, attempts: rows.slice(0, 20).map(attemptView) };
};

/** Grades and keeps an attempt; refuses one past maxAttempts. Returns { attempt, review, mine }. */
exports.submit = async function (userId, courseId, lesson, answers) {
  await schema();
  const s = lesson.settings || {};
  const done = (await get('SELECT COUNT(*) AS n FROM el_quiz_attempts WHERE user_id = ? AND lesson_id = ?', [userId, lesson.id])).n;
  if (s.maxAttempts && done >= s.maxAttempts) throw Object.assign(new Error(`You have used all ${s.maxAttempts} attempts at this quiz.`), { status: 409, expose: true });
  const clean = {};
  (s.questions || []).forEach((q) => {
    const a = answers && answers[q.id];
    if (a == null) return;
    clean[q.id] = q.type === 'multiple' ? (Array.isArray(a) ? a.map((x) => String(x).slice(0, 40)).slice(0, MAX_OPTIONS) : []) : String(a).slice(0, 500);
  });
  const g = grade(s, clean);
  const at = new Date().toISOString();
  const r = await run(`INSERT INTO el_quiz_attempts (user_id, lesson_id, course_id, answers, score, max, pct, passed, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, lesson.id, courseId, JSON.stringify(clean), g.score, g.max, g.pct, g.passed ? 1 : 0, at]);
  return { attempt: { id: r.lastID, score: g.score, max: g.max, pct: g.pct, passed: g.passed, at }, review: review(s, g.results, clean) };
};

/** One of the learner's own attempts again (its answers and, with showAnswers, the right ones). */
exports.attemptReview = async function (userId, lesson, attemptId) {
  await schema();
  const a = await get('SELECT * FROM el_quiz_attempts WHERE id = ? AND user_id = ? AND lesson_id = ?', [attemptId, userId, lesson.id]);
  if (!a) return null;
  const answers = parse(a.answers, {});
  return { attempt: attemptView(a), review: review(lesson.settings || {}, grade(lesson.settings || {}, answers).results, answers) };
};

/** Gradebook: each learner's attempts per quiz of a course. */
exports.results = async function (courseId) {
  await schema();
  return all(`SELECT a.lesson_id, a.user_id, COALESCE(NULLIF(u.name, ''), u.username, g.name || ' (guest)', 'User ' || a.user_id) AS learner, u.username, g.id IS NOT NULL AS guest,
                     COUNT(*) AS attempts, MAX(a.pct) AS best, MAX(a.passed) AS passed, MAX(a.submitted_at) AS last_at,
                     (SELECT pct FROM el_quiz_attempts x WHERE x.user_id = a.user_id AND x.lesson_id = a.lesson_id ORDER BY x.id DESC LIMIT 1) AS last_pct
              FROM el_quiz_attempts a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN el_guests g ON g.id = -a.user_id
              WHERE a.course_id = ? GROUP BY a.lesson_id, a.user_id ORDER BY last_at DESC`, [courseId]);
};

exports.removeFor = async function (where, params) {
  await schema();
  await run(`DELETE FROM el_quiz_attempts WHERE ${where}`, params);
};

exports.parse = parse;
