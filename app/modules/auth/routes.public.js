// Signed-in users, no DB connection needed.
const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const { requireAdmin } = require('../../core/middleware/requireAuth');
const usersController = require('./controllers/users.controller');
const rolesController = require('./controllers/roles.controller');

router.get('/account', asyncHandler(usersController.account));
router.post('/account/profile', asyncHandler(usersController.updateProfile));
router.post('/account/password', asyncHandler(usersController.changePassword));

router.get('/admin/users', requireAdmin, asyncHandler(usersController.index));
router.post('/admin/users', requireAdmin, asyncHandler(usersController.create));
router.post('/admin/users/:id/delete', requireAdmin, asyncHandler(usersController.remove));
router.post('/admin/users/:id', requireAdmin, asyncHandler(usersController.update));

router.get('/admin/roles', requireAdmin, asyncHandler(rolesController.index));
router.post('/admin/roles', requireAdmin, asyncHandler(rolesController.create));
router.post('/admin/roles/:key/delete', requireAdmin, asyncHandler(rolesController.remove));
router.post('/admin/roles/:key', requireAdmin, asyncHandler(rolesController.update));

module.exports = router;
