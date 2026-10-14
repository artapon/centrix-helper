const mongoose = require("mongoose");
const moment = require("moment-timezone");

// Batch loading for the import log and audit log pages. Both collections grow without
// bound, so the work per request is kept small and bounded:
// - rows are read newest first in keyset batches on _id (always indexed): each batch
//   continues from the last _id of the previous one instead of skipping;
// - the date range becomes an _id range, and each query covers one _id time window, so a
//   filter on an unindexed field never turns into one long scan (see readBatch);
// - users, organisations and dataset names come from a short-lived cache, fetched with $in
//   only for ids not seen recently, not with a $lookup per row;
// - long error logs are cut inside MongoDB, so only what the page shows is sent;
// - reads may go to a secondary when the server is a replica set;
// - exact counts run only when asked for; the first batch carries the free estimate.

const TZ = "Asia/Bangkok";
const DEFAULT_BATCH = 100;
const MAX_BATCH = 2000;
const COUNT_TIMEOUT_MS = 20000;
const LOOKUP_TIMEOUT_MS = 10000;
const WINDOW_TIMEOUT_MS = 15000;          // one window query
const SCAN_BUDGET_MS = 3000;              // one request walks back through windows for at most this long
const WINDOW_START_MS = 6 * 3600000;      // first window: 6 hours
const WINDOW_MAX_MS = 90 * 86400000;      // widest window: 90 days
const EDGE_TTL_MS = 5 * 60000;
// Logs are history: reading them from a secondary (when there is one) keeps the load off the primary.
const READ = { readPreference: "secondaryPreferred" };
const ERRORLOG_MAX = 4000;   // list rows only; the CSV export keeps the full text

// Audit log dataset -> the collection its datasetuid points to.
const AUDIT_DATASETS = {
  ReferenceDomain: "referencedomains",
  OrderItem: "orderitems",
  OrderSet: "ordersets",
  OrderRouteMap: "orderroutemaps",
  OrderResultItem: "orderresultitems",
  ITEM_MASTER: "itemmasters",
  DrugMaster: "drugmasters",
  DrugGroup: "druggroups",
  TaskMaster: "tasks",
  Department: "departments",
  Tariffs: "tariffs",
  FormTemplate: "formtemplates",
  CertTemplate: "certificatetemplates",
  "REPORT TEMPLATE": "reporttemplates",
  RegistrationSetting: "registrationsettings",
  OrderSetting: "ordersettings",
  DoctorWorkbenchSetting: "doctorworkbenchsettings",
  EmergencySetting: "emergencysettings",
  EMRSetting: "emrsettings",
  ANCSetting: "ancsettings",
  BatchJobSetting: "batchjobsettings",
  PharmacyWorklistSetting: "pharmacyworklistsettings",
  PharmacySetting: "pharmacysettings",
  InventorySetting: "inventorysettings",
  InpatientSetting: "inpatientsettings",
  ThirdPartySetting: "thirdpartysettings",
  RadiologySetting: "radiologysettings",
  "Billing Parameters": "billingparameters",
  SequenceNumber: "sequencenumbers",
  GenerateBedCharges: "organisations",
  "EDC Config": "edcconfigs"
};

const db = () => mongoose.connection.db;
const ObjectId = mongoose.Types.ObjectId;
const isId = (v) => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);
const idText = (v) => (v && v._bsontype ? v.toString() : v ? String(v) : "");
const text = (v) => (typeof v === "string" ? v.trim() : "");

function clampBatch(n) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_BATCH) : DEFAULT_BATCH;
}

function dateText(d) {
  if (!d) return "";
  const m = moment(d);
  return m.isValid() ? m.tz(TZ).format("DD/MM/YYYY HH:mm") : "";
}

