const router = require('express').Router();
const asyncHandler = require('../../core/http/async.handler');
const logController = require('./controllers/log.controller');

router.get('/logs/import', asyncHandler(logController.importLog));
router.get('/logs/import/data', logController.importLogData);
router.get('/logs/import/count', logController.importLogCount);
router.get('/logs/audit', asyncHandler(logController.auditLog));
router.get('/logs/audit/data', logController.auditLogData);
router.get('/logs/audit/count', logController.auditLogCount);
router.get('/logs/audit-detail', asyncHandler(logController.auditlogDetail));
router.post('/logs/audit-detail/lookup', require('../../core/helpers/auditlookup.helper').lookupHandler);
router.get('/interfaces/sap', asyncHandler(logController.sapinterface));
router.get('/interfaces/sap/export', asyncHandler(logController.sapinterfaceExport));
router.get('/logs/import/export', asyncHandler(logController.importLogExport));
router.get('/radiology/mirth-log/:channelType', asyncHandler(logController.xrayresultlog));
router.get('/reports/event-logs', asyncHandler(logController.jasperReportLogs));

module.exports = router;
