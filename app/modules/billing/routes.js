const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const billingController = require('./controllers/billing.controller');
const unBillController = require('./controllers/unbilling.controller');
const depositsController = require('./controllers/deposits.controller');
const creditnotesController = require('./controllers/creditnotes.controller');

router.get('/billing/medical-discharges', billingController.patientVisitsByStatus);
router.get('/billing/bills', asyncHandler(billingController.patientBills));
router.get('/billing/charge-codes', asyncHandler(unBillController.patientUnBills));
router.get('/billing/bill-items/:billuid', asyncHandler(billingController.patientBillsItems));
router.get('/billing/bill-items-by-hn/:hn', asyncHandler(billingController.patientBillsItemsByHN));
router.get('/billing/bill-df-items/:billuid', asyncHandler(billingController.patientBillsDFItems));
router.get('/billing/payment-items/:billuid', asyncHandler(billingController.patientBillsPaymentItems));
router.get('/billing/unbill-items/:unbilluid', asyncHandler(unBillController.patientBillsItems));
router.get('/billing/unbill-items/:unbilluid/rows', asyncHandler(unBillController.patientBillsItemsRows));
router.get('/billing/unbill-items-by-hn/:hn', asyncHandler(unBillController.patientBillsItemsByHN));
router.get('/billing/unbill-items-by-hn/:hn/rows', asyncHandler(unBillController.patientBillsItemsByHNRows));
router.get('/billing/deposits', asyncHandler(depositsController.patientDeposits));
router.get('/billing/credit-notes', asyncHandler(creditnotesController.patientCreditnotes));

module.exports = router;