// YYYY-MM-DD (Bangkok days) -> an _id range; `to` includes the whole day.
function idRange(from, to) {
  const range = {};
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? moment.tz(s, "YYYY-MM-DD", TZ) : null);
  const f = day(from), t = day(to);
  if (f && f.isValid()) range.$gte = ObjectId.createFromTime(Math.floor(f.valueOf() / 1000));
  if (t && t.isValid()) range.$lt = ObjectId.createFromTime(Math.floor(t.add(1, "day").valueOf() / 1000));
  return range;
}

function withCursor(filter, before) {
  if (!isId(before)) return filter;
  const range = Object.assign({}, filter._id || {});
  const cursor = before.toLowerCase();
  range.$lt = range.$lt && range.$lt.toString() < cursor ? range.$lt : ObjectId(cursor);
  return Object.assign({}, filter, { _id: range });
}

// { "<id>": doc } for every id in `ids`, reading only `projection`. Small reference records
// (users, organisations, dataset masters) are cached for a few minutes, so paging through
// thousands of log rows by the same few users does not query them again for every batch.
const NAME_TTL_MS = 10 * 60000;
const NAME_CACHE_MAX = 20000;
const nameCache = new Map();   // "<collection>:<id>" -> { doc, at }

async function byIds(collection, ids, projection) {
  const unique = [...new Set(ids.filter(Boolean).map(idText).filter(isId).map((id) => id.toLowerCase()))];
  const map = {}, missing = [], now = Date.now();
  unique.forEach((id) => {
    const hit = nameCache.get(collection + ":" + id);
    if (hit && now - hit.at < NAME_TTL_MS) { if (hit.doc) map[id] = hit.doc; }
    else missing.push(id);
  });
  if (!missing.length) return map;
  const docs = await db().collection(collection)
    .find({ _id: { $in: missing.map((id) => ObjectId(id)) } }, Object.assign({ projection }, READ))
    .maxTimeMS(LOOKUP_TIMEOUT_MS)
    .toArray();
  if (nameCache.size > NAME_CACHE_MAX) nameCache.clear();
  const found = {};
  docs.forEach((d) => { found[d._id.toString()] = d; });
  missing.forEach((id) => {
    nameCache.set(collection + ":" + id, { doc: found[id] || null, at: now });   // misses are cached too
    if (found[id]) map[id] = found[id];
  });
  return map;
}

const usersOf = (rows, fields) => byIds("users", rows.flatMap((r) => fields.map((f) => r[f])), { name: 1 });
const nameOf = (map, id) => (map[idText(id).toLowerCase()] || {}).name || "";

// Oldest and newest _id of a collection (two index-only reads), cached for a few minutes.
const edgeCache = new Map();
async function edges(collection) {
  const hit = edgeCache.get(collection);
  if (hit && Date.now() - hit.at < EDGE_TTL_MS) return hit;
  const first = (sort) => db().collection(collection)
    .find({}, Object.assign({ projection: { _id: 1 } }, READ)).sort({ _id: sort }).limit(1).toArray()
    .then((d) => (d[0] ? d[0]._id : null));
  const [oldest, newest] = await Promise.all([first(1), first(-1)]);
  const out = { oldest, newest, at: Date.now() };
  edgeCache.set(collection, out);
  return out;
}

const idAt = (ms) => ObjectId.createFromTime(Math.max(0, Math.floor(ms / 1000)));
const msOf = (id) => id.getTimestamp().getTime();

/**
 * One batch, newest first, read window by window back through time.
 *
 * A filter on a field without an index (dataset, resulttype, ...) can make one query walk
 * a huge part of the collection before it finds `size` matches. Instead each query only
 * covers an _id window (a time slice, starting at 6 hours and widening while it finds
 * little), and a request stops after SCAN_BUDGET_MS even if the batch is not full. The
 * browser then asks again from where this one stopped (`next`), so MongoDB never runs one
 * long scan, and every query's in-memory sort is limited to one window.
 */
