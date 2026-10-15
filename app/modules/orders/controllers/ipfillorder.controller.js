const organisationsModel = require("../../../core/models/organisations.model");
const paging = require('../../../core/http/paging');        // Previous / Next paging (?page=)
const ipfillOrderModel = require("../models/ipfillorder.model");
const patientModel = require("../../patients/models/patient.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
const patientOrderModel = require("../models/patientorders.model");
const view = require('../../../core/view')('orders');

exports.ipfillOrders = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';

  let [patientuid, visituid] = await Promise.all([
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  const p = paging.read(req);
  let { rows: ipfillorders, paging: pg } = paging.page(req, p, await ipfillOrderModel.getIPFillOrders(org[0]._id, patientuid, visituid, p));

  ipfillorders = await Promise.all(ipfillorders.map(async function(item) {
    let orderitem = await patientOrderModel.getPatientOrdersitem(item.linkpatientorderuid, item.linkpatientorderitemuid, org[0]._id);
    return Object.assign(item, {
      linkorderitemnumber: orderitem[0] ? orderitem[0].ordernumber : ""
    });
  }));

  return res.renderPage(view('ipfillorders'), {
    title:  'IP Fill Order Data : ' + org[0].name,
    ipfillorders: ipfillorders,
    paging: pg, query: { hn: hn, vn: vn }
  });
};