const router = require('express').Router();
const asyncHandler = require('../../app/core/http/async.handler');
const controller = require('./controllers/querydata.controller');

// Access follows the "Query Data" menu item (/query-studio and everything under it).
router.get('/query-studio', asyncHandler(controller.index));
router.get('/query-studio/collections', controller.collections);
router.get('/query-studio/collections/:name/indexes', controller.indexes);
router.get('/query-studio/collections/:name/schema', controller.schema);
router.post('/query-studio/run', controller.run);
router.post('/query-studio/count', controller.count);
router.post('/query-studio/explain', controller.explain);
router.post('/query-studio/jasper', controller.toJasper);
router.post('/query-studio/from-jasper', controller.fromJasper);
router.post('/query-studio/export', controller.exportBatch);
router.post('/query-studio/export/done', controller.exportDone);
router.post('/query-studio/kill', controller.kill);
router.post('/query-studio/lookup', controller.lookup);
router.get('/query-studio/censor', controller.censorState);
router.post('/query-studio/censor', controller.censorSet);
router.get('/query-studio/basic-data', controller.basicData);
router.get('/query-studio/basic-data/visit', controller.basicVisit);
router.get('/query-studio/basic-data/hn', controller.basicHn);
router.get('/query-studio/saved', controller.savedList);
// Query templates (Query Template page): choices for a reference parameter, and a query filled in to run.
const templates = require('./controllers/templates.controller');
router.get('/query-studio/run-template/options', templates.options);
router.post('/query-studio/run-template/:id(\\d+)', templates.resolve);

// Basic Data widget (addon.json "widgets"): access follows the widget's own permission.
router.get('/widgets/querystudio/basic-data', controller.basicData);
router.get('/widgets/querystudio/basic-data/visit', controller.basicVisit);
router.get('/widgets/querystudio/basic-data/hn', controller.basicHn);
router.post('/query-studio/saved', controller.save);
router.post('/query-studio/saved/:id/delete', controller.savedRemove);

module.exports = router;
