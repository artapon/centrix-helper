// Signed-in users, no DB connection needed. Editing shortcuts is for administrators.
const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const { requireAdmin } = require('../../core/middleware/requireAuth');
const shortcutsController = require('./controllers/shortcuts.controller');

router.get('/tools/shortcuts', asyncHandler(shortcutsController.index));
router.post('/tools/shortcuts/groups', requireAdmin, asyncHandler(shortcutsController.createGroup));
router.post('/tools/shortcuts/groups/:id/move', requireAdmin, asyncHandler(shortcutsController.moveGroup));
router.post('/tools/shortcuts/groups/:id/delete', requireAdmin, asyncHandler(shortcutsController.removeGroup));
router.post('/tools/shortcuts/groups/:id', requireAdmin, asyncHandler(shortcutsController.updateGroup));
router.post('/tools/shortcuts/links', requireAdmin, asyncHandler(shortcutsController.createLink));
router.post('/tools/shortcuts/links/:id/move', requireAdmin, asyncHandler(shortcutsController.moveLink));
router.post('/tools/shortcuts/links/:id/delete', requireAdmin, asyncHandler(shortcutsController.removeLink));
router.post('/tools/shortcuts/links/:id', requireAdmin, asyncHandler(shortcutsController.updateLink));

module.exports = router;
