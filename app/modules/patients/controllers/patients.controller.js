const jsonformat = require('json-format');
const organisationsModel = require("../../../core/models/organisations.model");
const patientbillModel = require("../../billing/models/patientbills.model");
const patientUnbillModel = require("../../billing/models/patientunbills.model");
const depositsModel = require("../../billing/models/deposits.model");
const creditnotesModel = require("../../billing/models/creditnotes.model");
const bedtranfersModel = require("../models/bedtranfers.model");
const patientModel = require("../models/patient.model");
const patientvisitModel = require("../models/patientvisits.model");
const dfModel = require("../models/df.model");
const newborndetailModel = require("../models/newborndetail.model");
const allergyModel = require("../models/allergy.model");
let _ = require('lodash');
const view = require('../../../core/view')('patients');

exports.patientSummary = async function (req, res) {
  let orgcode = req.session.sitecode;
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';

  hn = hn.trim();
  vn = vn.trim();

  let [org, patientuid, visituid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);

  let visits = [];
  let bills = [];
  let unbills = [];
  let deposits = [];
  let creditnotes = [];
  let visitJourneys = [];
  let bedOccuparies = [];
  let visitPayors = [];
  let visitcareproviders = [];
  let bedtranfers = [];
  let patientmerges = [];
  let dfItems = [];
  let auditlogs = [];
  let alerts = [];
  let newborndetails = [];
  let allergies  = [];

  if(hn || vn) {
    const orguid = org[0]._id;

    // The queries are independent, so they run in parallel; the patient-level ones wait
    // only for the patient uid, which comes from the visit when just a VN was given.
    const ownerUid = hn
      ? Promise.resolve(patientuid)
      : patientvisitModel.getVisitDataByUid(visituid).then((visitdata) => visitdata[0].patientuid);

    const patientQueries = ownerUid.then((ownerPatientUid) => Promise.all([
      patientModel.gePatientAlerts(orguid, ownerPatientUid, 20),
      patientModel.getPatientMergeData(orguid, ownerPatientUid),
      dfModel.getPatientBillDFItems(orguid, ownerPatientUid, visituid),
      dfModel.getPatientBillDFPackageItems(orguid, ownerPatientUid, visituid),
      allergyModel.getPatientDrugAllergies(orguid, ownerPatientUid)
    ]));

    let dfbillitems, dfbilldfpackageitems;
    [
      visits, bills, unbills, deposits, creditnotes, visitJourneys, bedOccuparies,
      visitPayors, visitcareproviders, bedtranfers, newborndetails,
      [alerts, patientmerges, dfbillitems, dfbilldfpackageitems, allergies]
    ] = await Promise.all([
      patientvisitModel.getVisitAll(orguid, visituid, patientuid),
      patientbillModel.getPatientBills(orguid, "", patientuid, visituid),
      patientUnbillModel.getPatientUnBills(orguid, patientuid, visituid),
      depositsModel.getPatientDeposites(orguid, visituid, patientuid),
      creditnotesModel.getPatientCreditnotes(orguid, visituid, patientuid),
      patientvisitModel.getVisitJourneys(orguid, visituid, patientuid),
      patientvisitModel.getBedoccupancy(orguid, visituid, patientuid),
      patientvisitModel.getVisitPayors(orguid, visituid, patientuid),
      patientvisitModel.getVisitcareproviders(orguid, visituid, patientuid),
      bedtranfersModel.getBedtransfers(orguid, visituid, patientuid),
      newborndetailModel.getNewbornDetailsData(orguid, visituid, patientuid),
      patientQueries
    ]);

    dfItems = dfbillitems.concat(dfbilldfpackageitems)
    dfItems = _.sortBy(dfItems, 'visitid')
  }
  return res.renderPage(view('summary'), {
    title:  'Patient Summary : ' + org[0].name,
    visits: visits,
    bills : bills,
    unbills : unbills,
    deposits : deposits,
    creditnotes: creditnotes,
    visitJourneys : visitJourneys,
    bedOccuparies : bedOccuparies,
    visitPayors : visitPayors,
    visitcareproviders : visitcareproviders,
    bedtranfers : bedtranfers,
    patientmerges : patientmerges,
    dfItems : dfItems,
    allergies : allergies,
    hn : hn,
    alerts : alerts,
    newborndetails : newborndetails
  });
}


// 50 merges a page (?page=0, 1, …); one more is read to know whether there is a next page.
const MERGES_PER_PAGE = 50;
exports.patientMerges = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let hn = String(req.query.hn || '').trim();
  let page = Math.max(0, parseInt(req.query.page, 10) || 0);
  let patientuid = await patientModel.getPatientUID(hn);
  let rows = await patientModel.getPatientMergeData(org[0]._id, patientuid, { skip: page * MERGES_PER_PAGE, limit: MERGES_PER_PAGE + 1 }) || [];
  let hasMore = rows.length > MERGES_PER_PAGE;

  return res.renderPage(view('merges'), {
    title:  'Patient Merges : ' + org[0].name,
    patientmerges : rows.slice(0, MERGES_PER_PAGE),
    hn: hn,
    page: page,
    perPage: MERGES_PER_PAGE,
    hasMore: hasMore,
    nextpage: page + 1,
    lastpage: page > 0 ? page - 1 : 0
  });
}

exports.patientAuditlogDetail = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let loguid = req.query.loguid || '';
  let viewall = req.query.viewall || '';
  let limit = 20;
  if(viewall)
    limit = 0;

  let postdata = await patientModel.gePatientAuditLogsDetail(org[0]._id, loguid, limit);
  let mrn = postdata[0] ? postdata[0].patientuid.mrn : '';
  postdata = postdata ? JSON.parse(postdata[0].postaudit) : '';
  postdata = jsonformat(postdata, { type: 'space', size: 2});
  let postdataRaw = postdata;
  postdata = JSON.stringify(postdata);
  return res.renderPage(view.shared('postdata'), {
    title:  org[0].name + 'Patient AuditLog Detail : HN '+ mrn || '',
    postdata : postdata,
    postdataRaw: postdataRaw,
    dataset : '',
    collection: 'patients'
  });
}

exports.patientAuditlogMore = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let hn = req.query.hn || '';
  let viewall = req.query.viewall || 20;

  hn = hn.trim();

  let patientuid = await patientModel.getPatientUID(hn);
  let limit = parseInt(viewall);

  auditlogs = await patientModel.gePatientAuditLogsData(org[0]._id, patientuid, limit);

  return res.renderPage(view('auditlogall'), {
    title:  org[0].name + 'Patient AuditLog Detail : HN '+ hn || '',
    auditlogs : auditlogs
  });
}