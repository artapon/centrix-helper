const mongoose = require("mongoose");

// Parses mongo-shell query text (the Query Data editor) without evaluating it:
//
//   db.organisations.find({ name: /centrix/i, _id: ObjectId("...") })
//     .projection({ name: 1 }).sort({ name: 1 }).skip(10).limit(50)
//   db.getCollection("patientvisits").aggregate([{ $match: {...} }, { $group: {...} }])
//   db.patients.count({ ... }) · db.patients.distinct("gender", { ... })
//
// Values are a JSON superset: unquoted / single-quoted keys and strings, trailing commas,
// comments, regex literals, ObjectId(), ISODate(), new Date(), NumberInt/Long/Decimal(),
// Timestamp(). Only read operations are accepted, and server-side JavaScript and write
// stages are refused.

const { ObjectId, Long, Decimal128, Timestamp } = mongoose.mongo;

class QueryError extends Error {
  constructor(message, tok) {
    super(message);
    this.line = tok ? tok.line : null;
    this.col = tok ? tok.col : null;
  }
}

const FORBIDDEN = {
  $where: "$where runs JavaScript on the server and is not allowed here",
  $function: "$function runs JavaScript on the server and is not allowed here",
  $accumulator: "$accumulator runs JavaScript on the server and is not allowed here",
  $out: "$out writes data and is not allowed here",
  $merge: "$merge writes data and is not allowed here"
};

// ---------------------------------------------------------------- tokenizer

const PUNCT = "{}[](),:.;";
const VALUE_START = new Set(["(", ",", ":", "[", "{", null]);

function tokenize(src) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const at = () => ({ line, col });
  const step = (n) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") { line++; col = 1; } else col++;
      i++;
    }
  };
  const prevPunct = () => {
    const t = tokens[tokens.length - 1];
    return t ? (t.t === "punc" ? t.v : "value") : null;
  };

  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { step(1); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") step(1); continue; }
    if (c === "/" && src[i + 1] === "*") {
      const start = at();
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new QueryError("Unclosed comment", start);
      step(end + 2 - i);
      continue;
    }
    const pos = at();

    if (c === '"' || c === "'") {
      let s = "";
      step(1);
      while (true) {
        if (i >= src.length || src[i] === "\n") throw new QueryError("Unclosed string", pos);
        const ch = src[i];
        if (ch === c) { step(1); break; }
        if (ch === "\\") {
          const n = src[i + 1];
          const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" };
          if (n === "u") {
            const hex = src.substr(i + 2, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new QueryError("Bad \\u escape", at());
            s += String.fromCharCode(parseInt(hex, 16));
            step(6);
          } else {
            s += n in map ? map[n] : n;
            step(2);
          }
          continue;
        }
        s += ch;
        step(1);
      }
      tokens.push({ t: "str", v: s, ...pos });
      continue;
    }

    // Regex literal where a value is expected: /pattern/flags
    if (c === "/" && VALUE_START.has(prevPunct())) {
      let pattern = "", inClass = false;
      step(1);
      while (true) {
        if (i >= src.length || src[i] === "\n") throw new QueryError("Unclosed regular expression", pos);
        const ch = src[i];
        if (ch === "\\") { pattern += ch + src[i + 1]; step(2); continue; }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) { step(1); break; }
        pattern += ch;
        step(1);
      }
      let flags = "";
      while (i < src.length && /[a-z]/i.test(src[i])) { flags += src[i]; step(1); }
      if (/[^imsx]/.test(flags)) throw new QueryError(`Unsupported regex flag in "${flags}" (use i, m, s, x)`, pos);
      tokens.push({ t: "regex", pattern, flags, ...pos });
      continue;
    }

    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && (c !== "-" || VALUE_START.has(prevPunct()))) {
      tokens.push({ t: "num", v: Number(num[0]), raw: num[0], ...pos });
      step(num[0].length);
      continue;
    }

    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (id) {
      tokens.push({ t: "id", v: id[0], ...pos });
      step(id[0].length);
      continue;
    }

    if (PUNCT.includes(c)) {
      tokens.push({ t: "punc", v: c, ...pos });
      step(1);
      continue;
    }
    throw new QueryError(`Unexpected character "${c}"`, pos);
  }
  tokens.push({ t: "eof", line, col });
  return tokens;
}

// ---------------------------------------------------------------- parser

