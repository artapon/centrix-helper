// Mounted before the DB-connection guard: the courses and progress live in SQLite.
// Access follows the "Courses" menu item (/e-learning and everything under it); Settings is for administrators.
const express = require('express');
const asyncHandler = require('../../app/core/http/async.handler');
const { requireAction, requireAdmin } = require('../../app/core/middleware/requireauth.middleware');
const controller = require('./controllers/elearning.controller');
const share = require('./controllers/share.controller');
const categories = require('./controllers/categories.controller');

const LINK = '/e-learning';
const manage = requireAction(LINK, 'manage');
const ID = ':id(\\d+)';
const LESSON = ':lessonId(\\d+)';
// A course is sent as JSON in a text/plain body: with its thumbnail (a data: URL) and lesson texts it is larger
// than the app's JSON body limit.
const big = express.text({ type: 'text/plain', limit: '25mb' });

const router = express.Router();

router.get(`${LINK}/settings`, requireAdmin, asyncHandler(controller.settingsIndex));
router.post(`${LINK}/settings`, requireAdmin, controller.settingsSave);
router.post(`${LINK}/settings/test`, requireAdmin, controller.settingsTest);

// "Share Courses": its own menu item (/e-learning/share and everything under it).
router.get(`${LINK}/share`, asyncHandler(share.index));
router.post(`${LINK}/share/${ID}`, share.save);
router.post(`${LINK}/share/${ID}/regenerate`, share.regenerate);
router.post(`${LINK}/share/${ID}/delete`, share.remove);
router.get(`${LINK}/share/${ID}/guests`, share.guests);
router.post(`${LINK}/share/${ID}/guests/:gid(\\d+)/delete`, share.removeGuest);

// "Categories": its own menu item (/e-learning/categories and everything under it).
router.get(`${LINK}/categories`, asyncHandler(categories.index));
router.post(`${LINK}/categories`, categories.create);
router.post(`${LINK}/categories/order`, categories.reorder);
router.post(`${LINK}/categories/${ID}`, categories.update);
router.post(`${LINK}/categories/${ID}/delete`, categories.remove);

router.get(LINK, asyncHandler(controller.index));
router.get(`${LINK}/courses/new`, manage, asyncHandler(controller.editor));
router.get(`${LINK}/courses/${ID}`, asyncHandler(controller.course));
router.get(`${LINK}/courses/${ID}/edit`, manage, asyncHandler(controller.editor));
router.get(`${LINK}/courses/${ID}/thumb`, asyncHandler(controller.thumb));
router.get(`${LINK}/courses/${ID}/lessons/${LESSON}`, asyncHandler(controller.lesson));
router.post(`${LINK}/courses/${ID}/lessons/${LESSON}/complete`, controller.complete);
router.get(`${LINK}/media/${LESSON}`, asyncHandler(controller.media));
router.post(`${LINK}/courses/${ID}/lessons/${LESSON}/quiz`, controller.quizSubmit);
router.get(`${LINK}/courses/${ID}/lessons/${LESSON}/quiz/attempts/:attemptId(\\d+)`, controller.quizAttempt);
// A hand-in's file comes as base64 in the body (up to 25 MB of file).
router.post(`${LINK}/courses/${ID}/lessons/${LESSON}/submit`, express.text({ type: 'text/plain', limit: '40mb' }), controller.assignmentSubmit);
router.get(`${LINK}/submissions/:sid(\\d+)/file`, asyncHandler(controller.submissionFile));

router.post(`${LINK}/courses`, manage, big, controller.save);
router.post(`${LINK}/courses/${ID}`, manage, big, controller.save);
router.post(`${LINK}/courses/${ID}/delete`, manage, controller.remove);
router.post(`${LINK}/video/check`, manage, controller.checkVideo);
router.get(`${LINK}/courses/${ID}/grading`, manage, asyncHandler(controller.grading));
router.get(`${LINK}/submissions/:sid(\\d+)`, manage, controller.submission);
router.post(`${LINK}/submissions/:sid(\\d+)/grade`, manage, controller.grade);
router.get(`${LINK}/media-preview`, manage, asyncHandler(controller.mediaPreview));
router.get(`${LINK}/browse`, manage, controller.browse);

module.exports = router;
