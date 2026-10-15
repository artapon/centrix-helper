// Query Data → Jaspersoft MongoDB query language (the MongoDbQuery a JRXML <queryString> holds).
// https://community.jaspersoft.com/knowledgebase/faq/jaspersoft-mongodb-query-language
//
//   find      → { "collectionName": …, "findQuery": {…}, "findFields": {…}, "sort": {…}, "limit": n }
//   aggregate → { "runCommand": { "aggregate": …, "pipeline": [ … ] } }
//   count     → aggregate with $match + $count: "count"
//   distinct  → aggregate with $match + $group, one row per value ("value")
//
// Values are written as extended JSON ({"$oid": …}, {"$date": …}, {"$regex": …}), which the
// Jaspersoft MongoDB connector reads. With useParams, ObjectIds of the visit, patient and
// organisation become $P{…} report parameters (their values become the parameters' defaults).
const { parse } = require("../../../app/core/helpers/shellquery.helper");

// Field name (last path segment) → report parameter for its ObjectId.
const PARAM_FOR = { orguid: "organisationuid", organisationuid: "organisationuid", patientvisituid: "patientvisituid", patientuid: "patientuid" };
// _id of these collections is that parameter.
const ID_PARAM = { patientvisits: "patientvisituid", patients: "patientuid", organisations: "organisationuid" };

const isOid = (v) => v && (v._bsontype === "ObjectID" || v._bsontype === "ObjectId");

function convert(text, { useParams } = {}) {
  const q = parse(text);
  const notes = [];
  const params = new Map();     // name -> default ObjectId hex

  // Pretty JSON with extended-JSON values; ObjectIds can become $P{} parameters.
  const ind = (n) => "  ".repeat(n);
  function value(v, depth, key, path) {
    if (v === null || v === undefined) return "null";
    if (isOid(v)) {
      const hex = v.toHexString();
      const last = String(key || "");
      // _id of the queried collection: in find()'s filter or in a pipeline stage's $match.
      const ownId = last === "_id" && (path === "findQuery._id" || path === "runCommand.pipeline.$match._id");
      const name = useParams && (PARAM_FOR[last] || (ownId && ID_PARAM[q.collection]));
      if (name) {
        if (!params.has(name)) params.set(name, hex);
        if (params.get(name) === hex) return '{ "$oid": $P{' + name + "} }";
      }
      return '{ "$oid": "' + hex + '" }';
    }
    if (v instanceof Date) return '{ "$date": "' + (isNaN(v.getTime()) ? "" : v.toISOString()) + '" }';
    if (v instanceof RegExp) return '{ "$regex": ' + JSON.stringify(v.source) + (v.flags ? ', "$options": ' + JSON.stringify(v.flags) : "") + " }";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    switch (v._bsontype) {
      case "Long": return '{ "$numberLong": "' + v.toString() + '" }';
      case "Decimal128": return '{ "$numberDecimal": "' + v.toString() + '" }';
      case "Int32": case "Double": return String(v.valueOf());
      case "Timestamp": return '{ "$timestamp": { "t": ' + v.getHighBits() + ', "i": ' + v.getLowBits() + " } }";
      case "BSONRegExp": return '{ "$regex": ' + JSON.stringify(v.pattern) + ', "$options": ' + JSON.stringify(v.options) + " }";
      default: break;
    }
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return "[\n" + v.map((x) => ind(depth + 1) + value(x, depth + 1, key, path)).join(",\n") + "\n" + ind(depth) + "]";
    }
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return "{\n" + keys.map((k) => ind(depth + 1) + JSON.stringify(k) + ": " + value(v[k], depth + 1, k.split(".").pop(), path ? path + "." + k : k)).join(",\n") + "\n" + ind(depth) + "}";
  }

  let body;
  const coll = q.collection;
  if (q.method === "find") {
    const parts = [["collectionName", coll], ["findQuery", q.filter || {}]];
    if (q.projection) parts.push(["findFields", q.projection]);
    if (q.sort) parts.push(["sort", q.sort]);
    if (q.limit) parts.push(["limit", q.limit]);
    if (q.skip) notes.push("skip(" + q.skip + ") has no equivalent in the Jaspersoft MongoDB query language and was left out.");
    if (q.hint) notes.push("hint() was left out.");
    body = parts;
  } else {
    let pipeline;
    if (q.method === "aggregate") pipeline = q.pipeline;
    else if (q.method === "count" || q.method === "estimatedCount") {
      pipeline = (q.method === "count" && Object.keys(q.filter || {}).length ? [{ $match: q.filter }] : []).concat([{ $count: "count" }]);
      notes.push("count() becomes a pipeline returning one row with the field \"count\".");
    } else if (q.method === "distinct") {
      pipeline = (Object.keys(q.filter || {}).length ? [{ $match: q.filter }] : [])
        .concat([{ $group: { _id: "$" + q.field } }, { $project: { _id: 0, value: "$_id" } }, { $sort: { value: 1 } }]);
      notes.push("distinct() becomes a pipeline returning one row per value, in the field \"value\".");
    } else {
      throw Object.assign(new Error("This query can't be converted."), { status: 400 });
    }
    body = [["runCommand", { aggregate: coll, pipeline }]];
  }
  const jasper = "{\n" + body.map(([k, v]) => ind(1) + JSON.stringify(k) + ": " + value(v, 1, k, k)).join(",\n") + "\n}";
  // Fields a report needs: for find with a projection, its paths (nested names are read with dots).
  if (useParams && params.size) notes.push("Add the parameter" + (params.size > 1 ? "s" : "") + " below to the report (class java.lang.String), or run it from Centrix, which passes them.");
  return {
    jasper,
    method: q.method,
    collection: coll,
    params: [...params.entries()].map(([name, def]) => ({ name, cls: "java.lang.String", def: '"' + def + '"' })),
    notes
  };
}

