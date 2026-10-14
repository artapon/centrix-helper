const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const patientorderController = require('./controllers/patientorders.controller');
const dietController = require('./controllers/diet.controller');
const ipfillOrderController = require('./controllers/ipfillorder.controller');

router.get('/lab/orders', asyncHandler(patientorderController.labOrders));
router.get('/pharmacy/orders', asyncHandler(patientorderController.pharmacyOrders));
router.get('/radiology/orders', asyncHandler(patientorderController.xrayOrders));
router.get('/billing/patient-orders', asyncHandler(patientorderController.patientOrders));
router.get('/diet/orders', asyncHandler(dietController.diets));
router.get('/pharmacy/meds-admin', asyncHandler(patientorderController.medsadmins));
router.get('/pharmacy/ip-fill-orders', asyncHandler(ipfillOrderController.ipfillOrders));

module.exports = router;
