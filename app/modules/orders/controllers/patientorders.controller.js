const organisationsModel = require("../../../core/models/organisations.model");
const paging = require('../../../core/http/paging');        // Previous / Next paging (?page=)
const patientorderModel = require("../models/patientorders.model");
const patientModel = require("../../patients/models/patient.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
const patientunbillModel = require("../../billing/models/patientunbills.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('orders');

exports.labOrders = async function (req, res) {
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
  // 50 order items a page (?page=0, 1, …); one more is read to know whether there is a next page.
  const PER_PAGE = 50;
  let page = Math.max(0, parseInt(req.query.page, 10) || 0);
  let rows = await patientorderModel.getPatientOrdersByCate(org[0]._id, patientuid, visituid, "LAB", "", { skip: page * PER_PAGE, limit: PER_PAGE + 1 }) || [];

  return res.renderPage(view('laborders'), {
    title:  'Lab Orders Data',
    labOrders: rows.slice(0, PER_PAGE),
    mrn: hn, vn: vn,
    page: page, perPage: PER_PAGE, hasMore: rows.length > PER_PAGE,
    nextpage: page + 1, lastpage: page > 0 ? page - 1 : 0,
    env: {
      IS_ALLOW_MOCK_DATA: process.env.IS_ALLOW_MOCK_DATA || '',
      CENTRIX_MANUAL_UPLOAD_OUTLAB: process.env.CENTRIX_MANUAL_UPLOAD_OUTLAB || ''
    }
  });
}

exports.xrayOrders = async function (req, res) {
  let selectedDate = req.query.date || moment().toISOString();
  let selectedDateFormat = req.query.date || moment().format('DD/MM/YYYY');
  let hn = req.query.mrn || "";
  let vn = req.query.vn || "";
  let orgcode = req.session.sitecode;

  if(selectedDate) {
    dateat = moment(selectedDate).toISOString();
    selectedDateFormat = moment(selectedDate).format('DD/MM/YYYY');
  }

  let org = await organisationsModel.getOrgData(orgcode);
  let accessionnumber = req.query.accessionnumber || "";
  let [patientuid, visituid] = await Promise.all([
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  const p = paging.read(req);
  const { rows: xrayOrders, paging: pg } = paging.page(req, p,
    await patientorderModel.getPatientOrdersByCate(org[0]._id, patientuid, visituid, "RADIOLOGY", accessionnumber, { skip: p.skip, limit: p.limit }));

  return res.renderPage(view('xrayorders'), {
    title:  'RADIOLOGY Orders Data',
    xrayOrders: xrayOrders,
    paging: pg, query: { mrn: hn, vn: vn, accessionnumber: accessionnumber }
  });
}

exports.pharmacyOrders = async function (req, res) {
  let hn = req.query.mrn || "";
  let vn = req.query.vn || "";
  let itemcode = req.query.itemcode || "";
  let orgcode = req.session.sitecode;
  let [org, patientuid, visituid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  const p = paging.read(req);
  const { rows: pharmacyOrders, paging: pg } = paging.page(req, p, await patientorderModel.getPharmacyOrders(org[0]._id, patientuid , itemcode, visituid, p));

  return res.renderPage(view('pharmacyorders'), {
    title:  'PharmacyOrders Data : '+ pharmacyOrders.length + " รายการ",
    orders : pharmacyOrders,
    paging: pg, query: { mrn: hn, vn: vn, itemcode: itemcode }
  });
}

exports.medsadmins = async function (req, res) {
  let hn = req.query.mrn || "";
  let vn = req.query.vn || "";
  let isDebug = req.query.debug || "false";
  let itemcode = req.query.itemcode || "";
  let ordernumber = req.query.ordernumber || "";
  let orgcode = req.session.sitecode;
  let [org, patientuid, visituid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  const p = paging.read(req);
  const { rows: medsadmins, paging: pg } = paging.page(req, p, await patientorderModel.getMedsadminOrders(org[0]._id, patientuid , visituid, itemcode, ordernumber, p));

  return res.renderPage(view('medsadmins'), {
    title:  'Medsadmins Data : '+ medsadmins.length + " รายการ",
    isDebug : isDebug,
    orders : medsadmins,
    paging: pg, query: { mrn: hn, vn: vn, itemcode: itemcode, ordernumber: ordernumber }
  });
}

exports.patientOrders = async function (req, res) {
  let hn = req.query.mrn || "";
  let vn = req.query.vn || "";
  let ordercattype = req.query.ordercattype || "";
  let orgcode = req.session.sitecode;
  let [org, patientuid, visituid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  const p = paging.read(req);
  let { rows: patientOrders, paging: pg } = paging.page(req, p, await patientorderModel.getPatientOrders(org[0]._id, patientuid, visituid, ordercattype, p));

  // One query for all rows instead of one per order
  const inChargeCodes = await patientunbillModel.getOrderItemsInChargeCodes(org[0]._id, patientOrders);
  patientOrders = patientOrders.map(function(order) {
    return Object.assign(order, {
      isInchargeCode: inChargeCodes.has(`${order.patientuid}|${order.patientorderitemuid}`)
    });
  });
  
  return res.renderPage(view('patientorders'), {
    title:  'Patient Orders Data : '+ patientOrders.length + " รายการ",
    orders : patientOrders,
    paging: pg, query: { mrn: hn, vn: vn }
  });
}
