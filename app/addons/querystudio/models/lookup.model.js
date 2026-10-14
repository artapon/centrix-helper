const mongoose = require("mongoose");

// "View" on a Query Data result row: each ObjectId field of the row is looked up in the
// collection it points to (modifiedby -> users, entypeuid -> referencevalues, ...) and
// shown with that document's code / name / description / statusflag.
const MAX_REFS = 300;
const MAX_TIME_MS = 10000;
const OID_RE = /^[0-9a-f]{24}$/i;

const db = () => mongoose.connection.db;
const censor = require("./censor");

// Organisation names (and any censored field) are hidden while personal-data censoring is on.
const CENSORED_KINDS = { patients: "patient", organisations: "org", organizations: "org" };
function censorDoc(coll, doc, on) {
  return on && CENSORED_KINDS[coll] ? censor.maskDoc(doc, CENSORED_KINDS[coll]) : doc;
}

// Field (last path part, lower case) -> collections, from the $lookups this app already uses.
const KNOWN = {
  createdby: ["users"], modifiedby: ["users"], approvedby: ["users"], bookedby: ["users"], useruid: ["users"],
  careprovideruid: ["users"], userdepartmentuid: ["departments", "users"],
  patientuid: ["patients"], babypatientuid: ["patients"], primarypatientuid: ["patients"], secondarypatientuid: ["patients"],
  patientvisituid: ["patientvisits"], patientorderuid: ["patientorders", "patientpackages"], linkpatientorderuid: ["patientorders"],
  patientbilluid: ["patientbills"], admissionrequestuid: ["admissionrequests"],
  orguid: ["organisations"], departmentuid: ["departments"], parentdeptuid: ["departments"], owningdeptuid: ["departments"],
  orderdepartmentuid: ["departments"], ordertodepartmentuid: ["departments"], todeptuid: ["departments"],
  departmentcostcenteruid: ["departments"], orderfromdeptfirst: ["departments"],
  warduid: ["wards"], sourcewarduid: ["wards"], destwarduid: ["wards"], transferredwarduid: ["wards"],
  beduid: ["beds"], sourcebeduid: ["beds"], destbeduid: ["beds"], transferredbeduid: ["beds"],
  nursingstnuid: ["locations"],
  orderitemuid: ["orderitems", "ordersets", "tariffs"], ordercatuid: ["ordercategories"], ordersubcatuid: ["ordercategories"],
  billinggroupuid: ["billinggroups"], billingsubgroupuid: ["billinggroups"], tariffuid: ["tariffs"],
  itemmasteruid: ["itemmasters"], storeuid: ["inventorystores"], fromstoreuid: ["inventorystores"],
  tostoreuid: ["inventorystores"], invstoreuid: ["inventorystores"], stocktransferuid: ["stocktransfers"],
  payoruid: ["payors"], visitpayoruid: ["payors"], allocatedpayoruid: ["payors"], payoragreementuid: ["payoragreements"],
  tpauid: ["tpas"], vendoruid: ["vendors"], datasetuid: ["referencedomains", "referencevalues"],
  quantityuom: ["referencevalues"], adjusttype: ["referencevalues"]
};

// Name patterns for fields the map does not list.
const PATTERNS = [
  [/(by|byuser|useruid|byuseruid)$/, ["users"]],
  [/patientuid$/, ["patients"]],
  [/(dept|department)uid$/, ["departments"]],
  [/warduid$/, ["wards"]],
  [/beduid$/, ["beds"]],
  [/storeuid$/, ["inventorystores"]],
  [/payoruid$/, ["payors"]],
  [/(careprovider|doctor)uid$/, ["users", "careproviders"]]
];

// The fields shown for a looked-up document; nothing else (no passwords, no patient names) leaves the server.
const PROJECTION = {
  code: 1, name: 1, description: 1, statusflag: 1,
  valuecode: 1, valuedescription: 1, locallangdesc: 1, domaincode: 1,
  mrn: 1, visitid: 1, loginname: 1, printname: 1, itemname: 1
};

