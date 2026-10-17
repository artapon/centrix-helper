const organisationsModel = require("../../../core/models/organisations.model");
const paging = require('../../../core/http/paging');        // Previous / Next paging (?page=)
const patientbillModel = require("../models/patientbills.model");
const patientModel = require("../../patients/models/patient.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
const patientOrderModel = require("../../orders/models/patientorders.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('billing');

exports.patientVisitsByStatus = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let visits = await patientvisitModel.getVisitByStatus("Medical Discharge", org[0]._id);
  return res.renderPage(view('patientvisits'), {
    title:  'Medical Discharges Data : ' + org[0].name,
    visits: visits
  });
}

exports.patientBills = async function (req, res) {
  let dateat = moment().toISOString();
  let selectedDate = req.query.date || '';
  let hn = req.query.hn || '';
  let vn = req.query.vn || '';
  let sequencenumber = req.query.sequencenumber || '';
  let selectedDateFormat = req.query.date || '';

  let [patientuid, visituid] = await Promise.all([
    patientModel.getPatientUID(hn),
    patientvisitModel.getPatientVisitUID(vn)
  ]);

  if(selectedDate) {
    dateat = moment(selectedDate).toISOString();
    selectedDateFormat = moment(selectedDate).format('DD/MM/YYYY');
  }
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  const p = paging.read(req);
  const { rows: bills, paging: pg } = paging.page(req, p, await patientbillModel.getPatientBills(org[0]._id, selectedDateFormat, patientuid, visituid, sequencenumber, p));
  const dfcounts = await patientbillModel.countPatientBillsDFItems(bills.map(function (b) { return b._id; }), org[0]._id);
  bills.forEach(function (b) { b.dfitems = dfcounts[String(b._id)] || 0; });

  return res.renderPage(view('patientbills'), {
    title:  'Patient Bills : ' + org[0].name,
    bills: bills,
    paging: pg, query: { date: req.query.date || '', sequencenumber: sequencenumber, hn: hn, vn: vn }
  });
}

exports.patientBillsItems = async function (req, res) {
  let billuid = req.params.billuid || "";
  let orgcode = req.session.sitecode;
  let totalnetamount = 0;
  let totalprice = 0;
  let totaldiscount = 0;
  let org = await organisationsModel.getOrgData(orgcode);
  let bill = await patientbillModel.getPatientBillData(billuid, org[0]._id);
  // same bill row as on /billing/bills, for the details card
  let [billitems, billsummary, dfcount] = await Promise.all([
    patientbillModel.getPatientBillItems(bill[0]._id, org[0]._id),
    patientbillModel.getPatientBills(org[0]._id, '', null, null, bill[0].sequencenumber),
    patientbillModel.countPatientBillDFItems(bill[0]._id, org[0]._id)
  ]);
  if (billsummary && billsummary[0]) billsummary[0].dfitems = dfcount;

  billitems = await patientOrderModel.enrichItemsWithOrderDetails(billitems, org[0]._id);

  billitems.forEach(function(item){
    totalnetamount += parseFloat(item.netamount);
    totalprice += parseFloat(item.quantity) * parseFloat(item.unitprice);
    totaldiscount += parseFloat(item.payordiscount) + parseFloat(item.specialdiscount);
  });

  return res.renderPage(view('billtems'), {
    title:   'HN : ' + '<a target="_blank" href="/patients/summary?vn='+bill[0].patient.mrn+'">' +bill[0].patient.mrn+ '</a>' + ' VN : ' + '<a target="_blank" href="/patients/summary?vn='+bill[0].patientvisit.visitid+'">' +bill[0].patientvisit.visitid+ '</a>'  + ' Bill No : '+bill[0].sequencenumber,
    results : billitems,
    bill : (billsummary && billsummary[0]) || null,
    totalnetamount : totalnetamount.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    totalprice : totalprice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    totaldiscount : totaldiscount.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  });
}

exports.patientBillsItemsByHN = async function (req, res) {
  let hn = req.params.hn || "";
  let orgcode = req.session.sitecode;
  let totalnetamount = 0;
  let totalprice = 0;
  let totaldiscount = 0;
  let org = await organisationsModel.getOrgData(orgcode);
  let patientuid = await patientModel.getPatientUID(hn);
  let billitems = await patientbillModel.getPatientBillItemsByHN(patientuid, org[0]._id);

  billitems = await patientOrderModel.enrichItemsWithOrderDetails(billitems, org[0]._id);

  billitems.forEach(function(item){
    totalnetamount += parseFloat(item.netamount);
    totalprice += parseFloat(item.quantity) * parseFloat(item.unitprice);
    totaldiscount += parseFloat(item.payordiscount) + parseFloat(item.specialdiscount);
  });

  return res.renderPage(view('billtems'), {
    title:  'HN : '+ hn + ' Bill ITEMS ( '+ billitems.length +' )',
    results : billitems,
    bill : null,
    totalnetamount : totalnetamount.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    totalprice : totalprice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    totaldiscount : totaldiscount.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  });
}

exports.patientBillsPaymentItems = async function (req, res) {
  let billuid = req.params.billuid || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let bill = await patientbillModel.getPatientBillData(billuid, org[0]._id);
  let paymentitems = await patientbillModel.getPatientBillPaymentsItems(bill[0]._id, org[0]._id);

  return res.renderPage(view('paymentitems'), {
    title:  'Bill No : '+bill[0].sequencenumber + ' Paymentitems : ' + org[0].name,
    results : paymentitems,
  });
}

exports.patientBillsDFItems = async function (req, res) {
  let billuid = req.params.billuid || "";
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let bill = await patientbillModel.getPatientBillData(billuid, org[0]._id);
  let billitems = await patientbillModel.getPatientBillDFItems(bill[0]._id, org[0]._id);
  let billdfpackageitems = await patientbillModel.getPatientBillDFPackageItems(bill[0]._id, org[0]._id);
  let results = billitems.concat(billdfpackageitems);
  let totalnetamount = 0;
  let totalprice = 0;
  let totaldiscount = 0;

  // the billtems view shows these totals, so every page that uses it passes them
  results.forEach(function(item){
    totalnetamount += parseFloat(item.netamount) || 0;
    totalprice += (parseFloat(item.quantity) || 0) * (parseFloat(item.unitprice) || 0);
    totaldiscount += (parseFloat(item.payordiscount) || 0) + (parseFloat(item.specialdiscount) || 0);
  });

  return res.renderPage(view('billtems'), {
    title:  'Bill No : '+bill[0].sequencenumber + ' Bill DF ITEMS : ' + org[0].name,
    results : results,
    bill : null,
    totalnetamount : totalnetamount.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    totalprice : totalprice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    totaldiscount : totaldiscount.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  });
}
