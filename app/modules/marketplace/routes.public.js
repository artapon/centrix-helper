// Signed-in administrators, no DB connection needed: add-on states live in SQLite.
const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const { requireAdmin } = require('../../core/middleware/requireAuth');
const controller = require('./controllers/marketplace.controller');

router.get('/admin/marketplace', requireAdmin, asyncHandler(controller.index));
router.post('/admin/marketplace/:id/activate', requireAdmin, asyncHandler(controller.activate));
router.post('/admin/marketplace/:id/deactivate', requireAdmin, asyncHandler(controller.deactivate));

module.exports = router;
