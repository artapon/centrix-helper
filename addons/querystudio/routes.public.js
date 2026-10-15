// Mounted before the DB-connection guard: the audit log lives in SQLite, so it opens without a Mongo connection.
const path = require('path');
const express = require('express');
const router = express.Router();
const asyncHandler = require('../../app/core/http/async.handler');
const controller = require('./controllers/querydata.controller');

// Access follows the "Query Data Audit" menu item (/query-studio/audit and everything under it).
router.get('/query-studio/audit', asyncHandler(controller.auditIndex));
router.get('/query-studio/audit/search', controller.auditSearch);
router.get('/query-studio/audit/options', controller.auditOptions);
router.get('/query-studio/audit/export', controller.auditExport);
router.post('/query-studio/audit/clear/preview', controller.auditClearPreview);
router.post('/query-studio/audit/clear', controller.auditClear);
router.get('/query-studio/audit/:id(\\d+)', controller.auditDetail);

// Query Template page: templates are SQLite rows, so it opens without a Mongo connection.
// Access follows the "Query Template" menu item (/query-studio/templates and everything under it).
const templates = require('./controllers/templates.controller');
router.get('/query-studio/templates', asyncHandler(templates.index));
router.get('/query-studio/templates/list', templates.list);
router.post('/query-studio/templates/save', templates.save);
router.post('/query-studio/templates/restore', templates.restore);
router.post('/query-studio/templates/from-jasper', templates.fromJasper);
router.post('/query-studio/templates/:id(\\d+)/delete', templates.remove);
// Query Data's template picker; access follows "Query Data" (/query-studio). Filling a template
// needs the DB (HN / VN lookups): routes.js.
router.get('/query-studio/run-template', templates.pickList);

// Database connection picker on Query Data. Before the DB guard, so it still works when the
// current connection is down; access follows "Query Data" (/query-studio).
router.get('/query-studio/connections', controller.connections);
router.post('/query-studio/connection', controller.switchConnection);

// Query Data's browser components.
router.use('/query-studio/assets', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

// Widgets (addon.json "widgets"): access follows each widget's own permission (Roles & Permissions >
// Widgets), not Query Data's, so other pages can show them. Basic Data's data needs the DB: routes.js.
router.get('/widgets/querystudio/basic-data/widget.js', controller.widgetScript('basic-data.js'));
router.get('/widgets/querystudio/jasper-queries/widget.js', controller.widgetScript('jasper-queries.js'));
router.get('/widgets/querystudio/jasper-queries', controller.jasperQueries);
router.post('/widgets/querystudio/jasper-queries/:id(\d+)/delete', controller.jasperQueryRemove);

module.exports = router;
