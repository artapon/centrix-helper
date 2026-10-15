const { parse, QueryError } = require("../../../app/core/helpers/shellquery.helper");

// Query templates: Query Data queries with parameters, filled in before they run.
//
//   {{name}}              the parameter's value as a query literal ("text", 5, ObjectId("…"), ISODate("…"));
//                         a choice parameter is one of a fixed list of values, as "text"
//   {{name:mod}}          another form of it: :text (as typed, quoted), :end (a date's end of day),
//                         :contains / :starts (text as a case-insensitive regex), :patient (a VN's patient)
//   {{a|b:mod}}           the first of a, b that has a value
//   {{#name}} … {{/name}} kept only when the parameter has a value ({{#a|b}} when any of them has one)
//   {{^name}} … {{/name}} kept only when it has none
//
// Built-in values: {{orguid}} (the signed-in site's organisation), {{today}} and {{now}}.
// hn and vn parameters are looked up when the template runs: {{hn}} is the patient's _id and
// {{vn}} the visit's _id, so the queries never search patient data by HN. An item parameter is an item
// master code, looked up the same way: {{item}} is the item master's _id.

const PARAM_TYPES = ["text", "choice", "number", "date", "boolean", "objectid", "reference", "hn", "vn", "item"];
const BUILTINS = ["orguid", "today", "now"];
const MAX = { name: 120, category: 60, description: 2000, params: 30, queries: 40, title: 120, query: 100000, label: 120, help: 300, value: 500 };
const NAME_RE = /^[A-Za-z_]\w{0,39}$/;
const HEX_RE = /^[0-9a-fA-F]{24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ_OFFSET = "+07:00";   // Asia/Bangkok, like the rest of the app

const MODS = {
  text: ["text", "contains", "starts"],
  number: ["text"],
  date: ["end", "text"],
  boolean: ["text"],
  objectid: ["text"],
  reference: ["text"],
  choice: [],
  hn: ["text"],
  vn: ["text", "patient"],
  item: ["text"],
  orguid: [],
  today: ["end"],
  now: []
};

const str = (v, max) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);

/** A template from the editor, checked and trimmed: { name, category, description, params, queries }. */
function normalize(input) {
  const t = input || {};
  const name = str(t.name, MAX.name + 1);
  if (!name) throw new QueryError("Give the template a name", null);
  if (name.length > MAX.name) throw new QueryError(`Keep the name under ${MAX.name} characters`, null);

  const rawParams = Array.isArray(t.params) ? t.params : [];
  if (rawParams.length > MAX.params) throw new QueryError(`A template can have up to ${MAX.params} parameters`, null);
  const seen = new Set();
  const params = rawParams.map((p, i) => {
    const pname = str(p && p.name, 41);
    const at = `Parameter ${i + 1}`;
    if (!NAME_RE.test(pname)) throw new QueryError(`${at}: the name must start with a letter and use only letters, digits and _ (e.g. visitdate)`, null);
    if (BUILTINS.includes(pname)) throw new QueryError(`${at}: "${pname}" is a built-in value; choose another name`, null);
    if (seen.has(pname.toLowerCase())) throw new QueryError(`${at}: "${pname}" is used twice`, null);
    seen.add(pname.toLowerCase());
    const type = PARAM_TYPES.includes(p.type) ? p.type : "text";
    const out = {
      name: pname,
      label: str(p.label, MAX.label) || pname,
      type,
      required: p.required === true || p.required === "yes" ? true : p.required === "any" ? "any" : false,
      default: str(p.default, MAX.value),
      help: str(p.help, MAX.help)
    };
    if (type === "reference") {
      out.domain = str(p.domain, 60).toUpperCase();
      if (!/^[A-Z0-9_]{1,60}$/.test(out.domain)) throw new QueryError(`${at} (${pname}): give the reference domain code, e.g. ENTYPE`, null);
    }
    if (type === "choice") {
      // A fixed list of values to pick from (given as an array, or one per line / comma).
      const list = Array.isArray(p.options) ? p.options : String(p.options || "").split(/[\n,]/);
      out.options = list.map((o) => str(o, 100)).filter((o, j, a) => o && a.indexOf(o) === j).slice(0, 100);
      if (!out.options.length) throw new QueryError(`${at} (${pname}): give the values to choose from, separated by commas`, null);
    }
    if (out.default) typed(out, out.default);   // a default must be a valid value
    return out;
  });

  const rawQueries = Array.isArray(t.queries) ? t.queries : [];
  if (!rawQueries.length) throw new QueryError("Add at least one query", null);
  if (rawQueries.length > MAX.queries) throw new QueryError(`A template can have up to ${MAX.queries} queries`, null);
  const queries = rawQueries.map((q, i) => {
    const query = String((q && q.query) || "");
    const title = str(q && q.title, MAX.title) || `Query ${i + 1}`;
    if (!query.trim()) throw new QueryError(`"${title}": the query is empty`, null);
    if (query.length > MAX.query) throw new QueryError(`"${title}": the query is too long`, null);
    return { title, query };
  });

  const tpl = { name, category: str(t.category, MAX.category), description: str(t.description, MAX.description), params, queries };
  check(tpl);
  return tpl;
}

