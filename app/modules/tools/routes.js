const router = require('express').Router();
const upload = require('multer')();
const asyncHandler = require('../../core/http/async.handler');
const toolController = require('./controllers/tool.controller');
const labresultController = require('./controllers/labresult.controller');
const xrayresultController = require('./controllers/xrayresult.controller');
const labmasterController = require('./controllers/labmaster.controller');
const generatorController = require('./controllers/generator.controller');

router.get('/tools/encrypt-decrypt', asyncHandler(toolController.encryptDecrypt));
router.post('/tools/encrypt-decrypt/centrix-encrypt', asyncHandler(toolController.centrixEncrypt));
router.post('/tools/encrypt-decrypt/centrix-decrypt', asyncHandler(toolController.centrixDecrypt));
router.post('/tools/encrypt-decrypt/medint-encrypt', asyncHandler(toolController.medintEncrypt));
router.post('/tools/encrypt-decrypt/medint-decrypt', asyncHandler(toolController.medintDecrypt));
router.get('/lab/hl7-result', asyncHandler(labresultController.index));
router.post('/lab/hl7-result', asyncHandler(labresultController.index));
router.get('/radiology/hl7-result', asyncHandler(xrayresultController.index));
router.post('/radiology/hl7-result', asyncHandler(xrayresultController.index));
router.get('/lab/master', asyncHandler(labmasterController.index));
router.get('/lab/master/export', asyncHandler(labmasterController.export));
router.get('/tools/source-status', asyncHandler(toolController.mergedRSS));
router.get('/tools/erp-manual', asyncHandler(toolController.erpManual));
router.get('/tools/erp-to-excel', asyncHandler(toolController.erpDataToExcel));
router.post('/tools/erp-to-excel/convert', upload.single('file_name'), asyncHandler(toolController.erpDataToExcelConvert));
router.get('/tools/api-generator', asyncHandler(generatorController.index));

module.exports = router;
