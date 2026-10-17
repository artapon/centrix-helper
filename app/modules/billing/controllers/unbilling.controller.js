const organisationsModel = require("../../../core/models/organisations.model");
const patientUnbillModel = require("../models/patientunbills.model");
const patientOrderModel = require("../../orders/models/patientorders.model");
const patientModel = require("../../patients/models/patient.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('billing');
const renderPage = require('../../../core/middleware/renderpage.middleware');

exports.patientUnBills = async function (req, res) {
  let dateat = moment().toISOString();
  let selectedDate = req.query.date || moment().toISOString();
  let selectedDateFormat = req.query.date || moment().format('DD/MM/YYYY');
  let page = req.query.page || 0;
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';
  let orgcode = req.session.sitecode;
  let nextPage = parseInt(page) + 1;
  let lastpage = parseInt(page)  > 0 ? parseInt(page) - 1 : 0;

  if(selectedDate) {
    dateat = moment(selectedDate).toISOString();
    selectedDateFormat = moment(selectedDate).format('DD/MM/YYYY');
  }
  
  let [org, patientuid, visituid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);
  let unbills = await patientUnbillModel.getPatientUnBills(org[0]._id, patientuid, visituid, page);

  return res.renderPage(view('patientunbills'), {
    title:  'Patient Chargecodes : ' + org[0].name,
    unbills: unbills,
    nextpage : nextPage,
    lastpage : lastpage,
    page : parseInt(page) || 0,
    hn : hn,
    vn : vn
  });
}

// ─── Charge code items (paged) ────────────────────────────────────────
// The page shows the first ITEMS_PAGE_SIZE items; the view loads the rest in batches from
// the .../rows endpoints. Totals and flag counts come from a summary over all items.
const ITEMS_PAGE_SIZE = 100;
const ITEMS_MAX_BATCH = 500;
const money = (value) => value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function itemsPageData(summary, rows, rowsUrl) {
  const net = (flag) => (summary.flags[flag] ? summary.flags[flag].netamount : 0);
  const flagCounts = {};
  Object.keys(summary.flags).forEach((flag) => { flagCounts[flag] = summary.flags[flag].count; });
  return {
    results: rows,
    totalItems: summary.total,
    flagCounts,
    pageSize: ITEMS_PAGE_SIZE,
    rowsUrl,
    totalnetamountA: money(net('A')),
    totalnetamountD: money(net('D')),
    totalamountAD: money(net('A') + net('D'))
  };
}

// One batch of rows as JSON: ?offset=100&limit=100
async function sendItemRows(req, res, loadRows) {
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(ITEMS_MAX_BATCH, Math.max(1, parseInt(req.query.limit, 10) || ITEMS_PAGE_SIZE));
  const org = await organisationsModel.getOrgData(req.session.sitecode);
  const rows = await patientOrderModel.enrichItemsWithOrderDetails(await loadRows(org[0]._id, offset, limit), org[0]._id);
  res.type('json').send(renderPage.toJson({ offset, rows }));
}

exports.patientBillsItems = async function (req, res) {
  let unbilluid = req.params.unbilluid || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let [unbill, summary, firstRows] = await Promise.all([
    patientUnbillModel.getPatientUnBillData(unbilluid, org[0]._id),
    patientUnbillModel.getPatientUnBillItemsSummary(unbilluid, org[0]._id),
    patientUnbillModel.getPatientUnBillItems(unbilluid, org[0]._id, 0, ITEMS_PAGE_SIZE)
  ]);
  let rows = await patientOrderModel.enrichItemsWithOrderDetails(firstRows, org[0]._id);

  return res.renderPage(view('unbilltems'), {
    title:   'HN : ' + '<a target="_blank" href="/patients/summary?vn='+unbill[0].mrn+'">' +unbill[0].mrn+ '</a>' + ' VN : ' + '<a target="_blank" href="/patients/summary?vn='+unbill[0].visitid+'">' +unbill[0].visitid+ '</a>'  + ' Chargecodes Items (' + summary.total +')',
    chargecode: unbill[0] || null,   // same fields as the /billing/charge-codes row, for the details card
    ...itemsPageData(summary, rows, `/billing/unbill-items/${encodeURIComponent(unbilluid)}/rows`)
  });
}

exports.patientBillsItemsRows = function (req, res) {
  return sendItemRows(req, res, (orguid, offset, limit) =>
    patientUnbillModel.getPatientUnBillItems(req.params.unbilluid, orguid, offset, limit));
}

exports.patientBillsItemsByHN = async function (req, res) {
  let hn = req.params.hn || "";
  let orgcode = req.session.sitecode;
  let [org, patientuid] = await Promise.all([
    organisationsModel.getOrgData(orgcode),
    patientModel.getPatientUID(hn)
  ]);
  let [summary, firstRows] = await Promise.all([
    patientUnbillModel.getPatientUnBillItemsSummaryByHN(patientuid, org[0]._id),
    patientUnbillModel.getPatientUnBillItemsByHN(patientuid, org[0]._id, 0, ITEMS_PAGE_SIZE)
  ]);
  let rows = await patientOrderModel.enrichItemsWithOrderDetails(firstRows, org[0]._id);

  return res.renderPage(view('unbilltems'), {
    title:  'HN : ' + hn + ' Chargecodes items (' + summary.total + ')',
    chargecode: null,
    ...itemsPageData(summary, rows, `/billing/unbill-items-by-hn/${encodeURIComponent(hn)}/rows`)
  });
}

exports.patientBillsItemsByHNRows = async function (req, res) {
  const patientuid = await patientModel.getPatientUID(req.params.hn || '');
  return sendItemRows(req, res, (orguid, offset, limit) =>
    patientUnbillModel.getPatientUnBillItemsByHN(patientuid, orguid, offset, limit));
}
