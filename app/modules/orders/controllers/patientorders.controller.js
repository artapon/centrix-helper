const organisationsModel = require("../../../core/models/organisations.model");
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
  let labOrders = await patientorderModel.getPatientOrdersByCate(org[0]._id, patientuid, visituid, "LAB");

  return res.renderPage(view('laborders'), {
    title:  'Lab Orders Data',
    labOrders: labOrders,
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
  let xrayOrders = await patientorderModel.getPatientOrdersByCate(org[0]._id, patientuid, visituid, "RADIOLOGY", accessionnumber);

  return res.renderPage(view('xrayorders'), {
    title:  'RADIOLOGY Orders Data',
    xrayOrders: xrayOrders
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
  let pharmacyOrders  = await patientorderModel.getPharmacyOrders(org[0]._id, patientuid , itemcode, visituid);
  
  return res.renderPage(view('pharmacyorders'), {
    title:  'PharmacyOrders Data : '+ pharmacyOrders.length + " รายการ",
    orders : pharmacyOrders 
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
  let medsadmins  = await patientorderModel.getMedsadminOrders(org[0]._id, patientuid , visituid, itemcode, ordernumber);

  return res.renderPage(view('medsadmins'), {
    title:  'Medsadmins Data : '+ medsadmins.length + " รายการ",
    isDebug : isDebug,
    orders : medsadmins 
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
  let patientOrders  = await patientorderModel.getPatientOrders(org[0]._id, patientuid, visituid, ordercattype);

  // One query for all rows instead of one per order
  const inChargeCodes = await patientunbillModel.getOrderItemsInChargeCodes(org[0]._id, patientOrders);
  patientOrders = patientOrders.map(function(order) {
    return Object.assign(order, {
      isInchargeCode: inChargeCodes.has(`${order.patientuid}|${order.patientorderitemuid}`)
    });
  });
  
  return res.renderPage(view('patientorders'), {
    title:  'Patient Orders Data : '+ patientOrders.length + " รายการ",
    orders : patientOrders
  });
}