function Parser(tokens) {
  let p = 0;
  const peek = (o = 0) => tokens[Math.min(p + o, tokens.length - 1)];
  const next = () => tokens[p++];
  const describe = (t) => (t.t === "eof" ? "end of query" : t.t === "str" ? `"${t.v}"` : t.t === "regex" ? "regex" : `"${t.v}"`);
  const isP = (v, o = 0) => peek(o).t === "punc" && peek(o).v === v;
  const expectP = (v) => {
    const t = next();
    if (t.t !== "punc" || t.v !== v) throw new QueryError(`Expected "${v}" but found ${describe(t)}`, t);
    return t;
  };

  function value() {
    const t = peek();
    if (isP("{")) return object();
    if (isP("[")) return array();
    if (t.t === "str") { next(); return t.v; }
    if (t.t === "num") { next(); return t.v; }
    if (t.t === "regex") {
      next();
      if (t.flags.includes("x")) return new mongoose.mongo.BSONRegExp(t.pattern, t.flags);
      try { return new RegExp(t.pattern, t.flags); } catch (e) { throw new QueryError(`Invalid regex: ${e.message}`, t); }
    }
    if (t.t === "id") return identifierValue();
    throw new QueryError(`Expected a value but found ${describe(t)}`, t);
  }

  function args() {
    expectP("(");
    const list = [];
    while (!isP(")")) {
      list.push(value());
      if (isP(",")) next(); else break;
    }
    expectP(")");
    return list;
  }

  function identifierValue() {
    const t = next();
    switch (t.v) {
      case "true": return true;
      case "false": return false;
      case "null": case "undefined": return null;
      case "NaN": return NaN;
      case "Infinity": return Infinity;
      case "new": {
        const ctor = next();
        if (ctor.t !== "id" || !["Date", "ISODate", "ObjectId", "ObjectID"].includes(ctor.v)) throw new QueryError(`"new ${ctor.v}" is not supported`, ctor);
        return helper(ctor);
      }
    }
    return helper(t);
  }

  function helper(t) {
    if (!isP("(")) throw new QueryError(`Unknown value "${t.v}" (quote strings, e.g. "${t.v}")`, t);
    const a = args();
    const str = (i, what) => {
      if (typeof a[i] !== "string" && typeof a[i] !== "number") throw new QueryError(`${t.v}() needs ${what}`, t);
      return String(a[i]);
    };
    try {
      switch (t.v) {
        case "ObjectId": case "ObjectID":
          if (!a.length) return new ObjectId();
          if (!/^[0-9a-fA-F]{24}$/.test(str(0, "a 24-character hex string"))) throw new Error("ObjectId needs a 24-character hex string");
          return new ObjectId(a[0]);
        case "ISODate": case "Date": {
          const d = a.length ? new Date(a[0]) : new Date();
          if (isNaN(d.getTime())) throw new Error(`Invalid date "${a[0]}"`);
          return d;
        }
        case "NumberInt": return parseInt(str(0, "a number"), 10);
        case "NumberLong": return Long.fromString(str(0, "a number"));
        case "NumberDecimal": return Decimal128.fromString(str(0, "a number"));
        case "Timestamp": return new Timestamp(Number(a[1] || 0), Number(a[0] || 0));
      }
    } catch (e) {
      throw new QueryError(e.message, t);
    }
    throw new QueryError(`"${t.v}()" is not supported`, t);
  }

  function object() {
    expectP("{");
    const obj = {};
    while (!isP("}")) {
      const k = next();
      if (k.t !== "id" && k.t !== "str" && k.t !== "num") throw new QueryError(`Expected a field name but found ${describe(k)}`, k);
      const key = k.t === "num" ? k.raw : k.v;
      if (FORBIDDEN[key]) throw new QueryError(FORBIDDEN[key], k);
      expectP(":");
      obj[key] = value();
      if (isP(",")) next(); else break;
    }
    expectP("}");
    return obj;
  }

  function array() {
    expectP("[");
    const list = [];
    while (!isP("]")) {
      list.push(value());
      if (isP(",")) next(); else break;
    }
    expectP("]");
    return list;
  }

  function name() {
    const t = next();
    if (t.t !== "id") throw new QueryError(`Expected a name but found ${describe(t)}`, t);
    return t;
  }

  // db.<collection>.<method>(...)[.<modifier>(...)]*
  function program() {
    const db = name();
    if (db.v !== "db") throw new QueryError('Queries start with "db." e.g. db.patients.find({})', db);
    let collection;
    if (isP("[")) {
      next();
      const s = next();
      if (s.t !== "str") throw new QueryError("Expected a collection name string", s);
      collection = s.v;
      expectP("]");
    } else {
      expectP(".");
      const first = name();
      if (first.v === "getCollection" && isP("(")) {
        const a = args();
        if (typeof a[0] !== "string" || !a[0]) throw new QueryError('getCollection() needs a collection name, e.g. db.getCollection("patients")', first);
        collection = a[0];
      } else {
        // Collection names may contain dots (e.g. system.profile): the method is the first name followed by "(".
        const parts = [first.v];
        while (isP(".") && peek(1).t === "id" && !(peek(2).t === "punc" && peek(2).v === "(")) {
          next();
          parts.push(next().v);
        }
        collection = parts.join(".");
      }
    }

    const calls = [];
    while (isP(".")) {
      next();
      const m = name();
      calls.push({ name: m.v, tok: m, args: args() });
    }
    if (isP(";")) next();
    const end = peek();
    if (end.t !== "eof") throw new QueryError(`Unexpected ${describe(end)} after the query`, end);
    if (!calls.length) throw new QueryError("Add a method, e.g. .find({})", end);
    return { collection, calls };
  }

  return { program };
}