// ───────────────────── Jaspersoft MongoDB query → Query Data (mongo shell) ─────────────────────
//
//   { runCommand: { aggregate: "x", pipeline: [ … ] } }              → db.x.aggregate([ … ])
//   { collectionName: "x", findQuery, findFields, sort, limit }       → db.x.find({…}).projection({…}).sort({…}).limit(n)
//
// Only the Jaspersoft MongoDB query format is accepted; $P{…} take the values given. Nothing is run.
const { ObjectId, Long, Decimal128 } = require("mongoose").mongo;

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !v._bsontype && !(v instanceof Date) && !(v instanceof RegExp);

function fromEjson(v) {
  if (Array.isArray(v)) return v.map(fromEjson);
  if (!isPlain(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1 || (keys.length === 2 && keys.includes("$regex") && keys.includes("$options"))) {
    const k = keys[0], x = v[k];
    if (k === "$oid" && typeof x === "string" && /^[0-9a-f]{24}$/i.test(x)) return new ObjectId(x);
    if (k === "$date") {
      const t = x && typeof x === "object" && x.$numberLong ? Number(x.$numberLong) : x;
      const d = new Date(t);
      if (!isNaN(d)) return d;
    }
    if (k === "$numberLong" && /^-?\d+$/.test(String(x))) return Long.fromString(String(x));
    if (k === "$numberDecimal") return Decimal128.fromString(String(x));
    // {"$regex": …, "$options": …} on its own matches like a /regex/ literal, which reads better.
    if (k === "$regex" || k === "$options") {
      try { return new RegExp(String(v.$regex), String(v.$options || "")); } catch (e) { /* keep the operator */ }
    }
  }
  const out = {};
  keys.forEach((k) => { out[k] = fromEjson(v[k]); });
  return out;
}

// Query Data (mongo shell) text: unquoted keys where possible, short objects on one line.
function shellText(v, ind = "") {
  const WIDTH = 100;
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const flat = (x) => {
    if (x === null || x === undefined) return "null";
    if (x instanceof Date) return 'ISODate("' + (isNaN(x.getTime()) ? "" : x.toISOString()) + '")';
    if (x instanceof RegExp) return "/" + x.source + "/" + x.flags;   // source already escapes "/"
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    switch (x._bsontype) {
      case "ObjectID": case "ObjectId": return 'ObjectId("' + x.toHexString() + '")';
      case "Long": return 'NumberLong("' + x.toString() + '")';
      case "Decimal128": return 'NumberDecimal("' + x.toString() + '")';
      case "Int32": case "Double": return String(x.valueOf());
      case "Timestamp": return "Timestamp(" + x.getHighBits() + ", " + x.getLowBits() + ")";
      default: break;
    }
    if (Array.isArray(x)) return "[" + x.map(flat).join(", ") + "]";
    const ks = Object.keys(x);
    return ks.length ? "{ " + ks.map((k) => key(k) + ": " + flat(x[k])).join(", ") + " }" : "{}";
  };
  const pretty = (x, pad, prefix) => {
    const f = flat(x);
    if (pad.length + prefix + f.length <= WIDTH || !(Array.isArray(x) || isPlain(x))) return f;
    const inner = pad + "  ";
    if (Array.isArray(x)) return "[\n" + x.map((y) => inner + pretty(y, inner, 0)).join(",\n") + "\n" + pad + "]";
    return "{\n" + Object.keys(x).map((k) => inner + key(k) + ": " + pretty(x[k], inner, key(k).length + 2)).join(",\n") + "\n" + pad + "}";
  };
  return pretty(v, ind, 0);
}

function fromJasper(text, { values } = {}) {
  const src = String(text || "").trim();
  if (!src) throw Object.assign(new Error("Paste a Jasper MongoDB query first."), { status: 400 });
  if (!src.startsWith("{")) {
    throw Object.assign(new Error('Paste only the Jasper MongoDB query: { runCommand: { aggregate: …, pipeline: [ … ] } } or { collectionName: …, findQuery: { … } }.'), { status: 400 });
  }
  const given = values && typeof values === "object" ? values : {};
  const params = [], missing = [];
  // $P{name} / $P!{name} → the value as a JSON literal (or a "$P{name}" string when there is none).
  const text2 = src.replace(/\$P!?\{([^}]+)\}/g, (all, name) => {
    let v, from;
    if (Object.prototype.hasOwnProperty.call(given, name) && given[name] !== "") { v = given[name]; from = "given"; }
    else { v = all; from = "missing"; }
    if (!params.some((p) => p.name === name)) params.push({ name, value: from === "missing" ? "" : v, from });
    if (from === "missing" && !missing.includes(name)) missing.push(name);
    return JSON.stringify(v);
  });
  let obj;
  try {
    obj = parse("db._jasper.find(" + text2 + ")").filter;
  } catch (err) {
    throw Object.assign(new Error("The Jasper query could not be read: " + err.message), { status: 400 });
  }
  obj = fromEjson(obj);
  const coll = (name) => (/^[A-Za-z_][\w]*$/.test(name) ? "db." + name : "db.getCollection(" + JSON.stringify(name) + ")");
  const notes = [];
  let shell, collection, method;
  if (obj.runCommand) {
    const rc = obj.runCommand;
    if (!rc.aggregate || !Array.isArray(rc.pipeline)) throw Object.assign(new Error("Only runCommand with aggregate and a pipeline can be converted."), { status: 400 });
    collection = String(rc.aggregate); method = "aggregate";
    shell = coll(collection) + ".aggregate(" + shellText(rc.pipeline) + ")";
    Object.keys(rc).filter((k) => !["aggregate", "pipeline", "cursor", "allowDiskUse"].includes(k)).forEach((k) => notes.push(`runCommand option "${k}" was left out.`));
  } else if (obj.collectionName) {
    collection = String(obj.collectionName); method = "find";
    shell = coll(collection) + ".find(" + shellText(obj.findQuery || {}) + ")";
    if (obj.findFields && Object.keys(obj.findFields).length) shell += "\n  .projection(" + shellText(obj.findFields, "  ") + ")";
    if (obj.sort && Object.keys(obj.sort).length) shell += "\n  .sort(" + shellText(obj.sort, "  ") + ")";
    const limit = obj.limit || obj.rowsToProcess;
    if (limit) shell += "\n  .limit(" + parseInt(limit, 10) + ")";
    if (obj.mapReduce) notes.push("mapReduce is not supported in Query Data and was left out.");
    if (obj.batchSize) notes.push("batchSize was left out.");
  } else {
    throw Object.assign(new Error('The query must be { runCommand: { aggregate: …, pipeline: [ … ] } } or { collectionName: …, findQuery: { … } }.'), { status: 400 });
  }
  if (missing.length) notes.unshift("No value for " + missing.map((n) => "$P{" + n + "}").join(", ") + ": the query keeps the placeholder text. Enter a value to run it.");
  // Make sure Query Data can read the result.
  try { parse(shell); } catch (err) { notes.push("Check the result before running it: " + err.message); }
  return { shell, collection, method, params, missing, notes };
}

