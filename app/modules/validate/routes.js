const router = require('express').Router();
const upload = require('multer')();
const asyncHandler = require('../../core/http/asyncHandler');
const validateController = require('./controllers/validate.controller');
const dfController = require('./controllers/df.controller');

router.get('/radiology/default-modality', asyncHandler(validateController.modality));
router.get('/radiology/default-modality/export', asyncHandler(validateController.modalityExport));
router.get('/data-quality/active-to', asyncHandler(validateController.activeto));
router.get('/data-quality/status-deleted', asyncHandler(validateController.statusFlagD));
router.get('/interfaces/settings', asyncHandler(validateController.interfaceSetting));
router.get('/billing/df-check', asyncHandler(dfController.dforder));
router.get('/billing/df-check-xray', asyncHandler(dfController.dfxray));
router.get('/migration/visit-data', asyncHandler(validateController.transactionData));
router.get('/migration/patient-data', asyncHandler(validateController.havePatientData));
router.get('/migration/other-data', asyncHandler(validateController.countNotransactionData));
router.get('/data-quality/inventory', asyncHandler(validateController.inventoryData));
router.get('/radiology/accession-check', asyncHandler(validateController.validateAccessionnumberOrders));
router.get('/lab/result-check', asyncHandler(validateController.validateLabResult));
router.post('/lab/result-check/file', upload.single('file_name'), asyncHandler(validateController.validateLabResultFile));

module.exports = router;
