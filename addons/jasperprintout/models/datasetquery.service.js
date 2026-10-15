// Jasper Designer → Dataset and Query: runs a report's MongoDbQuery on the connected site,
// read-only and limited, to read its fields (name + Java class, as Jaspersoft Studio's
// MongoDB adapter names them: nested documents as dotted paths) and to preview a few rows.
//
//   { runCommand: { aggregate: 'patientvisits', pipeline: [ ... ] } }
//   { collectionName: 'patients', findQuery: { ... }, findFields: { ... }, sort: { ... } }
//
// Or (language json) calls a web service and reads the records from its JSON answer: datasetwebservice.service.js.
//
// $P{name} is replaced by the parameter's value (or its default expression when it is a plain
// literal). The text is parsed by the app's safe query parser (core/helpers/shellquery.helper), which refuses $out, $merge,
// $where, $function and $accumulator.
const mongoose = require('mongoose');
const webService = require('./datasetwebservice.service');
const shellQuery = require('../../../app/core/helpers/shellquery.helper');
const censor = require('../../../app/core/helpers/censor.helper');

const { ObjectId, Long, Decimal128 } = mongoose.mongo;
const MAX_TIME_MS = 30000;
const PERSONAL = /^(firstname|middlename|lastname|nationalid|passportno|passportnumber|mobilephone|homephone|workphone|officephone|phone|telephone|tel|emailid|email|address|housenumber|village|street|soi|road|zipcode|patientname|aliasnames)$/i;

const bad = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

// A default value expression Jasper would evaluate; only plain literals are used here.
function literal(expr) {
  const s = String(expr || '').trim();
  if (!s || s === 'null') return null;
  let m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (m) return m[1].replace(/\\(.)/g, '$1');
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^-?\d+(\.\d+)?[LlDdFf]?$/.test(s)) return Number(s.replace(/[LlDdFf]$/, ''));
  m = /^new\s+java\.util\.Date\(\s*\)$/.exec(s);
  if (m) return new Date().toISOString();
  return undefined;
}

// The value for $P{name}: the one typed for Read Fields / preview, else its literal default; undefined when neither.
function paramValue(name, params, values) {
  const v = values && Object.prototype.hasOwnProperty.call(values, name) && values[name] !== '' ? values[name] : undefined;
  if (v !== undefined) return v;
  const p = params.find((x) => x.name === name);
  return p ? literal(p.def) : undefined;
}

function substitute(text, params, values) {
  const missing = [];
  const out = String(text).replace(/\$P!?\{([^}]+)\}/g, (all, name) => {
    let v = paramValue(name, params, values);
    if (v === undefined) { missing.push(name); v = null; }
    return JSON.stringify(v);
  });
  return { text: out, missing: [...new Set(missing)] };
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !v._bsontype && !(v instanceof Date) && !(v instanceof RegExp);