async function readBatch(collection, filter, project, before, size) {
  const range = filter._id || {};
  const { oldest, newest } = await edges(collection);
  const empty = { docs: [], hasMore: false, next: "", scan: null };
  if (!oldest) return empty;

  // Upper bound: the cursor, the end of the date range, or just past the newest row.
  let upper = idAt(msOf(newest) + 1000);
  if (range.$lt && range.$lt.toString() < upper.toString()) upper = range.$lt;
  if (isId(before) && before.toLowerCase() < upper.toString()) upper = ObjectId(before.toLowerCase());
  const lowerMs = Math.max(msOf(oldest), range.$gte ? msOf(range.$gte) : 0);
  const top = range.$lt ? Math.min(msOf(range.$lt), msOf(newest) + 1000) : msOf(newest) + 1000;
  const scan = (atMs) => ({ from: lowerMs, to: top, at: Math.max(lowerMs, atMs) });
  if (msOf(upper) < lowerMs || (range.$gte && upper.toString() <= range.$gte.toString())) return empty;

  const started = Date.now();
  const docs = [];
  let windowMs = WINDOW_START_MS;
  let hi = upper;
  for (;;) {
    const hiMs = msOf(hi);
    const startMs = hiMs - windowMs;
    const last = startMs <= lowerMs;   // this window reaches the start of the range
    const idFilter = { $lt: hi };
    if (!last) idFilter.$gte = idAt(startMs);
    else if (range.$gte) idFilter.$gte = range.$gte;
    const want = size - docs.length + 1;   // one extra row tells whether there are more
    const got = await db().collection(collection).aggregate([
      { $match: Object.assign({}, filter, { _id: idFilter }) },
      { $sort: { _id: -1 } },
      { $limit: want },
      { $project: project }
    ], Object.assign({ maxTimeMS: WINDOW_TIMEOUT_MS, allowDiskUse: false }, READ)).toArray();
    docs.push(...got);

    if (docs.length > size) {
      docs.length = size;
      return { docs, hasMore: true, next: docs[size - 1]._id.toString(), scan: scan(msOf(docs[size - 1]._id)) };
    }
    if (last) return { docs, hasMore: false, next: "", scan: scan(lowerMs) };
    hi = idFilter.$gte;
    // Few matches in this window: look further back next time.
    if (got.length < want / 2) windowMs = Math.min(windowMs * 4, WINDOW_MAX_MS);
    if (Date.now() - started > SCAN_BUDGET_MS) {
      // Out of time for this request: return what was found and continue from here next time.
      return { docs, hasMore: true, next: hi.toString(), scan: scan(msOf(hi)), partial: true };
    }
  }
}

// Total rows in the collection from its metadata: free, so it is sent with every first batch.
async function estimated(collection) {
  const hit = edgeCache.get("~count:" + collection);
  if (hit && Date.now() - hit.at < EDGE_TTL_MS) return hit.n;
  try {
    const n = await db().collection(collection).estimatedDocumentCount(READ);
    edgeCache.set("~count:" + collection, { n, at: Date.now() });
    return n;
  } catch (err) {
    return null;
  }
}

// Exact count of matches: only when the user asks for it, as it can read the whole range.
async function countOf(collection, filter) {
  try {
    return await db().collection(collection).countDocuments(filter, Object.assign({ maxTimeMS: COUNT_TIMEOUT_MS }, READ));
  } catch (err) {
    return null;   // too slow to count on this collection
  }
}

function timeoutMessage(err) {
  return err && (err.code === 50 || /time limit|MaxTimeMSExpired/i.test(err.message || ""))
    ? "The query took too long. Narrow the date range or add a filter."
    : (err && err.message) || "Query failed";
}

// What a batch response carries besides its rows.
async function batchMeta(collection, batch, q, started) {
  const meta = { hasMore: batch.hasMore, next: batch.next, scan: batch.scan, ms: Date.now() - started };
  if (batch.partial) meta.partial = true;
  if (!q.before) meta.estimated = await estimated(collection);
  return meta;
}

// ---------------------------------------------------------------- Import log

