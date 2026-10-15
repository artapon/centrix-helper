// Signed-in administrators, no DB connection needed: add-on states live in SQLite.
const router = require('express').Router();
const asyncHandler = require('../../core/http/async.handler');
const { requireAdmin } = require('../../core/middleware/requireauth.middleware');
const controller = require('./controllers/marketplace.controller');

// Add-on packages arrive in memory (one .zip, at most 20 MB); nothing is written until "Install".
// multer is loaded here, not at start: without it only uploading fails, not the app.
const pkg = (req, res, next) => {
  let multer;
  try { multer = require('multer'); } catch (e) { return res.status(500).json({ error: 'Uploading needs the npm package "multer": run npm install multer, then restart.' }); }
  return multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 20 * 1024 * 1024 } }).single('package')(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The package is larger than 20 MB.' : err.message });
  });
};

router.get('/admin/marketplace', requireAdmin, asyncHandler(controller.index));
// Before /:id, so "guide" and "upload" are not taken for add-on ids.
router.get('/admin/marketplace/guide', requireAdmin, asyncHandler(controller.guide));
router.get('/admin/marketplace/guide/starter.zip', requireAdmin, controller.starter);
router.post('/admin/marketplace/upload', requireAdmin, pkg, controller.uploadPreview);
router.post('/admin/marketplace/upload/install', requireAdmin, controller.uploadInstall);
router.post('/admin/marketplace/restart', requireAdmin, controller.restart);
router.get('/admin/marketplace/:id', requireAdmin, asyncHandler(controller.detail));
router.post('/admin/marketplace/:id/activate', requireAdmin, asyncHandler(controller.activate));
router.post('/admin/marketplace/:id/deactivate', requireAdmin, asyncHandler(controller.deactivate));

module.exports = router;
