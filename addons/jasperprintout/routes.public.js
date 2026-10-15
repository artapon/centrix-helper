// Mounted before the DB-connection guard: building and publishing to JasperServer works without
// a Mongo connection; only "register in HIS" needs one (checked per request).
const path = require('path');
const express = require('express');
const multer = require('multer');
const asyncHandler = require('../../app/core/http/async.handler');
const { requireAdmin, requireAction } = require('../../app/core/middleware/requireauth.middleware');

// Actions inside the pages, granted per role (addon.json "actions", Administration > Roles).
const BUILDER = '/reports/print-out-builder', DESIGNER = '/reports/jasper-designer', PUBLISH = '/reports/publish';
const controller = require('./controllers/printout.controller');
const designer = require('./controllers/designer.controller');
const publish = require('./controllers/publish.controller');
const deploy = require('./controllers/deploy.controller');
const settings = require('./controllers/settings.controller');
const overview = require('./controllers/overview.controller');

const router = express.Router();

// Pages arrive in memory (at most 20 images of 25 MB) and are converted by sharp; nothing is
// written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 25 * 1024 * 1024, fields: 30 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});
const pages = (req, res, next) => upload.array('images', 20)(req, res, (err) => {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each page image must be 25 MB or smaller.'
    : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'A report can have at most 20 pages.'
      : err.message;
  return res.status(400).json({ error: message });
});

// Access follows the "Print-Out Builder" menu item (/reports/print-out-builder and everything under it).
router.use('/reports/print-out-builder/assets', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
router.get('/reports/print-out-builder', asyncHandler(controller.index));
router.get('/reports/print-out-builder/check-code', controller.checkCode);
router.post('/reports/print-out-builder/publish', requireAction(BUILDER, 'publish'), pages, controller.publish);
// Save to / open from the Jasper Designer library: the same file manager (folders, replace, delete) under this page's permission.
const folderForm = multer({ limits: { fieldSize: 64 * 1024, fields: 5, files: 0 } }).none();
router.get('/reports/print-out-builder/designs', designer.list);
router.get('/reports/print-out-builder/designs/:id', designer.get);
router.post('/reports/print-out-builder/designs', requireAction(BUILDER, 'save'), pages, controller.save);
router.post('/reports/print-out-builder/designs/folders', requireAction(BUILDER, 'save'), folderForm, designer.createFolder);
router.post('/reports/print-out-builder/designs/folders/delete', requireAction(BUILDER, 'delete'), folderForm, designer.removeFolder);
router.post('/reports/print-out-builder/designs/:id/delete', requireAction(BUILDER, 'delete'), designer.remove);

// "Jasper Designer": designs arrive as one multipart field (payload), up to 30 MB with images.
const designForm = (req, res, next) => multer({ limits: { fieldSize: 30 * 1024 * 1024, fields: 5, files: 0 } }).none()(req, res, (err) => {
  if (!err) return next();
  return res.status(400).json({ error: err.code === 'LIMIT_FIELD_VALUE' ? 'The design with its images is larger than 30 MB.' : err.message });
});
router.use('/reports/jasper-designer/assets', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
router.get('/reports/jasper-designer', asyncHandler(designer.index));
router.get('/reports/jasper-designer/designs', designer.list);
router.post('/reports/jasper-designer/designs/folders', designForm, designer.createFolder);
router.post('/reports/jasper-designer/designs/folders/delete', requireAction(DESIGNER, 'delete'), designForm, designer.removeFolder);
router.get('/reports/jasper-designer/designs/:id', designer.get);
router.get('/reports/jasper-designer/designs/:id/versions', designer.versions);
router.get('/reports/jasper-designer/designs/:id/publishes', designer.publishes);
router.get('/reports/jasper-designer/check-code', designer.checkCode);
router.get('/reports/jasper-designer/designs/:id/versions/:vid', designer.version);
router.post('/reports/jasper-designer/designs', designForm, designer.save);
router.post('/reports/jasper-designer/designs/:id/delete', requireAction(DESIGNER, 'delete'), designer.remove);
router.post('/reports/jasper-designer/jrxml', designForm, designer.jrxml);
router.post('/reports/jasper-designer/publish', requireAction(DESIGNER, 'publish'), designForm, designer.publish);
router.post('/reports/jasper-designer/preview', designForm, designer.preview);
router.post('/reports/jasper-designer/query', designForm, designer.query);
router.get('/reports/jasper-designer/sample-params', designer.sampleParams);
// Open a design > a JasperServer tab (servers from Reports > Settings).
router.get('/reports/jasper-designer/servers/:sid/browse', designer.remoteBrowse);
router.get('/reports/jasper-designer/servers/:sid/search', designer.remoteSearch);
router.get('/reports/jasper-designer/servers/:sid/unit', designer.remoteUnit);

// "Publish": publish a saved design to JasperServer and optionally save it to Centrix HIS.
router.use('/reports/publish/assets', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
// Reports > Overview (its own menu item): the reports work as charts.
router.get('/reports/overview', asyncHandler(overview.index));
router.get('/reports/overview/data', overview.data);
router.get('/reports/publish', asyncHandler(publish.index));
router.get('/reports/publish/designs', publish.list);
router.get('/reports/publish/designs/:id', publish.get);
router.get('/reports/publish/designs/:id/history', publish.history);
router.get('/reports/publish/check-code', publish.checkCode);
router.post('/reports/publish', requireAction(PUBLISH, 'direct-publish'), publish.publish);
router.post('/reports/publish/existing', publish.existing);
// Deploy workflow on the same page: UAT first, check the report there, then Production.
router.get('/reports/publish/designs/:id/deploy', deploy.status);
router.get('/reports/publish/sample-params', deploy.sampleParams);
router.post('/reports/publish/deploys/uat', requireAction(PUBLISH, 'deploy-uat'), deploy.uat);
router.get('/reports/publish/deploys/:id/run', deploy.run);
router.post('/reports/publish/deploys/:id/review', requireAction(PUBLISH, 'review'), deploy.review);
router.post('/reports/publish/deploys/:id/production', requireAction(PUBLISH, 'deploy-prod'), deploy.production);

// "Settings" (administrators only): shared by the Print-Out Builder, Jasper Designer and Publish Report.
router.get('/reports/settings', requireAdmin, asyncHandler(settings.index));
router.post('/reports/settings', requireAdmin, settings.save);
router.post('/reports/settings/test', requireAdmin, settings.test);
router.get('/reports/settings/servers/:sid/browse', requireAdmin, settings.browse);
router.get('/reports/print-out-settings', (req, res) => res.redirect(302, '/reports/settings'));   // old link

module.exports = router;
