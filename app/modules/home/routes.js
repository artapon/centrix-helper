const router = require('express').Router();
const asyncHandler = require('../../core/http/async.handler');
const homeController = require('./controllers/home.controller');

router.get('/home', asyncHandler(homeController.home));

module.exports = router;