// ───────────────────── Jaspersoft MongoDB query → query template (Query Template page) ─────────────────────
//
// Like fromJasper, but each $P{name} stays a parameter: { "$oid": $P{x} } → {{x}} (an ObjectId parameter),
// { "$date": $P{d} } → {{d}} (a date), any other $P{x} → {{x}} (text). The report parameters the app's own
// "To Jasper" writes are mapped to what a template has for them: $P{organisationuid} → {{orguid}} (the
// signed-in site), $P{patientuid} → an HN parameter, $P{patientvisituid} → a VN parameter.
const TEMPLATE_PARAM = {
  organisationuid: { builtin: "orguid" }, orguid: { builtin: "orguid" },
  patientuid: { name: "hn", label: "HN", type: "hn", help: "Patient HN (mrn)" },
  patientvisituid: { name: "vn", label: "VN", type: "vn", help: "Visit number (visitid)" }
};

function toTemplate(text) {
  const src = String(text || "").trim();
  // Every $P{x} / $P!{x} (quoted or not) becomes a marker string that survives the conversion.
  const names = [];
  const marked = src.replace(/"?\$P!?\{([^}]+)\}"?/g, (all, name) => {
    const n = String(name).trim();
    if (!names.includes(n)) names.push(n);
    return JSON.stringify("__QTP" + names.indexOf(n) + "__");
  });
  const r = fromJasper(marked, {});
  const used = new Set();
  const params = [];
  const notes = r.notes.slice();
  const safeName = (n) => {
    let s = n.replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[A-Za-z]/.test(s)) s = "p_" + s;
    s = s.slice(0, 40);
    let out = s, i = 2;
    while (used.has(out.toLowerCase()) || ["orguid", "today", "now"].includes(out)) out = s.slice(0, 37) + "_" + i++;
    used.add(out.toLowerCase());
    return out;
  };
  const byIndex = {};   // marker index → placeholder name
  function paramFor(i, type) {
    if (byIndex[i]) return byIndex[i];
    const jasper = names[i];
    const known = TEMPLATE_PARAM[jasper];
    if (known && known.builtin) {
      notes.push(`$P{${jasper}} is the signed-in site's organisation: {{orguid}}.`);
      return (byIndex[i] = known.builtin);
    }
    if (known && type === "objectid") {
      const name = safeName(known.name);
      params.push({ name, label: known.label, type: known.type, required: true, default: "", help: known.help });
      notes.push(`$P{${jasper}} became ${known.label} ({{${name}}}): typed as ${known.label} and looked up when it runs.`);
      return (byIndex[i] = name);
    }
    const name = safeName(jasper);
    params.push({ name, label: jasper, type, required: true, default: "", help: "" });
    return (byIndex[i] = name);
  }
  // Markers inside {$oid} / {$date} are typed; the rest are text.
  let query = r.shell
    .replace(/\{ \$oid: "__QTP(\d+)__" \}/g, (all, i) => "{{" + paramFor(Number(i), "objectid") + "}}")
    .replace(/\{ \$date: "__QTP(\d+)__" \}/g, (all, i) => "{{" + paramFor(Number(i), "date") + "}}")
    .replace(/"__QTP(\d+)__"/g, (all, i) => "{{" + paramFor(Number(i), "text") + "}}");
  if (/__QTP\d+__/.test(query)) notes.push("Some $P{…} could not be placed as a value (e.g. inside a regex); check the query.");
  const dropped = notes.findIndex((n) => /^No value for /.test(n));
  if (dropped >= 0) notes.splice(dropped, 1);   // fromJasper's "no value" note: here they are parameters
  const checkNote = notes.findIndex((n) => /^Check the result/.test(n));
  if (checkNote >= 0) notes.splice(checkNote, 1);   // the markers made it look invalid; Save checks the template
  return { query, collection: r.collection, method: r.method, params, notes };
}

module.exports = { convert, fromJasper, toTemplate };
