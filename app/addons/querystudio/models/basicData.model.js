const mongoose = require("mongoose");
const moment = require("moment-timezone");
const organisationsModel = require("../../../core/models/organisations.model");
const patientvisitsModel = require("../../../modules/patients/models/patientvisits.model");
const validateModel = require("../../../modules/validate/models/validate.model");
const censor = require("./censor");

// "Basic data" popup on Query Data: the ids and date literals people paste into
// MongoDB / Jasper queries (organisation, current dates, encounter types, a visit).
const TZ = "Asia/Bangkok";

function firstRow(rows) {
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// A failing section reports its error instead of failing the whole popup.
async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function organisation(sitecode) {
  return safe(async () => {
    const org = firstRow(await organisationsModel.getOrgData(sitecode));
    if (!org) return { error: "No active organisation found" };
    const address = org.address || {};
    // Organisation name and address are personal-data fields while censoring is on.
    const hide = await censor.isOn();
    const shown = (v) => (hide && v ? censor.MASK : v || "");
    return {
      _id: String(org._id), code: org.code || "", name: shown(org.name), companyname: org.companyname || "",
      description: org.description || "", gstregno: org.gstregno || "",
      address: shown(address.address), addresseng: shown(address.addresseng), censored: hide
    };
  });
}

// Now, and the start of today in Bangkok time, as both ISO and mongo-shell UTC text.
function dates() {
  const now = moment();
  const midnight = moment.tz(TZ).startOf("day");
  const iso = (m) => m.toDate().toISOString();
  return {
    iso: iso(now), utc: iso(now).replace("T", " "), local: now.tz(TZ).format("YYYY-MM-DD HH:mm:ss"),
    midnightIso: iso(midnight), midnightUtc: iso(midnight).replace("T", " "), midnightLocal: midnight.format("YYYY-MM-DD HH:mm:ss")
  };
}

function encounterTypes() {
  return safe(async () => {
    const rows = await validateModel.getReferenceValues("ENTYPE");
    if (!Array.isArray(rows)) throw rows instanceof Error ? rows : new Error("Could not read encounter types");
    return rows.map((r) => ({
      uid: String(r.uid || r._id || ""), code: r.code || "", description: r.valuedescription || "",
      local: r.locallanguagedesc || "", related: r.relatedvalue == null ? "" : String(r.relatedvalue)
    }));
  });
}

// The visit by visit code, or the most recent active visit when no code is given.
exports.visit = function (visitid) {
  return safe(async () => {
    const code = String(visitid || "").trim();
    const rows = code ? await patientvisitsModel.getVisitData(code) : await patientvisitsModel.getFirtVisitData();
    if (rows instanceof Error) throw rows;
    const v = firstRow(rows);
    if (!v) return { notFound: true, visitid: code };
    const patient = v.patient || v.patients || {};
    return { visitid: v.visitid || "", mrn: v.mrn || patient.mrn || "", _id: String(v._id), patientuid: v.patientuid ? String(v.patientuid) : "" };
  });
};

const VISIT_LIMIT = 200;

// A patient by HN (mrn) and their active visits, newest first.
exports.patientByHn = function (hn) {
  return safe(async () => {
    const mrn = String(hn || "").trim();
    if (!mrn) return { empty: true };
    const db = mongoose.connection.db;
    // Prefer the active record when merges left more than one patient with the same HN.
    const patients = await db.collection("patients")
      .find({ mrn: { $eq: mrn } }, { projection: { mrn: 1, statusflag: 1 }, maxTimeMS: 15000 })
      .limit(5).toArray();
    const p = patients.find((x) => x.statusflag === "A") || patients[0];
    if (!p) return { notFound: true, mrn };
    const match = { patientuid: p._id, statusflag: "A" };
    const [visits, total] = await Promise.all([
      db.collection("patientvisits").aggregate([
        { $match: match },
        { $sort: { startdate: -1 } },
        { $limit: VISIT_LIMIT },
        { $lookup: { from: "referencevalues", localField: "entypeuid", foreignField: "_id", as: "entype" } },
        { $lookup: { from: "referencevalues", localField: "visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $project: { visitid: 1, startdate: 1, enddate: 1,
            entype: { $arrayElemAt: ["$entype.valuedescription", 0] }, visitstatus: { $arrayElemAt: ["$visitstatus.valuedescription", 0] } } }
      ], { maxTimeMS: 15000 }).toArray(),
      db.collection("patientvisits").countDocuments(match, { maxTimeMS: 15000 })
    ]);
    const local = (d) => (d ? moment(d).tz(TZ).format("YYYY-MM-DD HH:mm") : "");
    return {
      mrn: p.mrn || mrn,
      _id: String(p._id),
      inactive: p.statusflag !== "A",
      duplicates: patients.length - 1,
      total,
      limit: VISIT_LIMIT,
      visits: visits.map((v) => ({
        _id: String(v._id), visitid: v.visitid || "", start: local(v.startdate), end: local(v.enddate),
        entype: v.entype || "", status: v.visitstatus || ""
      }))
    };
  });
};

exports.basic = async function (sitecode) {
  const [org, entypes, visit] = await Promise.all([organisation(sitecode), encounterTypes(), exports.visit("")]);
  return { org, dates: dates(), entypes, visit };
};
