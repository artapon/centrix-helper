const router = require('express').Router();
const asyncHandler = require('../../core/http/asyncHandler');
const doctorsController = require('./controllers/doctors.controller');
const scheduleController = require('./controllers/schedules.controller');

router.get('/data-quality/doctor-schedules', asyncHandler(scheduleController.careproviderSchedule));
router.get('/patients/doctor-visits', doctorsController.monitor);
router.get('/patients/doctor-visits/by-doctor/:careprovideruid', asyncHandler(doctorsController.visits));

module.exports = router;