let collectionCache = { at: 0, db: "", names: null };
async function collectionNames() {
  const name = db().databaseName;
  if (collectionCache.names && collectionCache.db === name && Date.now() - collectionCache.at < 5 * 60000) return collectionCache.names;
  const infos = await db().listCollections({}, { nameOnly: true }).toArray();
  collectionCache = { at: Date.now(), db: name, names: new Set(infos.map((c) => c.name)) };
  return collectionCache.names;
}

// Collections to try for a field, best guess first; referencevalues and the row's own collection last.
function candidates(path, own, names) {
  const leaf = String(path).split(".").filter((p) => !/^\d+$/.test(p)).pop() || "";
  const key = leaf.toLowerCase();
  const out = [];
  const add = (list) => list.forEach((c) => { if (names.has(c) && !out.includes(c)) out.push(c); });
  if (key === "_id") {
    // A nested _id (referencevalues.0._id) is usually a record of the collection its parent field is named after.
    const parent = (String(path).split(".").filter((p) => !/^\d+$/.test(p)).slice(-2, -1)[0] || "").toLowerCase();
    if (parent) add([parent, parent + "s", parent + "es"]);
    if (own) add([own]);
    return out;
  }
  if (KNOWN[key]) add(KNOWN[key]);
  PATTERNS.forEach(([re, list]) => { if (re.test(key)) add(list); });
  const base = key.replace(/_?(uid|id)$/, "");
  if (base && base !== key) add([base + "s", base + "es", base]);
  add(["referencevalues"]);
  if (own) add([own]);
  return out;
}

function pick(doc) {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  return {
    code: s(doc.code || doc.valuecode || doc.mrn || doc.visitid || doc.loginname),
    name: s(doc.name || doc.valuedescription || doc.itemname || doc.printname),
    description: s(doc.description || doc.locallangdesc),
    statusflag: s(doc.statusflag),
    domaincode: s(doc.domaincode)
  };
}

/**
 * refs: [{ path, id }] from one result row. Returns the same list with
 * { collection, code, name, description, statusflag } for each id found, or notFound.
 */
exports.lookup = async function ({ collection, refs }) {
  const own = typeof collection === "string" ? collection : "";
  const list = (Array.isArray(refs) ? refs : [])
    .filter((r) => r && typeof r.path === "string" && typeof r.id === "string" && OID_RE.test(r.id))
    .slice(0, MAX_REFS)
    .map((r) => ({ path: r.path.slice(0, 300), id: r.id.toLowerCase() }));
  if (!list.length) return { refs: [] };
  const names = await collectionNames();
  const censorOn = await censor.isOn();

  // Each id is tried in its candidate collections in order; each round queries a collection once for all its ids.
  const queue = list.map((r) => ({ ref: r, tries: candidates(r.path, own, names), found: null }));
  for (let round = 0; queue.some((q) => !q.found && q.tries.length > round); round++) {
    const byColl = {};
    queue.forEach((q) => {
      if (q.found || q.tries.length <= round) return;
      (byColl[q.tries[round]] = byColl[q.tries[round]] || new Set()).add(q.ref.id);
    });
    await Promise.all(Object.keys(byColl).map(async (coll) => {
      const ids = Array.from(byColl[coll]).map((id) => new mongoose.Types.ObjectId(id));
      const docs = await db().collection(coll)
        .find({ _id: { $in: ids } }, { projection: PROJECTION, maxTimeMS: MAX_TIME_MS })
        .toArray().catch(() => []);
      const hit = {};
      docs.forEach((d) => { hit[String(d._id)] = d; });
      queue.forEach((q) => {
        if (!q.found && q.tries[round] === coll && hit[q.ref.id]) q.found = Object.assign({ collection: coll }, pick(censorDoc(coll, hit[q.ref.id], censorOn)));
      });
    }));
  }
  return {
    refs: queue.map((q) => Object.assign({ path: q.ref.path, id: q.ref.id }, q.found || { notFound: true, tried: q.tries }))
  };
};

exports.MAX_REFS = MAX_REFS;
exports._candidates = candidates;
