const fs = require('fs');
const organisationsModel = require("../../../core/models/organisations.model");
const logModel = require("../models/log.model");
const mirthConnectModel = require("../models/mirthconnect.model");
const jasperServerModel = require("../models/jasperserver.model");
const jsonformat = require('json-format');
const moment = require("moment-timezone");
const view = require('../../../core/view')('logs');

const logBatchModel = require("../models/logbatch.model");
// postaudit is JSON text; anything else is shown as it is.
const parseAudit = (text) => { try { return JSON.parse(text); } catch (e) { return text || ''; } };
const { csvLine } = require("../../../core/spreadsheet");

const IMPORT_FILTERS = ["datasetcode", "dataset", "resulttype", "from", "to"];
const AUDIT_FILTERS = ["datasetcode", "dataset", "from", "to"];
const pick = (query, keys) => keys.reduce((out, k) => { out[k] = typeof query[k] === "string" ? query[k].trim() : ""; return out; }, {});
const daysAgo = (n) => moment().tz("Asia/Bangkok").subtract(n, "days").format("YYYY-MM-DD");

// JSON endpoints for the batch-loading pages: errors come back as { error } instead of a page.
const json = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("Log batch failed:", err.message);
    res.status(500).json({ error: logBatchModel.timeoutMessage(err) });
  }
};

async function orgOf(req) {
  const org = await organisationsModel.getOrgData(req.session.sitecode);
  return org && org[0] ? org[0] : {};
}

// The page renders straight away; rows are loaded in batches by the browser.
exports.importLog = async function (req, res) {
  const org = await orgOf(req);
  const filters = pick(req.query, IMPORT_FILTERS);
  if (req.query.resulttype === undefined) filters.resulttype = "ERROR";
  return res.renderPage(view('importlog'), {
    title: 'ImportLog Data : ' + (org.name || ''),
    filters,
    batch: { size: logBatchModel.DEFAULT_BATCH, max: logBatchModel.MAX_BATCH }
  });
}

exports.importLogData = json((req) => logBatchModel.importLogBatch(Object.assign(pick(req.query, IMPORT_FILTERS), { before: req.query.before, size: req.query.size })));
exports.importLogCount = json((req) => logBatchModel.importLogCount(pick(req.query, IMPORT_FILTERS)));

// Streams the CSV batch by batch, so large exports never sit in memory.
exports.importLogExport = async function (req, res) {
  const q = pick(req.query, IMPORT_FILTERS);
  const columns = logBatchModel.IMPORT_COLUMNS;
  const CRLF = "\r\n";
  let rows = 0;
  const start = (file) => {
    if (res.headersSent) return;
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.write("﻿" + csvLine(columns, Object.fromEntries(columns.map((c) => [c.key, c.label]))) + CRLF);
  };
  const file = `Import_log_${moment().tz("Asia/Bangkok").format("YYYYMMDD_HHmm")}.csv`;
  try {
    await logBatchModel.eachImportLogBatch(q, (batch) => new Promise((resolve) => {
      start(file);
      rows += batch.length;
      if (res.write(batch.map((r) => csvLine(columns, r)).join(CRLF) + CRLF)) resolve();
      else res.once('drain', resolve);
    }));
    start(file);
    res.end();
  } catch (error) {
    console.error('Error exporting import logs after ' + rows + ' rows:', error.message);
    if (!res.headersSent) return res.status(500).json({ error: logBatchModel.timeoutMessage(error) });
    res.end(CRLF + "# Export stopped after " + rows + " rows: " + logBatchModel.timeoutMessage(error) + CRLF);
  }
}

exports.auditLog = async function (req, res) {
  const org = await orgOf(req);
  const filters = pick(req.query, AUDIT_FILTERS);
  if (req.query.dataset === undefined) filters.dataset = "ReferenceDomain";
  if (req.query.from === undefined && req.query.to === undefined) { filters.from = daysAgo(6); filters.to = daysAgo(0); }
  return res.renderPage(view('auditlog'), {
    title: 'Auditlog Data : ' + (org.name || ''),
    filters,
    datasets: logBatchModel.AUDIT_DATASETS,
    batch: { size: logBatchModel.DEFAULT_BATCH, max: logBatchModel.MAX_BATCH }
  });
}

