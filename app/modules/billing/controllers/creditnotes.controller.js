const organisationsModel = require("../../../core/models/organisations.model");
const paging = require('../../../core/http/paging');        // Previous / Next paging (?page=)
const creditnotesModel = require("../models/creditnotes.model");
const patientModel = require("../../patients/models/patient.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
const view = require('../../../core/view')('billing');

exports.patientCreditnotes = async function (req, res) {
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';
  let orgcode = req.session.sitecode;
  let [patientuid, visituid] = await Promise.all([
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  const { rows: creditnotes, paging: pg } = paging.page(req, p, await creditnotesModel.getPatientCreditnotes(org[0]._id, visituid, patientuid, p));
  return res.renderPage(view('creditnotes'), {
    title:  'Patient Creditnotes : ' + org[0].name,
    creditnotes: creditnotes,
    paging: pg, query: { hn: hn, vn: vn }
  });
}