// No sign-in: the add-on's static files, and shared courses (E-Learning > Share Courses) at /learn/<token>.
// A shared course answers only while its share is on and not expired, and only after its password is entered
// on the browser (share.controller.js load / requireGuest). The share of every course opens the catalogue at
// /learn/<token> and each published course under /learn/<token>/courses/<id>.
const express = require('express');
const path = require('path');
const asyncHandler = require('../../app/core/http/async.handler');
const controller = require('./controllers/share.controller');

const BASE = '/learn/:token([A-Za-z0-9_-]{22,64})';
const LESSON = ':lessonId(\\d+)';
const load = asyncHandler(controller.load);
const guest = controller.requireGuest;
const course = controller.requireCourse;

const router = express.Router();

// Styles and scripts of every E-Learning page (nothing private: the shared pages need them too).
router.use('/e-learning/assets', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

router.get(BASE, load, asyncHandler(controller.page));
router.post(`${BASE}/unlock`, load, controller.unlock);
router.post(`${BASE}/leave`, load, controller.leave);
router.get(`${BASE}/courses/:courseId(\\d+)`, load, course, asyncHandler(controller.page));

// A course's own requests: at /learn/<token> (a shared course) or /learn/<token>/courses/<id> (all courses).
for (const at of [BASE, `${BASE}/courses/:courseId(\\d+)`]) {
  router.get(`${at}/thumb`, load, course, asyncHandler(controller.thumb));
  router.get(`${at}/lessons/${LESSON}`, load, course, guest, asyncHandler(controller.lesson));
  router.post(`${at}/lessons/${LESSON}/complete`, load, course, guest, controller.complete);
  router.post(`${at}/lessons/${LESSON}/quiz`, load, course, guest, controller.quizSubmit);
  router.get(`${at}/lessons/${LESSON}/quiz/attempts/:attemptId(\\d+)`, load, course, guest, controller.quizAttempt);
  router.post(`${at}/lessons/${LESSON}/submit`, express.text({ type: 'text/plain', limit: '40mb' }), load, course, guest, controller.assignmentSubmit);
  router.get(`${at}/media/${LESSON}`, load, course, guest, asyncHandler(controller.media));
  router.get(`${at}/submissions/:sid(\\d+)/file`, load, course, guest, asyncHandler(controller.submissionFile));
}

module.exports = router;
