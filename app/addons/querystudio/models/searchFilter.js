const { ObjectId } = require("mongoose").Types;
const { QueryError } = require("./shellQuery");

// Advanced search over the whole collection: the page's search conditions become a MongoDB
// filter that is added to the query (find / count / distinct: ANDed with its filter, so
// indexes still help; aggregate: a $match after the pipeline, so it searches the output rows).
//
// search = { match: "all" | "any", conds: [{ field, op, value }] }

const MAX_CONDS = 20;
const MAX_VALUE = 500;
const FIELD_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;   // dotted paths; never an operator ($...)
const OPS = ["contains", "notcontains", "eq", "ne", "starts", "ends", "gt", "gte", "lt", "lte", "empty", "notempty"];
const BKK_MS = 7 * 3600000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// YYYY-MM-DD [HH:mm] or DD/MM/YYYY [HH:mm] in Bangkok time -> [start, end) as Dates.
function bkkRange(s) {
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(s), y, mo, d, h, mi;
  if (m) [, y, mo, d, h, mi] = m;
  else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/.exec(s);
    if (!m) return null;
    [, d, mo, y, h, mi] = m;
  }
  const start = Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0)) - BKK_MS;
  if (!Number.isFinite(start)) return null;
  return [new Date(start), new Date(start + (h ? 60000 : 86400000))];
}

const numberOf = (s) => {
  const t = s.replace(/,/g, "");
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
};

// What "equals <value>" can mean for a field we know nothing about: the text (any case),
// a number, true/false, an ObjectId, or a whole day / minute when it reads as a date.
function equalsFilter(field, value) {
  const any = [value, new RegExp("^" + escapeRe(value) + "$", "i")];
  const n = numberOf(value);
  if (n !== null) any.push(n);
  if (/^(true|false)$/i.test(value)) any.push(/^true$/i.test(value));
  if (/^[0-9a-f]{24}$/i.test(value)) any.push(new ObjectId(value.toLowerCase()));
  const or = [{ [field]: { $in: any } }];
  const range = bkkRange(value);
  if (range) or.push({ [field]: { $gte: range[0], $lt: range[1] } });
  return or.length === 1 ? or[0] : { $or: or };
}

function condFilter(c, i) {
  const label = "Search condition " + (i + 1);
  const field = String((c && c.field) || "").trim();
  const op = String((c && c.op) || "");
  const value = String(c && c.value != null ? c.value : "").trim().slice(0, MAX_VALUE);
  if (!FIELD_RE.test(field) || field.length > 200) throw new QueryError(label + ": choose a field (\"Any field\" works on the page only)", null);
  if (!OPS.includes(op)) throw new QueryError(label + ": unknown comparison", null);

  if (op === "empty") return { $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }, { [field]: { $size: 0 } }] };
  if (op === "notempty") return { $and: [{ [field]: { $exists: true, $nin: [null, ""] } }, { [field]: { $not: { $size: 0 } } }] };
  if (value === "") return null;   // still being typed

  switch (op) {
    case "contains": return { [field]: { $regex: escapeRe(value), $options: "i" } };
    case "notcontains": return { [field]: { $not: new RegExp(escapeRe(value), "i") } };
    case "starts": return { [field]: { $regex: "^" + escapeRe(value), $options: "i" } };
    case "ends": return { [field]: { $regex: escapeRe(value) + "$", $options: "i" } };
    case "eq": return equalsFilter(field, value);
    case "ne": return { $nor: [equalsFilter(field, value)] };
    default: {
      // gt / gte / lt / lte: dates (Bangkok) or numbers
      const range = bkkRange(value);
      if (range) {
        const [start, end] = range;
        const bound = { gt: { $gte: end }, gte: { $gte: start }, lt: { $lt: start }, lte: { $lt: end } }[op];
        return { [field]: bound };
      }
      const n = numberOf(value);
      if (n === null) throw new QueryError(label + ": " + field + " needs a number or a date (YYYY-MM-DD [HH:mm])", null);
      return { [field]: { ["$" + op]: n } };
    }
  }
}

/** The MongoDB filter for a search, or null when it has no complete condition. */
function buildFilter(search) {
  if (!search || typeof search !== "object") return null;
  const conds = Array.isArray(search.conds) ? search.conds : [];
  if (conds.length > MAX_CONDS) throw new QueryError("Use at most " + MAX_CONDS + " search conditions", null);
  const parts = conds.map(condFilter).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return search.match === "any" ? { $or: parts } : { $and: parts };
}

/** Adds the search to a parsed query (see shellQuery.parse). Returns the same query object. */
function applySearch(q, search) {
  const filter = buildFilter(search);
  if (!filter) return q;
  const isEmpty = (f) => !f || !Object.keys(f).length;
  if (q.method === "find" || q.method === "count" || q.method === "distinct") {
    q.filter = isEmpty(q.filter) ? filter : { $and: [q.filter, filter] };
  } else if (q.method === "aggregate") {
    q.pipeline = q.pipeline.concat([{ $match: filter }]);
  } else {
    throw new QueryError("Search does not apply to " + q.method + "(); use find() or aggregate()", null);
  }
  q.search = filter;
  return q;
}

module.exports = { buildFilter, applySearch, MAX_CONDS };
