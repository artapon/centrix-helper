const organisationsModel = require("../../../core/models/organisations.model");
const patientvisitModel = require("../models/patientvisits.model");
const patientModel = require("../models/patient.model");
const validateModel = require("../../validate/models/validate.model");
const view = require('../../../core/view')('patients');

exports.patientVisits = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let page = req.query.page || 0;
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';
  let visitstatusuid = req.query.visitstatusuid || '';
  let entypeuid = req.query.entypeuid || '';
  let visitdate = req.query.visitdate || '';

  let [patientuid, visituid] = await Promise.all([
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);

  let nextPage = parseInt(page) + 1;
  let lastpage = parseInt(page) > 0 ? parseInt(page) - 1 : 0;

  let visits = await patientvisitModel.getVisitAll(
    org[0]._id,
    visituid,
    patientuid,
    visitstatusuid,
    page,
    entypeuid,
    visitdate
  );

  let visitStatuses = await validateModel.getReferenceValues("VISITSTATUS", org[0]._id);
  let encounterTypes = await validateModel.getReferenceValues("ENTYPE", org[0]._id);

  return res.renderPage(view('patientvisits'), {
    title: 'Patient Visits Data : ' + org[0].name,
    nextpage: nextPage,
    lastpage: lastpage,
    hn: hn,
    vn: vn,
    visitstatusuid: visitstatusuid,
    entypeuid: entypeuid,
    visitdate: visitdate,
    visits: visits,
    visitStatuses: visitStatuses || [],
    encounterTypes: encounterTypes || []
  });
}