// ---- reading the placeholders ----

// {{#a|b}} … {{/a|b}} with no other section inside (sections are removed innermost first).
const SECTION_RE = /\{\{\s*([#^])\s*([\w|]+)\s*\}\}((?:(?!\{\{\s*[#^])[\s\S])*?)\{\{\s*\/\s*\2\s*\}\}/;
const VALUE_RE = /\{\{\s*([\w]+(?::\w+)?(?:\s*\|\s*[\w]+(?::\w+)?)*)\s*\}\}/g;

const alternatives = (spec) => spec.split("|").map((s) => {
  const [name, mod] = s.trim().split(":");
  return { name, mod: mod || "" };
});

// Line and column of an offset, for errors in the template text.
function posOf(text, index) {
  const before = text.slice(0, index).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

/**
 * Fills one query. has(name) says whether a parameter (or built-in) has a value; literal(name, mod)
 * gives it as query text. Unknown names and values without a value are errors.
 */
function fill(text, { known, has, literal }) {
  let out = String(text);
  const unknown = (name, at) => {
    if (!known(name)) throw new QueryError(`{{${name}}} is not a parameter of this template (built-in: ${BUILTINS.join(", ")})`, posOf(out, at));
  };
  for (let guard = 0; guard < 1000; guard++) {
    const m = SECTION_RE.exec(out);
    if (!m) break;
    const names = m[2].split("|");
    names.forEach((n) => unknown(n, m.index));
    const any = names.some(has);
    const keep = m[1] === "#" ? any : !any;
    out = out.slice(0, m.index) + (keep ? m[3] : "") + out.slice(m.index + m[0].length);
  }
  const stray = /\{\{\s*([#^/])\s*([\w|]*)\s*\}\}/.exec(out);
  if (stray) {
    throw new QueryError(stray[1] === "/" ? `{{/${stray[2]}}} closes a section that isn't open` : `{{${stray[1]}${stray[2]}}} is not closed with {{/${stray[2]}}}`, posOf(out, stray.index));
  }
  return out.replace(VALUE_RE, (whole, spec, at) => {
    const alts = alternatives(spec);
    alts.forEach((a) => unknown(a.name, at));
    const hit = alts.find((a) => has(a.name));
    if (!hit) {
      const names = alts.map((a) => a.name).join("|");
      throw new QueryError(`{{${spec}}} has no value: give ${alts.length > 1 ? "one of " + names : '"' + names + '"'}, or put it inside {{#${names}}} … {{/${names}}}`, posOf(out, at));
    }
    return literal(hit.name, hit.mod, posOf(out, at));
  });
}

// ---- values ----

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const oid = (hex) => `ObjectId("${hex}")`;
const isoDay = (day, end) => `ISODate("${day}T${end ? "23:59:59.999" : "00:00:00.000"}${TZ_OFFSET}")`;
function bangkokToday() {
  const d = new Date(Date.now() + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}

/** A typed value from what was typed: throws when it doesn't fit the parameter's type. */
function typed(p, raw) {
  const v = String(raw).trim();
  const bad = (what) => new QueryError(`${p.label || p.name}: ${what}`, null);
  switch (p.type) {
    case "number":
      if (!/^-?\d+(\.\d+)?$/.test(v)) throw bad(`"${v}" is not a number`);
      return Number(v);
    case "date":
      if (!DATE_RE.test(v) || isNaN(new Date(v + "T00:00:00Z").getTime())) throw bad(`"${v}" is not a date (YYYY-MM-DD)`);
      return v;
    case "boolean":
      if (!/^(true|false)$/i.test(v)) throw bad("choose yes or no");
      return v.toLowerCase() === "true";
    case "choice":
      if (!(p.options || []).includes(v)) throw bad(`"${v}" is not one of ${(p.options || []).join(", ")}`);
      return v;
    case "objectid":
    case "reference":
      if (!HEX_RE.test(v)) throw bad(`"${v}" is not an ObjectId (24 hex characters)`);
      return v.toLowerCase();
    default:
      return v;
  }
}

function literalOf(p, value, mod, pos) {
  const allowed = MODS[p.type] || [];
  if (mod && !allowed.includes(mod)) {
    throw new QueryError(`{{${p.name}:${mod}}}: ${allowed.length ? "use " + allowed.map((m) => ":" + m).join(", ") : "no other forms"} for a ${p.type} value`, pos);
  }
  if (mod === "text") return JSON.stringify(String(value.raw));
  switch (p.type) {
    case "text":
      if (mod === "contains") return `/${escapeRegex(value.raw)}/i`;
      if (mod === "starts") return `/^${escapeRegex(value.raw)}/i`;
      return JSON.stringify(value.raw);
    case "number": case "boolean": return String(value.typed);
    case "date": return isoDay(value.typed, mod === "end");
    case "objectid": case "reference": return oid(value.typed);
    case "hn": return oid(value.patientuid);
    case "item": return oid(value.itemuid);
    case "vn": return oid(mod === "patient" ? value.patientuid : value.visituid);
    case "orguid": return oid(value.typed);
    case "today": return isoDay(value.typed, mod === "end");
    case "now": return `ISODate("${new Date().toISOString()}")`;
  }
  return JSON.stringify(String(value.raw));
}

// A stand-in value of each type, for checking a template when it is saved.
const SAMPLE = {
  text: { raw: "text" }, choice: { raw: "choice" }, number: { raw: "1", typed: 1 }, date: { raw: "2000-01-01", typed: "2000-01-01" },
  boolean: { raw: "true", typed: true }, objectid: { raw: "0".repeat(24), typed: "0".repeat(24) },
  reference: { raw: "0".repeat(24), typed: "0".repeat(24) },
  hn: { raw: "HN", patientuid: "0".repeat(24) }, vn: { raw: "VN", visituid: "0".repeat(24), patientuid: "0".repeat(24) },
  item: { raw: "ITEM", itemuid: "0".repeat(24) }
};
const BUILTIN_PARAMS = { orguid: { name: "orguid", type: "orguid" }, today: { name: "today", type: "today" }, now: { name: "now", type: "now" } };

function renderWith(tpl, values, builtins) {
  const byName = {};
  tpl.params.forEach((p) => { byName[p.name] = p; });
  const paramOf = (n) => byName[n] || BUILTIN_PARAMS[n];
  const valueOf = (n) => (byName[n] ? values[n] : builtins[n]);
  return (text) => fill(text, {
    known: (n) => !!paramOf(n),
    has: (n) => !!valueOf(n),
    literal: (n, mod, pos) => literalOf(paramOf(n), valueOf(n), mod, pos)
  });
}

const SAMPLE_BUILTINS = { orguid: { typed: "0".repeat(24) }, today: { typed: "2000-01-01" }, now: { typed: true } };

/**
 * Checks every query of a template: once with every parameter given and once with only the
 * required ones, so a missing comma inside a {{#…}} section shows up when it is saved.
 */
function check(tpl) {
  const all = {}, few = {};
  tpl.params.forEach((p) => {
    all[p.name] = SAMPLE[p.type];
    if (p.required || p.default) few[p.name] = SAMPLE[p.type];
  });
  // "One of" parameters: the check leaves just the first of them.
  const anyOf = tpl.params.filter((p) => p.required === "any");
  if (anyOf.length && !anyOf.some((p) => p.default)) few[anyOf[0].name] = SAMPLE[anyOf[0].type];
  tpl.queries.forEach((q) => {
    [all, few].forEach((values) => {
      try {
        parse(renderWith(tpl, values, SAMPLE_BUILTINS)(q.query));
      } catch (err) {
        if (!(err instanceof QueryError)) throw err;
        const where = err.line ? ` line ${err.line}, col ${err.col}` : "";
        const e = new QueryError(`"${q.title}"${where}: ${err.message}`, null);
        e.query = tpl.queries.indexOf(q);
        e.qline = err.line;
        e.qcol = err.col;
        throw e;
      }
    });
  });
}

/** The collection a template query reads, for listing ("" when it can't be told). */
function collectionOf(query) {
  const m = /db\.(?:getCollection\(\s*["']([^"']+)["']\s*\)|([\w$]+))\./.exec(String(query || ""));
  return m ? m[1] || m[2] : "";
}

/**
 * Fills a template query with the values typed in Query Data.
 * lookup: { patient(hn) → { _id } | null, visit(vn) → { _id, patientuid } | null } · orguid: hex
 * Returns the query text to run.
 */
async function resolve(tpl, index, rawValues, { orguid, lookup }) {
  const q = tpl.queries[index];
  if (!q) throw new QueryError("That query is not in the template any more. Reload the templates.", null);
  const input = rawValues || {};
  const values = {};
  for (const p of tpl.params) {
    const raw = str(input[p.name] !== undefined ? input[p.name] : p.default, MAX.value);
    if (!raw) continue;
    const value = { raw, typed: typed(p, raw) };
    if (p.type === "hn") {
      const patient = await lookup.patient(raw);
      if (!patient) throw new QueryError(`${p.label}: no patient has HN "${raw}"`, null);
      value.patientuid = String(patient._id);
    } else if (p.type === "vn") {
      const visit = await lookup.visit(raw);
      if (!visit) throw new QueryError(`${p.label}: no visit has VN "${raw}"`, null);
      value.visituid = String(visit._id);
      value.patientuid = visit.patientuid ? String(visit.patientuid) : "";
    } else if (p.type === "item") {
      const item = await lookup.item(raw);
      if (!item) throw new QueryError(`${p.label}: no item master has code "${raw}"`, null);
      value.itemuid = String(item._id);
    }
    values[p.name] = value;
  }
  const missing = tpl.params.filter((p) => p.required === true && !values[p.name]);
  if (missing.length) throw new QueryError(`Fill in ${missing.map((p) => p.label).join(", ")}`, null);
  const anyOf = tpl.params.filter((p) => p.required === "any");
  if (anyOf.length && !anyOf.some((p) => values[p.name])) throw new QueryError(`Fill in at least one of ${anyOf.map((p) => p.label).join(", ")}`, null);

  const builtins = { today: { typed: bangkokToday() }, now: { typed: true } };
  if (orguid) builtins.orguid = { typed: String(orguid) };
  try {
    return renderWith(tpl, values, builtins)(q.query);
  } catch (err) {
    if (err instanceof QueryError && /\{\{orguid\}\} has no value/.test(err.message)) {
      throw new QueryError("The signed-in site has no organisation in this database, so {{orguid}} has no value", null);
    }
    throw err;
  }
}

module.exports = { PARAM_TYPES, BUILTINS, MODS, MAX, normalize, check, resolve, collectionOf };
