// Mounted before the DB-connection guard: the audit log lives in SQLite, so it opens without a Mongo connection.
const path = require('path');
const express = require('express');
const router = express.Router();
const asyncHandler = require('../../core/http/asyncHandler');
const controller = require('./controllers/querydata.controller');

// Access follows the "Query Data Audit" menu item (/query-studio/audit and everything under it).
router.get('/query-studio/audit', asyncHandler(controller.auditIndex));
router.get('/query-studio/audit/search', controller.auditSearch);
router.get('/query-studio/audit/options', controller.auditOptions);
router.get('/query-studio/audit/export', controller.auditExport);
router.post('/query-studio/audit/clear/preview', controller.auditClearPreview);
router.post('/query-studio/audit/clear', controller.auditClear);
router.get('/query-studio/audit/:id(\\d+)', controller.auditDetail);

// Database connection picker on Query Data. Before the DB guard, so it still works when the
// current connection is down; access follows "Query Data" (/query-studio).
router.get('/query-studio/connections', controller.connections);
router.post('/query-studio/connection', controller.switchConnection);

// Shared browser components (the Basic Data popup is also used by Jasper Designer).
router.use('/query-studio/assets', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

module.exports = router;