function importFilter(q = {}) {
  const filter = { statusflag: "A" };
  const datasetcode = text(q.datasetcode), dataset = text(q.dataset), resulttype = text(q.resulttype);
  if (datasetcode) filter.datasetcode = datasetcode;
  if (dataset) filter.dataset = dataset;
  if (resulttype === "ERROR") filter.resulttype = "ERROR";
  else if (resulttype) filter.resulttype = { $ne: "ERROR" };
  const range = idRange(q.from, q.to);
  if (Object.keys(range).length) filter._id = range;
  return filter;
}

const IMPORT_FIELDS = { useruid: 1, auditdate: 1, dataset: 1, datasetcode: 1, datasetuid: 1, resulttype: 1, createdby: 1, createdat: 1, modifiedby: 1, modifiedat: 1, orguid: 1 };
const IMPORT_EXPORT_PROJECTION = Object.assign({ errorlog: 1 }, IMPORT_FIELDS);
const isText = { $eq: [{ $type: "$errorlog" }, "string"] };
const IMPORT_PROJECTION = Object.assign({
  errorlog: { $cond: [isText, { $substrCP: ["$errorlog", 0, ERRORLOG_MAX] }, "$errorlog"] },
  errorlogLength: { $cond: [isText, { $strLenCP: "$errorlog" }, 0] }
}, IMPORT_FIELDS);

async function importRows(docs, full = false) {
  const refIds = docs.filter((d) => d.dataset === "REFERENCEVALUE").map((d) => d.datasetuid);
  const [users, orgs, refs] = await Promise.all([
    usersOf(docs, ["useruid", "createdby", "modifiedby"]),
    byIds("organisations", docs.map((d) => d.orguid), { name: 1 }),
    byIds("referencevalues", refIds, { valuecode: 1 })
  ]);
  return docs.map((d) => {
    let errorlog = d.errorlog === undefined || d.errorlog === null ? "" : (typeof d.errorlog === "string" ? d.errorlog : JSON.stringify(d.errorlog));
    let truncated = (d.errorlogLength || 0) > ERRORLOG_MAX;
    if (!full && errorlog.length > ERRORLOG_MAX) { errorlog = errorlog.slice(0, ERRORLOG_MAX); truncated = true; }
    const row = {
      _id: d._id.toString(),
      username: nameOf(users, d.useruid),
      auditdate: dateText(d.auditdate),
      dataset: d.dataset || "",
      datasetcode: d.dataset === "REFERENCEVALUE" ? ((refs[idText(d.datasetuid)] || {}).valuecode || d.datasetcode || "") : (d.datasetcode || ""),
      resulttype: d.resulttype || "",
      errorlog,
      createdby: nameOf(users, d.createdby),
      createdat: dateText(d.createdat),
      modifiedby: nameOf(users, d.modifiedby),
      modifiedat: dateText(d.modifiedat),
      organisation: nameOf(orgs, d.orguid)
    };
    if (truncated) row.errorlogTruncated = true;
    return row;
  });
}

exports.importLogBatch = async function (q = {}) {
  const started = Date.now();
  const batch = await readBatch("importlogs", importFilter(q), IMPORT_PROJECTION, q.before, clampBatch(q.size));
  return Object.assign({ rows: await importRows(batch.docs) }, await batchMeta("importlogs", batch, q, started));
};

exports.importLogCount = async (q = {}) => ({ total: await countOf("importlogs", importFilter(q)) });

// Every matching row, batch by batch, for streaming exports.
exports.eachImportLogBatch = async function (q, onRows) {
  const filter = importFilter(q);
  let before = "", hasMore = true;
  while (hasMore) {
    const batch = await readBatch("importlogs", filter, IMPORT_EXPORT_PROJECTION, before, MAX_BATCH);
    if (batch.docs.length) await onRows(await importRows(batch.docs, true));
    hasMore = batch.hasMore;
    before = batch.next;
  }
};

