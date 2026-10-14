const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const jasperViewerController = require('./controllers/jasperviewer.controller');

router.get('/reports/viewer', asyncHandler(jasperViewerController.index));
router.get('/reports/viewer/proxy', asyncHandler(jasperViewerController.proxy));

module.exports = router;