// ---------------------------------------------------------------- query shape

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp) && !v._bsontype;
const needObject = (v, what, tok) => {
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) throw new QueryError(`${what} must be an object { ... }`, tok);
  return v;
};
const needInt = (v, what, tok) => {
  if (!Number.isInteger(v) || v < 0) throw new QueryError(`${what} must be a whole number of 0 or more`, tok);
  return v;
};

/**
 * Parses editor text into { collection, method, filter, projection, sort, skip, limit, hint,
 * pipeline, field }. Throws QueryError with line / col for the editor to mark.
 */
function parse(text) {
  if (!String(text || "").trim()) throw new QueryError("Type a query, e.g. db.patients.find({})", { line: 1, col: 1 });
  const { collection, calls } = Parser(tokenize(String(text))).program();
  const [main, ...mods] = calls;
  const q = { collection, method: null, filter: {}, projection: null, sort: null, skip: 0, limit: 0, hint: null };

  switch (main.name) {
    case "find":
    case "findOne":
      q.method = "find";
      q.filter = needObject(main.args[0], "The filter", main.tok);
      if (main.args[1] !== undefined) q.projection = needObject(main.args[1], "The projection", main.tok);
      if (main.name === "findOne") q.limit = 1;
      break;
    case "aggregate":
      q.method = "aggregate";
      if (!Array.isArray(main.args[0])) throw new QueryError("aggregate() needs a pipeline array [ ... ]", main.tok);
      q.pipeline = main.args[0];
      q.pipeline.forEach((stage) => {
        if (!isPlainObject(stage) || Object.keys(stage).length !== 1) throw new QueryError("Each pipeline stage is an object with one $stage key", main.tok);
      });
      break;
    case "count":
    case "countDocuments":
      q.method = "count";
      q.filter = needObject(main.args[0], "The filter", main.tok);
      break;
    case "estimatedDocumentCount":
      q.method = "estimatedCount";
      break;
    case "distinct":
      q.method = "distinct";
      if (typeof main.args[0] !== "string") throw new QueryError('distinct() needs a field name, e.g. .distinct("gender")', main.tok);
      q.field = main.args[0];
      q.filter = needObject(main.args[1], "The filter", main.tok);
      break;
    default:
      throw new QueryError(`.${main.name}() is not available here (read-only: find, findOne, aggregate, count, countDocuments, distinct)`, main.tok);
  }

  mods.forEach((m) => {
    const a = m.args[0];
    if (["pretty", "toArray", "maxTimeMS", "batchSize", "comment"].includes(m.name)) return;
    if (q.method === "find" && m.name === "count") { q.method = "count"; return; }
    if (q.method !== "find") throw new QueryError(`.${m.name}() only follows .find()`, m.tok);
    switch (m.name) {
      case "projection": case "project": q.projection = needObject(a, "The projection", m.tok); break;
      case "sort": q.sort = needObject(a, "The sort", m.tok); break;
      case "skip": q.skip = needInt(a, "skip()", m.tok); break;
      case "limit": q.limit = needInt(Math.abs(a || 0), "limit()", m.tok); break;
      case "hint":
        if (typeof a !== "string" && !isPlainObject(a)) throw new QueryError("hint() needs an index name or key pattern", m.tok);
        q.hint = a;
        break;
      default:
        throw new QueryError(`.${m.name}() is not supported`, m.tok);
    }
  });

  if (q.projection && !Object.keys(q.projection).length) q.projection = null;
  if (q.sort && !Object.keys(q.sort).length) q.sort = null;
  return q;
}

// ---------------------------------------------------------------- results

/** BSON values -> JSON the page can render with types (extended-JSON style wrappers). */
function toTagged(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return { $date: isNaN(v.getTime()) ? null : v.toISOString() };
  if (v instanceof RegExp) return { $regex: v.source, $options: v.flags };
  if (Array.isArray(v)) return v.map(toTagged);
  if (Buffer.isBuffer(v)) return { $binary: { base64: v.toString("base64"), subType: "00" } };
  if (typeof v === "number") return Number.isFinite(v) ? v : { $numberDouble: String(v) };
  if (typeof v === "bigint") return { $numberLong: v.toString() };
  if (typeof v !== "object") return v;
  switch (v._bsontype) {
    case "ObjectID": case "ObjectId": return { $oid: v.toHexString() };
    case "Decimal128": return { $numberDecimal: v.toString() };
    case "Long": return { $numberLong: v.toString() };
    case "Int32": case "Double": return v.valueOf();
    case "Binary": return { $binary: { base64: Buffer.from(v.buffer || v.value(true)).toString("base64"), subType: Number(v.sub_type || 0).toString(16).padStart(2, "0") } };
    case "Timestamp": return { $timestamp: { t: v.getHighBits(), i: v.getLowBits() } };
    case "BSONRegExp": return { $regex: v.pattern, $options: v.options };
    case "MinKey": return { $minKey: 1 };
    case "MaxKey": return { $maxKey: 1 };
    case "Code": return { $code: String(v.code) };
    case "Symbol": return String(v.value || v);
  }
  if (v._bsontype) return String(v);
  const out = {};
  Object.keys(v).forEach((k) => { out[k] = toTagged(v[k]); });
  return out;
}

module.exports = { parse, toTagged, QueryError };