exports.IMPORT_COLUMNS = [
  { key: "_id", label: "_id" }, { key: "username", label: "username" }, { key: "auditdate", label: "auditdate" },
  { key: "dataset", label: "dataset" }, { key: "datasetcode", label: "datasetcode" }, { key: "resulttype", label: "resulttype" },
  { key: "errorlog", label: "errorlog" }, { key: "createdby", label: "createdby" }, { key: "createdat", label: "createdat" },
  { key: "modifiedby", label: "modifiedby" }, { key: "modifiedat", label: "modifiedat" }, { key: "organisation", label: "organisation" }
];

// ---------------------------------------------------------------- Audit log

// The _ids of the `dataset` records with this code (any status, so deleted items still show).
async function datasetIds(dataset, code, orguid) {
  const collection = AUDIT_DATASETS[dataset];
  if (!collection) return [];
  const find = (filter) => db().collection(collection).find(filter, Object.assign({ projection: { _id: 1 } }, READ)).limit(1000).maxTimeMS(LOOKUP_TIMEOUT_MS).toArray();
  let docs = isId(idText(orguid)) ? await find({ code, orguid: ObjectId(idText(orguid)) }) : [];
  if (!docs.length) docs = await find({ code });
  return docs.map((d) => d._id);
}

async function auditFilter(q = {}, orguid) {
  const filter = { statusflag: "A" };
  const dataset = text(q.dataset), datasetcode = text(q.datasetcode);
  if (dataset) filter.dataset = dataset;
  if (datasetcode) {
    if (!dataset) throw Object.assign(new Error("Choose a dataset to filter by dataset code."), { status: 400 });
    const ids = await datasetIds(dataset, datasetcode, orguid);
    if (!ids.length) return null;   // no record has this code: nothing can match
    filter.datasetuid = ids.length === 1 ? ids[0] : { $in: ids };
  }
  const range = idRange(q.from, q.to);
  if (Object.keys(range).length) filter._id = range;
  return filter;
}

const AUDIT_PROJECTION = { auditdate: 1, dataset: 1, datasetuid: 1, url: 1, modifiedby: 1, useruid: 1 };

async function auditRows(docs) {
  const groups = {};
  docs.forEach((d) => {
    const collection = AUDIT_DATASETS[d.dataset];
    if (collection) (groups[collection] = groups[collection] || []).push(d.datasetuid);
  });
  const [users, ...found] = await Promise.all([
    usersOf(docs, ["modifiedby", "useruid"]),
    ...Object.keys(groups).map((c) => byIds(c, groups[c], { code: 1, name: 1 }))
  ]);
  const datasets = Object.assign({}, ...found);
  return docs.map((d) => {
    const ds = datasets[idText(d.datasetuid)] || {};
    return {
      _id: d._id.toString(),
      auditdate: dateText(d.auditdate),
      dataset: d.dataset || "",
      datasetcode: ds.code || "",
      datasetname: typeof ds.name === "string" ? ds.name : (ds.name ? JSON.stringify(ds.name) : ""),
      url: d.url || "",
      useruid: nameOf(users, d.modifiedby) || nameOf(users, d.useruid)
    };
  });
}

exports.auditLogBatch = async function (q = {}, orguid) {
  const started = Date.now();
  const filter = await auditFilter(q, orguid);
  if (!filter) return { rows: [], hasMore: false, next: "", scan: null, ms: Date.now() - started, note: "No " + q.dataset + " record has code " + text(q.datasetcode) + "." };
  const batch = await readBatch("auditlogs", filter, AUDIT_PROJECTION, q.before, clampBatch(q.size));
  return Object.assign({ rows: await auditRows(batch.docs) }, await batchMeta("auditlogs", batch, q, started));
};

exports.auditLogCount = async function (q = {}, orguid) {
  const filter = await auditFilter(q, orguid);
  return { total: filter ? await countOf("auditlogs", filter) : 0 };
};

exports.AUDIT_DATASETS = Object.keys(AUDIT_DATASETS);
exports.datasetCollection = (dataset) => AUDIT_DATASETS[dataset] || "";
exports.DEFAULT_BATCH = DEFAULT_BATCH;
exports.MAX_BATCH = MAX_BATCH;
exports.timeoutMessage = timeoutMessage;
