// No sign-in: an organization's public, view-only status page (its Share). It answers only while that
// organization's sharing is on and the token in the link is its current one (Settings model, shareFor()).
const express = require('express');
const asyncHandler = require('../../app/core/http/async.handler');
const controller = require('./controllers/servicemonitor.controller');

const router = express.Router();
const TOKEN = ':token([A-Za-z0-9_-]{16,64})';

router.get(`/status/${TOKEN}`, asyncHandler(controller.publicPage));
router.get(`/status/${TOKEN}/data`, controller.publicData);
router.get(`/status/${TOKEN}/services/:ref([A-Za-z0-9_-]{12})`, controller.publicDetail);

module.exports = router;