// Extended JSON wrappers in report queries ({"$oid": …}, {"$date": …}) → BSON values.
function fromEjson(v) {
  if (Array.isArray(v)) return v.map(fromEjson);
  if (!isPlain(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1) {
    const k = keys[0], x = v[k];
    if (k === '$oid' && typeof x === 'string' && /^[0-9a-f]{24}$/i.test(x)) return new ObjectId(x);
    if (k === '$date') {
      const t = typeof x === 'object' && x && x.$numberLong ? Number(x.$numberLong) : x;
      const date = new Date(t);
      if (!isNaN(date)) return date;
    }
    if (k === '$numberLong' && /^-?\d+$/.test(String(x))) return Long.fromString(String(x));
    if (k === '$numberDecimal') return Decimal128.fromString(String(x));
  }
  const out = {};
  keys.forEach((k) => { out[k] = fromEjson(v[k]); });
  return out;
}

function parseSpec(text) {
  const { parse } = shellQuery;
  let obj;
  try {
    // The parser reads mongo-shell syntax; a report query is one object, read as a find() filter.
    obj = parse('db._jasper.find(' + text + ')').filter;
  } catch (err) {
    throw bad('The query could not be read: ' + err.message + (err.line ? ` (line ${err.line})` : ''));
  }
  obj = fromEjson(obj);
  if (obj.runCommand) {
    const rc = obj.runCommand;
    if (!rc.aggregate || !Array.isArray(rc.pipeline)) throw bad('Only runCommand with aggregate and a pipeline is supported here.');
    return { kind: 'aggregate', collection: String(rc.aggregate), pipeline: rc.pipeline };
  }
  if (obj.collectionName) {
    return { kind: 'find', collection: String(obj.collectionName), filter: obj.findQuery || {}, projection: obj.findFields || null, sort: obj.sort || null };
  }
  throw bad('The query must be { runCommand: { aggregate: …, pipeline: [ … ] } } or { collectionName: …, findQuery: { … } }.');
}

async function runSpec(spec, limit) {
  const db = mongoose.connection.db;
  const opts = { maxTimeMS: MAX_TIME_MS, promoteValues: false, promoteLongs: false };
  if (spec.kind === 'aggregate') {
    return db.collection(spec.collection).aggregate(spec.pipeline.concat([{ $limit: limit }]), Object.assign({ allowDiskUse: true }, opts)).toArray();
  }
  let cursor = db.collection(spec.collection).find(spec.filter, Object.assign({ projection: spec.projection || undefined }, opts));
  if (spec.sort) cursor = cursor.sort(spec.sort);
  return cursor.limit(limit).toArray();
}

// How many records the whole query gives, for the dialog's "too many pages for JasperServer" warning:
// { total, more } — more: at least COUNT_CAP, or still counting after COUNT_TIME_MS (total is then null).
const COUNT_CAP = 100000;
const COUNT_TIME_MS = 15000;
async function countSpec(spec) {
  const coll = mongoose.connection.db.collection(spec.collection);
  try {
    let n;
    if (spec.kind === 'aggregate') {
      const r = await coll.aggregate(spec.pipeline.concat([{ $limit: COUNT_CAP + 1 }, { $count: 'n' }]), { allowDiskUse: true, maxTimeMS: COUNT_TIME_MS }).toArray();
      n = r.length ? r[0].n : 0;
    } else {
      n = await coll.countDocuments(spec.filter, { limit: COUNT_CAP + 1, maxTimeMS: COUNT_TIME_MS });
    }
    return n > COUNT_CAP ? { total: COUNT_CAP, more: true } : { total: n, more: false };
  } catch (err) {
    return err.code === 50 || err.codeName === 'MaxTimeMSExpired' ? { total: null, more: true } : { total: null, more: false };
  }
}

function flatten(doc, prefix, out) {
  Object.keys(doc).forEach((k) => {
    const v = doc[k], path = prefix + k;
    if (isPlain(v) && Object.keys(v).length) flatten(v, path + '.', out);
    else out[path] = v;
  });
  return out;
}

function javaClass(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return 'java.util.List';
  if (v instanceof Date) return 'java.util.Date';
  if (v instanceof RegExp) return 'java.util.regex.Pattern';
  switch (v._bsontype) {
    case 'ObjectID': case 'ObjectId': return 'org.bson.types.ObjectId';
    case 'Int32': return 'java.lang.Integer';
    case 'Double': return 'java.lang.Double';
    case 'Long': return 'java.lang.Long';
    case 'Decimal128': return 'java.math.BigDecimal';
    case 'Timestamp': return 'org.bson.types.BSONTimestamp';
    case 'Binary': return 'org.bson.types.Binary';
    default: break;
  }
  if (typeof v === 'boolean') return 'java.lang.Boolean';
  if (typeof v === 'string') return 'java.lang.String';
  if (typeof v === 'number') return Number.isInteger(v) ? 'java.lang.Integer' : 'java.lang.Double';
  if (isPlain(v)) return 'java.util.Map';
  return 'java.lang.Object';
}

function display(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return '[' + v.length + ' item' + (v.length === 1 ? '' : 's') + ']';
  if (v instanceof Date) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(v).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  }
  if (v._bsontype) return typeof v.toHexString === 'function' ? v.toHexString() : String(typeof v.valueOf === 'function' && v._bsontype !== 'Decimal128' && v._bsontype !== 'Long' ? v.valueOf() : v.toString());
  if (isPlain(v)) return '{…}';
  return String(v).slice(0, 500);
}

// A value for the designer's local preview: dates and numbers keep their type ({ $date } on the wire).
function typed(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v) ? null : { $date: v.toISOString() };
  if (typeof v === 'string') return v.slice(0, 5000);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  switch (v._bsontype) {
    case 'Int32': case 'Double': return Number(v.valueOf());
    case 'Long': case 'Decimal128': { const n = Number(v.toString()); return isFinite(n) ? n : v.toString(); }
    default: break;
  }
  return display(v);
}

const personal = (path) => path.split('.').some((seg) => PERSONAL.test(seg)) || /(^|\.)(address|contact)\./.test(path);

