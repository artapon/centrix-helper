const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const jasperViewerController = require('./controllers/jasperviewer.controller');

// Jasper Viewer: reports run on the JasperServers in Reports > Settings, with the login saved there.
router.get('/reports/viewer', asyncHandler(jasperViewerController.index));
router.get('/reports/viewer/servers/:sid/browse', jasperViewerController.browse);
router.get('/reports/viewer/servers/:sid/search', jasperViewerController.search);
router.get('/reports/viewer/servers/:sid/report', jasperViewerController.report);
router.get('/reports/viewer/resolve', jasperViewerController.resolve);
router.get('/reports/viewer/sample-params', jasperViewerController.sampleParams);
router.get('/reports/viewer/run', jasperViewerController.run);
// Basic Data popup (Query Studio)
router.get('/reports/viewer/basic-data.js', jasperViewerController.basicDataScript);
router.get('/reports/viewer/basic-data', jasperViewerController.basicData('basicData'));
router.get('/reports/viewer/basic-data/visit', jasperViewerController.basicData('basicVisit'));
router.get('/reports/viewer/basic-data/hn', jasperViewerController.basicData('basicHn'));

module.exports = router;
