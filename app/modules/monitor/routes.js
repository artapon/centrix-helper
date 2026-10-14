const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const monitorController = require('./controllers/monitor.controller');
const monitorApiController = require('./controllers/api.controller');

router.get('/database/monitor', asyncHandler(monitorController.index));
router.get('/api/database/monitor', asyncHandler(monitorApiController.index));

module.exports = router;
