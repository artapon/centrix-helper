const { run, get } = require("../../../core/config/sqlite");
const { QueryError } = require("./shellQuery");

// Censoring of personal data in Query Data. When the flag is on (the default), these fields
// come back as "***" in results, exports, lookups and Basic Data, for every user:
//   patients:      firstname, middlename, lastname, nationalid (also the English alias names),
//                  any address field (whole object) and any phone field (contact.mobilephone ...)
//   organisations: name and any address field
// It applies to documents of those collections and to their documents joined in with $lookup.
// Only administrators can switch it off (setOn); the page records who did.

const FLAG_KEY = "querydata.censor";
const MASK = "***";
const CACHE_MS = 10000;

let cache = { at: 0, on: true };

/** Whether censoring is on (on unless an administrator switched it off). */
async function isOn() {
  if (Date.now() - cache.at < CACHE_MS) return cache.on;
  let on = true;
  try {
    const row = await get("SELECT value FROM app_meta WHERE key = ?", [FLAG_KEY]);
    on = !row || row.value !== "0";
  } catch (err) {
    on = true;   // cannot read the setting: stay safe
  }
  cache = { at: Date.now(), on };
  return on;
}

async function setOn(on) {
  await run("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [FLAG_KEY, on ? "1" : "0"]);
  cache = { at: Date.now(), on: !!on };
  return cache.on;
}

// ---- which fields ----
const PATIENT_NAMES = new Set(["firstname", "middlename", "lastname", "nationalid"]);
const isAddress = (k) => /address/i.test(k);
const isPhone = (k) => /phone/i.test(k);
const KIND = { patients: "patient", organisations: "org", organizations: "org" };

// Is this key censored for this kind of document? depth 1 = a top-level field.
function censoredKey(kind, key, depth) {
  if (kind === "patient") return PATIENT_NAMES.has(key) || isAddress(key) || isPhone(key);
  if (kind === "org") return (depth === 1 && key === "name") || isAddress(key);
  return false;
}

// "***" for every value in a censored field; ObjectIds stay (they are references, not personal data).
function maskValue(v) {
  if (v === null || v === undefined || v === "") return v;
  if (Array.isArray(v)) return v.map(maskValue);
  if (v instanceof Date) return MASK;
  if (typeof v === "object") {
    if (v.$oid !== undefined || /^ObjectI[dD]$/.test(v._bsontype || "")) return v;
    if (v._bsontype) return MASK;   // raw driver values (Decimal128, Long, ...)
    const keys = Object.keys(v);
    if (keys.length && keys.every((k) => k.charAt(0) === "$")) return MASK;   // tagged scalar: $date, $numberLong, ...
    const out = {};
    keys.forEach((k) => { out[k] = maskValue(v[k]); });
    return out;
  }
  return MASK;
}

// Censors the fields of one kind in a (tagged) document, at any depth.
function maskDoc(v, kind, depth = 1) {
  if (Array.isArray(v)) return v.map((x) => maskDoc(x, kind, depth));
  if (!v || typeof v !== "object" || v.$oid !== undefined || v.$date !== undefined || v._bsontype || v instanceof Date) return v;
  const out = {};
  Object.keys(v).forEach((k) => {
    out[k] = censoredKey(kind, k, depth) ? maskValue(v[k]) : maskDoc(v[k], kind, depth + 1);
  });
  return out;
}

// Censors the subtree at a dotted path (the output of a $lookup) as documents of one kind.
function maskAt(doc, parts, kind) {
  if (Array.isArray(doc)) return doc.map((x) => maskAt(x, parts, kind));
  if (!doc || typeof doc !== "object" || !parts.length || !(parts[0] in doc)) return doc;
  const out = Object.assign({}, doc);
  out[parts[0]] = parts.length === 1 ? maskDoc(doc[parts[0]], kind) : maskAt(doc[parts[0]], parts.slice(1), kind);
  return out;
}

/**
 * Where personal documents appear in a parsed query's output:
 * [{ prefix: "" | "patient.", kind }] — the queried collection and every $lookup from a censored one.
 */
function sourcesOf(q) {
  const out = [];
  if (KIND[q.collection]) out.push({ prefix: "", path: [], kind: KIND[q.collection] });
  (q.pipeline || []).forEach((st) => {
    const lk = st && (st.$lookup || st.$graphLookup);
    if (lk && KIND[lk.from] && typeof lk.as === "string") out.push({ prefix: lk.as + ".", path: lk.as.split("."), kind: KIND[lk.from] });
    // $unionWith adds whole documents of another collection to the output
    const uw = st && st.$unionWith;
    const coll = typeof uw === "string" ? uw : uw && uw.coll;
    if (KIND[coll] && !out.some((s) => !s.prefix && s.kind === KIND[coll])) out.push({ prefix: "", path: [], kind: KIND[coll] });
  });
  return out;
}

// ---- refusing pipelines that copy censored fields under another name ----
const SAFE_STAGES = new Set(["$match", "$sort", "$limit", "$skip", "$count", "$sample"]);

function refsIn(v, out) {
  if (typeof v === "string") {
    if (v.charAt(0) === "$" && v.charAt(1) !== "$") out.push(v.slice(1));
    else {
      // $$ROOT.firstname reads a field like $firstname; $$ROOT alone keeps the keys, so it stays censored
      const m = /^\$\$(?:ROOT|CURRENT)\.(.+)$/.exec(v);
      if (m) out.push(m[1]);
    }
    return out;
  }
  if (Array.isArray(v)) { v.forEach((x) => refsIn(x, out)); return out; }
  if (v && typeof v === "object" && !v._bsontype && !(v instanceof Date) && !(v instanceof RegExp)) {
    Object.keys(v).forEach((k) => { if (k === "$objectToArray" || k === "$function" || k === "$accumulator") out.push("!" + k); refsIn(v[k], out); });
  }
  return out;
}

// Would this field reference read a censored field of one of the sources?
function refHits(ref, sources) {
  const parts = ref.split(".");
  return sources.some((s) => {
    let rest;
    if (s.prefix) { if (!(ref + ".").startsWith(s.prefix)) return false; rest = parts.slice(s.path.length); }
    else rest = parts;
    return rest.some((k, i) => censoredKey(s.kind, k, i + 1));
  });
}

function refuse(stage, what, sources) {
  const names = sources.map((s) => (s.kind === "patient" ? "patients" : "organisations")).filter((v, i, a) => a.indexOf(v) === i).join(" / ");
  throw new QueryError("Personal data is censored: " + stage + " cannot use " + what + " of " + names +
    ". Show the field under its own name, or ask an administrator to switch censoring off.", null);
}

// Checks the stages of one pipeline, whose input documents are described by `sources`.
function checkStages(stages, sources, depth) {
  if (depth > 6) return;
  stages.forEach((st) => {
    const name = Object.keys(st || {})[0];
    if (!name || SAFE_STAGES.has(name)) return;
    const body = st[name];
    let scan = body;
    if (name === "$lookup" || name === "$graphLookup" || name === "$unionWith") {
      const from = name === "$unionWith" ? (typeof body === "string" ? body : body && body.coll) : body && body.from;
      const sub = body && Array.isArray(body.pipeline) ? body.pipeline : [];
      // A sub-pipeline runs on the joined collection: it must not rename that collection's censored fields either.
      if (KIND[from] && sub.length) checkStages(sub, [{ prefix: "", path: [], kind: KIND[from] }], depth + 1);
      else if (sub.length) checkStages(sub, [], depth + 1);
      // let reads fields of the current documents; localField / foreignField / connect* only join
      scan = { let: body && body.let, startWith: name === "$graphLookup" ? body.startWith : undefined };
    } else if (name === "$facet") {
      Object.keys(body || {}).forEach((k) => checkStages(Array.isArray(body[k]) ? body[k] : [], sources, depth + 1));
      return;
    }
    if (!sources.length) return;
    const refs = refsIn(scan, []);
    const blocked = refs.find((r) => r.charAt(0) === "!") || refs.find((r) => refHits(r, sources));
    if (blocked) refuse(name, blocked.charAt(0) === "!" ? blocked.slice(1) : "$" + blocked, sources);
  });
}

/** Throws when the query would copy a censored field somewhere the masking cannot see it. */
function checkQuery(q) {
  const sources = sourcesOf(q);
  const stages = [];
  if (q.method === "find" && q.projection) stages.push({ $project: q.projection });
  (q.pipeline || []).forEach((st) => stages.push(st));
  // Sources available to a stage are the queried collection plus lookups made before it; checking
  // every stage against all of them is stricter, and simpler.
  checkStages(stages, sources, 0);
  if (q.method === "distinct" && refHits(q.field, sources.filter((s) => !s.prefix))) q.censorDistinct = true;
}

/** Censors a page of tagged result documents for a parsed query. */
function maskResult(q, docs) {
  if (q.censorDistinct) return docs.map(maskValue);
  const sources = sourcesOf(q);
  if (!sources.length) return docs;
  return docs.map((d) => sources.reduce((doc, s) => (s.prefix ? maskAt(doc, s.path, s.kind) : maskDoc(doc, s.kind)), d));
}

/** Whether the query reads a collection that is censored. */
const touches = (q) => sourcesOf(q).length > 0;

module.exports = { isOn, setOn, checkQuery, maskResult, maskDoc, maskValue, touches, MASK, FLAG_KEY };
