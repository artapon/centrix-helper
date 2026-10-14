// Mounted before the sign-in guard: these pages are how a user gets signed in.
const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const authController = require('./controllers/auth.controller');

router.get('/login', asyncHandler(authController.loginForm));
router.post('/login', asyncHandler(authController.login));
router.post('/logout', authController.logout);
router.get('/install', asyncHandler(authController.installForm));
router.post('/install', asyncHandler(authController.install));

module.exports = router;
