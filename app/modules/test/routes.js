const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const testController = require('./controllers/test.controller');

router.get('/test', asyncHandler(testController.index));
router.get('/api/test', testController.index);

module.exports = router;