exports.auditLogData = json(async (req) => logBatchModel.auditLogBatch(Object.assign(pick(req.query, AUDIT_FILTERS), { before: req.query.before, size: req.query.size }), (await orgOf(req))._id));
exports.auditLogCount = json(async (req) => logBatchModel.auditLogCount(pick(req.query, AUDIT_FILTERS), (await orgOf(req))._id));

exports.auditlogDetail = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let loguid = req.query.loguid || '';
  let viewall = req.query.viewall || '';
  let limit = 20;
  if(viewall)
    limit = 0;

  let postdata = await logModel.geAuditLogsDetail(org[0]._id, /^[0-9a-f]{24}$/i.test(loguid) ? loguid : '000000000000000000000000');
  let dataset = postdata && postdata[0] ? postdata[0].dataset : '';
  postdata = postdata && postdata[0] ? parseAudit(postdata[0].postaudit) : '';
  postdata = jsonformat(postdata, { type: 'space', size: 2});
  let postdataRaw = postdata;
  postdata = JSON.stringify(postdata);
  return res.renderPage(view.shared('postdata'), {
    title:  org[0].name + 'AuditLog Detail : Log UID '+ loguid || '',
    postdata : postdata,
    postdataRaw: postdataRaw,
    dataset : dataset,
    collection: logBatchModel.datasetCollection(dataset)
  });
}

exports.sapinterface = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let identifierkey = req.query.identifierkey || '';
  let isdone = req.query.isdone || '';
  let responsestatus = req.query.responsestatus || '';
  let fromDate = req.query.date || '';
  let toDate = req.query.date2 || '';
  let sapLogs = await logModel.getSapLogs(org[0]._id, isdone, identifierkey, responsestatus, fromDate, toDate)

  return res.renderPage(view('sap'), {
    title:  'SAP Interface Logs',
    identifierkey : identifierkey,
    isdone : isdone,
    fromDate : fromDate,
    toDate : toDate,
    responsestatus : responsestatus,
    sapLogs: sapLogs,
    export_url : "/interfaces/sap/export?date="+fromDate+"&date2=" + toDate + "&identifierkey=" + identifierkey + "&responsestatus=" + responsestatus + "&isdone=" + isdone
  });
}

exports.sapinterfaceExport = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let identifierkey = req.query.identifierkey || '';
  let isdone = req.query.isdone || '';
  let responsestatus = req.query.responsestatus || '';
  let fromDate = req.query.date || '';
  let toDate = req.query.date2 || '';
  let isExport = true;

  console.log(fromDate, toDate, identifierkey, responsestatus, isdone)
  let sapLogs = await logModel.getSapLogs(org[0]._id, isdone, identifierkey, responsestatus, fromDate, toDate, isExport);
  res.xls(fromDate + '-' +toDate +'_SAP_INTERFACE_LOGS.xlsx', sapLogs);
}

exports.xrayresultlog = async function(req, res) {
  let channelID = "";
  let channelType = req.params.channelType;
  let orderstatus = req.query.status || "ERROR";
  let PATIENTMRN = req.query.PATIENTMRN || '';

  if(channelType == 'orm') {
    channelID = process.env.MIRTH_ORM_CHANNELID;
  } else {
    channelID = process.env.MIRTH_ORU_CHANNELID;
  }

  let xraylogs = await mirthConnectModel.getChannelMessageLogByID(channelID ,PATIENTMRN, orderstatus);
  return res.renderPage(view('xrayresultlog'), {
    title:  'Xray Mirth Log',
    xraylogs: xraylogs,
    channelType : channelType
  });
}

exports.jasperReportLogs = async function (req, res) {
  let reports = await jasperServerModel.getReportData();

  return res.renderPage(view('jasperserverlog'), {
    title:  'Jasper Report Updating Logs',
    reports: reports,
    count : reports.length
  });
}