/**
 * opts: { query, language, params: [{ name, def }], values: { name: value }, mode: 'fields' | 'preview', fields: [names], limit,
 *         ws }   ws: the web service request when language is json (query: the records path)
 * fields → { fields: [{ name, cls }], docs, collection, missing, count }
 * preview → { columns, rows, docs, masked, collection, missing, count }   (count: { total, more } of the whole query)
 * fill    → { columns, rows: [{ field: typed value }], docs, masked, collection, missing }   (the designer's local preview)
 */
exports.run = async function (opts) {
  const language = opts.language || 'MongoDbQuery';
  if (language !== 'MongoDbQuery' && language !== 'json') throw bad('Read Fields and Data preview work with MongoDbQuery and web service (json) reports.');
  const max = opts.mode === 'fill' ? 1000 : 200;
  const limit = Math.max(1, Math.min(max, parseInt(opts.limit, 10) || (opts.mode === 'preview' ? 20 : 100)));
  let docs, count = null, spec, missing;
  if (language === 'json') {
    ({ docs, count, missing, source: spec } = await webService.run(opts, limit, (name) => paramValue(name, opts.params || [], opts.values || {})));
  } else {
    if (!String(opts.query || '').trim()) throw bad('Type the query first.');
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw bad('Connect to a Centrix site first (DB Info / DB Connections).', 409);
    const sub = substitute(opts.query, opts.params || [], opts.values || {});
    missing = sub.missing;
    spec = parseSpec(sub.text);
    try {
      [docs, count] = await Promise.all([runSpec(spec, limit), opts.mode === 'fill' ? null : countSpec(spec)]);
    } catch (err) {
      throw bad('MongoDB: ' + [err.codeName, err.errmsg || err.message].filter(Boolean).join(': '));
    }
  }
  const flat = docs.map((doc) => flatten(doc, '', {}));
  if (opts.mode === 'fill') {
    const masked = await censor.isOn();
    const columns = Array.isArray(opts.fields) ? opts.fields.map(String).slice(0, 2000) : [];
    const rows = flat.map((f) => {
      const row = {};
      columns.forEach((c) => {
        const v = Object.prototype.hasOwnProperty.call(f, c) ? f[c] : undefined;
        row[c] = v === null || v === undefined ? null : masked && personal(c) ? '***' : typed(v);
      });
      return row;
    });
    return { columns, rows, docs: docs.length, masked, collection: spec.collection, missing };
  }
  if (opts.mode === 'preview') {
    const masked = await censor.isOn();
    const columns = (Array.isArray(opts.fields) && opts.fields.length ? opts.fields : [...new Set([].concat(...flat.map(Object.keys)))]).slice(0, 200);
    const rows = flat.map((f) => columns.map((c) => {
      const v = Object.prototype.hasOwnProperty.call(f, c) ? f[c] : undefined;
      if (v === null || v === undefined) return null;
      return masked && personal(c) ? '***' : display(v);
    }));
    return { columns, rows, docs: docs.length, masked, collection: spec.collection, missing, count };
  }
  const types = new Map();
  flat.forEach((f) => Object.keys(f).forEach((k) => {
    const cls = javaClass(f[k]);
    if (!types.has(k)) types.set(k, cls);
    else if (cls && types.get(k) && types.get(k) !== cls) types.set(k, 'java.lang.Object');
    else if (cls && !types.get(k)) types.set(k, cls);
  }));
  const fields = [...types.entries()].map(([name, cls]) => ({ name, cls: cls || 'java.lang.Object' }));
  return { fields, docs: docs.length, collection: spec.collection, missing, count };
};

// Sample values for the preview's well-known parameters: the _id of the first record of each collection.
const SAMPLE_PARAMS = { patientvisitsuid: 'patientvisits', loginuid: 'users' };
exports.sampleParams = async function () {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return {};
  const db = mongoose.connection.db;
  const out = {};
  await Promise.all(Object.entries(SAMPLE_PARAMS).map(async ([name, coll]) => {
    const doc = await db.collection(coll).findOne({}, { sort: { _id: 1 }, projection: { _id: 1 }, maxTimeMS: MAX_TIME_MS }).catch(() => null);
    if (doc && doc._id != null) out[name] = typeof doc._id.toHexString === 'function' ? doc._id.toHexString() : String(doc._id);
  }));
  return out;
};

exports._test = { substitute, parseSpec, flatten, javaClass, literal, personal, typed };
