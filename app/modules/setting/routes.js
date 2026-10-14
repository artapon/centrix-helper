const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const settingController = require('./controllers/setting.controller');
const settingApiController = require('./controllers/api.controller');

router.get('/database/info/sessions-export', asyncHandler(settingController.exportAllActiveSessions));
router.get('/api/database/stats', asyncHandler(settingApiController.getStats));

module.exports = router;
