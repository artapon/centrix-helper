const router = require('express').Router();
const asyncHandler = require('../../core/http/async.handler');
const patientvisitsController = require('./controllers/patientvisits.controller');
const patientsController = require('./controllers/patients.controller');
const patientpackagesController = require('./controllers/patientpackages.controller');

router.get('/patients/visits', asyncHandler(patientvisitsController.patientVisits));
router.get('/patients/summary', asyncHandler(patientsController.patientSummary));
router.get('/patients/audit-detail',asyncHandler(patientsController.patientAuditlogDetail));
router.post('/patients/audit-detail/lookup', require('../../core/helpers/auditlookup.helper').lookupHandler);
router.get('/patients/audit-log', asyncHandler(patientsController.patientAuditlogMore));
router.get('/patients/merges', asyncHandler(patientsController.patientMerges));
router.get('/patients/package-items/:ordersetuid', asyncHandler(patientpackagesController.patientPackageItems));

module.exports = router;
