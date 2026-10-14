const organisationsModel = require("../../../core/models/organisations.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
const patientorderModel = require("../models/patientorders.model");
const patientModel = require("../../patients/models/patient.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('orders');

exports.diets = async function (req, res) {
  let selectedDate = req.query.date || moment().toISOString();
  let selectedDateFormat = req.query.date || moment().format('DD/MM/YYYY');
  let hn = req.query.mrn || "";
  let vn = req.query.vn || "";
  let orgcode = req.session.sitecode;

  if(selectedDate) {
    dateat = moment(selectedDate).toISOString();
    selectedDateFormat = moment(selectedDate).format('DD/MM/YYYY');
  }

  let [org, patientuid, visituid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  let diets = await patientorderModel.getPatientOrdersByCate(org[0]._id, patientuid, visituid, "DIET");
  
  return res.renderPage(view('diet'), {
    title:  'Patient Diets : ' + org[0].name,
    diets: diets
  });
};