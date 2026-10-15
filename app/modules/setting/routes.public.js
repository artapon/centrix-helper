// Mounted before the DB-connection guard: these pages are how a connection gets chosen.
const router = require('express').Router();
const asyncHandler = require('../../core/http/async.handler');
const settingController = require('./controllers/setting.controller');
const dbConnectionsController = require('./controllers/dbconnections.controller');

router.get('/database/info', settingController.index);
// Access: /settings/connections and /api/db-connections need "DB Connections";
// /db/connection needs "DB Info" (see the match lists in menu.config.js).
router.get('/database/connections', asyncHandler(dbConnectionsController.index));
router.post('/database/connections', asyncHandler(dbConnectionsController.create));
router.post('/database/connections/:id/delete', asyncHandler(dbConnectionsController.remove));
router.post('/database/connections/:id', asyncHandler(dbConnectionsController.update));
router.post('/api/database/connections/test', asyncHandler(dbConnectionsController.test));
router.post('/api/database/connections/uri', asyncHandler(dbConnectionsController.uri));
router.get('/api/database/connections/:id', asyncHandler(dbConnectionsController.getOne));
router.post('/database/connect', asyncHandler(dbConnectionsController.connect));
// Top bar Connect DB / Reconnect DB (same permission as /database/connect: "DB Info").
router.post('/database/connect/last', asyncHandler(dbConnectionsController.reconnect));

module.exports = router;
