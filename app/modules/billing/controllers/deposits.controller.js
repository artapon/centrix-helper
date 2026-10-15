const organisationsModel = require("../../../core/models/organisations.model");
const paging = require('../../../core/http/paging');        // Previous / Next paging (?page=)
const depositsModel = require("../models/deposits.model");
const patientModel = require("../../patients/models/patient.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
const view = require('../../../core/view')('billing');

exports.patientDeposits = async function (req, res) {
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';
  let orgcode = req.session.sitecode;
  let [patientuid, visituid] = await Promise.all([
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  const { rows: deposits, paging: pg } = paging.page(req, p, await depositsModel.getPatientDeposites(org[0]._id, visituid, patientuid, p));
  return res.renderPage(view('deposits'), {
    title:  'Patient Deposits : ' + org[0].name,
    deposits: deposits,
    paging: pg, query: { hn: hn, vn: vn }
  });
}