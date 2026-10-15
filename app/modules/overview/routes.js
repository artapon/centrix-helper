const router = require('express').Router();
const asyncHandler = require('../../core/http/async.handler');
const overviewController = require('./controllers/overview.controller');

router.get('/', asyncHandler(overviewController.index));
router.get('/overview', asyncHandler(overviewController.index));
router.get('/overview/live', asyncHandler(overviewController.live));
router.get('/overview/details', asyncHandler(overviewController.details));

module.exports = router;
