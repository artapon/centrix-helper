const mongoose = require("mongoose");
const { run, get, all } = require("../config/sqlite");
const { parse, QueryError } = require("../helpers/shellquery.helper");

// Query Data audit log (SQLite query_audit): one row per Run / Count / Explain request, and one per Export.
const MAX_QUERY = 100000;
const MAX_ERROR = 2000;
const KEEP_DAYS = 365;
const PAGE_SIZE_MAX = 200;
const STATUSES = ["ok", "error", "stopped", "invalid"];
const ACTIONS = ["run", "count", "explain", "export", "clear", "censor", "connect"];

const cut = (s, n) => String(s == null ? "" : s).slice(0, n);
const intOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.trunc(Number(v)) : null);

// MongoDB "Interrupted" (killOp from Stop) vs. other failures; QueryError = the text did not parse.
function statusOf(err) {
  if (!err) return "ok";
  if (err instanceof QueryError) return "invalid";
  if (err.code === 11601 || err.codeName === "Interrupted" || /interrupted/i.test(err.message || "")) return "stopped";
  return "error";
}

const clientIp = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || "").replace(/^::ffff:/, "");

let lastPrune = 0;
function pruneDaily() {
  if (Date.now() - lastPrune < 86400000) return;
  lastPrune = Date.now();
  run("DELETE FROM query_audit WHERE executed_at < ?", [new Date(Date.now() - KEEP_DAYS * 86400000).toISOString()])
    .catch((err) => console.error("Query audit prune failed:", err.message));
}

/** Records one request and returns its id. Never throws: a failing audit write must not fail the query. */
// A whole-collection search sent with the query, as a comment line under it in the log:
// // search (all): statusflag equals "A" · totalprice > "100"
function searchNote(search) {
  const conds = search && Array.isArray(search.conds) ? search.conds.slice(0, 20) : [];
  const words = { contains: "contains", notcontains: "does not contain", eq: "equals", ne: "does not equal", starts: "starts with",
    ends: "ends with", gt: ">", gte: ">=", lt: "<", lte: "<=", empty: "is empty", notempty: "is not empty" };
  const parts = conds
    .filter((c) => c && c.field && (c.op === "empty" || c.op === "notempty" || String(c.value == null ? "" : c.value).trim() !== ""))
    .map((c) => cut(c.field, 200) + " " + (words[c.op] || cut(c.op, 20)) + (c.op === "empty" || c.op === "notempty" ? "" : " " + JSON.stringify(cut(String(c.value).trim(), 500))));
  return parts.length ? "\n// search (" + (search.match === "any" ? "any" : "all") + "): " + parts.join(" · ") : "";
}

exports.record = async function ({ req, action, startedAt, ms, result, error }) {
  try {
    const body = req.body || {};
    const query = String(body.query || "") + searchNote(body.search);
    let method = (result && result.method) || "";
    let collection = (result && result.collection) || "";
    if (!collection) {
      try { const q = parse(query); method = q.method; collection = q.collection; } catch (e) { /* stays blank */ }
    }
    const user = req.user || {};
    const session = global.sessionData || {};
    let docs = null, hasMore = null, total = null;
    if (result) {
      if (Array.isArray(result.docs)) docs = result.docs.length;
      if (result.hasMore !== undefined) hasMore = result.hasMore ? 1 : 0;
      if (action === "count") total = intOrNull(result.total);
      else if (result.kind === "value") total = intOrNull(result.value);
      else if (result.total !== undefined) total = intOrNull(result.total);
      if (action === "explain" && result.summary) docs = intOrNull(result.summary.nReturned);
    }
    const inserted = await run(
      `INSERT INTO query_audit (executed_at, username, role, ip, user_agent, connection_name, db_name, action, method, collection,
        query, page, page_size, status, error, duration_ms, docs_returned, has_more, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date(startedAt).toISOString(), cut(user.username, 120), cut(user.role, 60), cut(clientIp(req), 64),
        cut(req.get && req.get("user-agent"), 300), cut(session.site_name, 200), cut(mongoose.connection.name, 120),
        action, cut(method, 40), cut(collection, 200), cut(query, MAX_QUERY),
        action === "run" || action === "export" ? intOrNull(body.page) : null, action === "run" || action === "export" ? intOrNull(body.pageSize) : null,
        statusOf(error), error ? cut([error.codeName, error.errmsg || error.message].filter(Boolean).join(": "), MAX_ERROR) : "",
        Math.max(0, Math.round(ms)), docs, hasMore, total
      ]
    );
    pruneDaily();
    return inserted && inserted.lastID ? inserted.lastID : null;
  } catch (err) {
    console.error("Query audit write failed:", err.message);
    return null;
  }
};

const EXPORT_STATUS = { done: "ok", cancelled: "stopped", failed: "error" };
const EXPORT_FORMATS = ["csv", "xlsx", "json"];

/**
 * The end of an Export: fills in the row its first batch wrote (rows exported, total time, format,
 * done / cancelled / failed). An export of the page on screen fetched nothing, so it gets a new row.
 * Only the user who started the export can finish its row, and only once.
 */
exports.finishExport = async function (req, b) {
  try {
    const user = req.user || {};
    const ms = Math.max(0, intOrNull(b.ms) || 0);
    const rows = Math.max(0, intOrNull(b.rows) || 0);
    const detail = JSON.stringify({
      format: EXPORT_FORMATS.includes(b.format) ? b.format : "",
      scope: b.scope === "page" ? "page" : "all",
      file: cut(b.file, 200),
      batches: intOrNull(b.batches),
      batchSize: intOrNull(b.batchSize),
      dates: b.dates === "iso" ? "iso" : "local",
      bytes: intOrNull(b.bytes)
    });
    let id = intOrNull(b.auditId);
    if (!id) id = await exports.record({ req, action: "export", startedAt: Date.now() - ms, ms, result: null, error: null });
    if (!id) return false;
    const res = await run(
      `UPDATE query_audit SET status = ?, error = ?, docs_returned = ?, total = COALESCE(?, total), duration_ms = ?, has_more = 0, detail = ?
       WHERE id = ? AND action = 'export' AND username = ? AND detail = ''`,
      [EXPORT_STATUS[b.status] || "ok", cut(b.error, MAX_ERROR), rows, intOrNull(b.total), ms, detail, id, cut(user.username, 120)]
    );
    return !!(res && res.changes);
  } catch (err) {
    console.error("Query audit export write failed:", err.message);
    return false;
  }
};

// ---- audit page ----

// ---- advanced search: conditions on any column, matched all or any ----
// Only these columns can be searched; the type decides the operators and how values are read.
const ADV_FIELDS = {
  id: "n", executed_at: "d", username: "t", role: "t", ip: "t", user_agent: "t", connection_name: "t", db_name: "t",
  action: "t", method: "t", collection: "t", query: "t", status: "t", error: "t", detail: "t",
  duration_ms: "n", docs_returned: "n", total: "n", page: "n", page_size: "n", has_more: "b"
};
const ADV_OPS = {
  t: ["contains", "notcontains", "eq", "ne", "starts", "ends", "empty", "notempty"],
  n: ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "notempty"],
  d: ["eq", "ne", "gt", "gte", "lt", "lte"],
  b: ["eq", "empty", "notempty"]
};
const ADV_MAX = 20;
const likeText = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);

// "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" in Bangkok time -> [start, end] of that day or minute (ISO, UTC).
function advDate(value) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(value).trim());
  if (!m) return null;
  const start = new Date(m[1] + "T" + (m[2] ? m[2] + ":" + m[3] : "00:00") + ":00+07:00");
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + (m[2] ? 60000 : 86400000) - 1);
  return [start.toISOString(), end.toISOString()];
}

/** f.adv: JSON {match: "all"|"any", conds: [{field, op, value}]} -> one SQL condition, or null. */
function advWhere(raw) {
  if (!raw) return null;
  let adv = raw;
  if (typeof raw === "string") {
    try { adv = JSON.parse(raw); } catch (e) { throw new QueryError("Advanced search could not be read", null); }
  }
  const conds = (adv && Array.isArray(adv.conds) ? adv.conds : []).slice(0, ADV_MAX);
  const parts = [], args = [];
  conds.forEach((c, i) => {
    const field = String(c && c.field || ""), type = ADV_FIELDS[field], op = String(c && c.op || "");
    const label = "Advanced search condition " + (i + 1);
    if (!type) throw new QueryError(label + ": unknown column", null);
    if (!ADV_OPS[type].includes(op)) throw new QueryError(label + ": that comparison does not apply to " + field, null);
    const value = c.value == null ? "" : String(c.value).trim().slice(0, 1000);
    if (op === "empty") { parts.push(type === "t" ? `(${field} IS NULL OR ${field} = '')` : `${field} IS NULL`); return; }
    if (op === "notempty") { parts.push(type === "t" ? `(${field} IS NOT NULL AND ${field} <> '')` : `${field} IS NOT NULL`); return; }
    if (value === "") return;   // conditions still being typed are skipped
    if (type === "t") {
      const sql = {
        contains: `${field} LIKE ? ESCAPE '\\'`, notcontains: `${field} NOT LIKE ? ESCAPE '\\'`,
        starts: `${field} LIKE ? ESCAPE '\\'`, ends: `${field} LIKE ? ESCAPE '\\'`,
        eq: `${field} = ? COLLATE NOCASE`, ne: `${field} <> ? COLLATE NOCASE`
      }[op];
      const arg = { contains: "%" + likeText(value) + "%", notcontains: "%" + likeText(value) + "%", starts: likeText(value) + "%", ends: "%" + likeText(value) }[op];
      parts.push(sql); args.push(arg === undefined ? value : arg);
      return;
    }
    if (type === "n") {
      let n = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(n)) throw new QueryError(label + ": " + field + " needs a number", null);
      if (field === "page") n -= 1;   // pages are shown 1-based
      const cmp = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
      parts.push(op === "ne" ? `(${field} IS NULL OR ${field} <> ?)` : `${field} ${cmp} ?`); args.push(n);
      return;
    }
    if (type === "d") {
      const range = advDate(value);
      if (!range) throw new QueryError(label + ": write the date as YYYY-MM-DD or YYYY-MM-DD HH:mm", null);
      const [start, end] = range;
      if (op === "eq") { parts.push(`(${field} >= ? AND ${field} <= ?)`); args.push(start, end); }
      else if (op === "ne") { parts.push(`(${field} < ? OR ${field} > ?)`); args.push(start, end); }
      else { parts.push(`${field} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ?`); args.push({ gt: end, gte: start, lt: start, lte: end }[op]); }
      return;
    }
    // b: has_more yes / no
    const yes = /^(1|y|yes|true)$/i.test(value), no = /^(0|n|no|false)$/i.test(value);
    if (!yes && !no) throw new QueryError(label + ": " + field + " is yes or no", null);
    parts.push(`${field} = ?`); args.push(yes ? 1 : 0);
  });
  if (!parts.length) return null;
  const join = adv.match === "any" ? " OR " : " AND ";
  return { sql: "(" + parts.join(join) + ")", args };
}

// Filters from the query string -> SQL WHERE. Dates are YYYY-MM-DD in Bangkok time.
function where(f) {
  const sql = [], args = [];
  const day = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null;
  const from = day(f.from), to = day(f.to);
  if (from) { sql.push("executed_at >= ?"); args.push(new Date(from + "T00:00:00+07:00").toISOString()); }
  if (to) { sql.push("executed_at <= ?"); args.push(new Date(to + "T23:59:59.999+07:00").toISOString()); }
  if (f.user) { sql.push("username = ?"); args.push(String(f.user)); }
  if (f.collection) { sql.push("collection = ?"); args.push(String(f.collection)); }
  if (f.connection) { sql.push("connection_name = ?"); args.push(String(f.connection)); }
  // IP: exact, or a * wildcard (10.0.0.* , 192.168.*)
  if (f.ip) {
    const ip = String(f.ip).trim().slice(0, 64);
    if (ip.includes("*")) { sql.push("ip LIKE ? ESCAPE '\\'"); args.push(ip.replace(/[\\%_]/g, (c) => "\\" + c).replace(/\*/g, "%")); }
    else if (ip) { sql.push("ip = ?"); args.push(ip); }
  }
  if (STATUSES.includes(f.status)) { sql.push("status = ?"); args.push(f.status); }
  if (ACTIONS.includes(f.action)) { sql.push("action = ?"); args.push(f.action); }
  if (f.slow && Number(f.slow) > 0) { sql.push("duration_ms >= ?"); args.push(Math.trunc(Number(f.slow))); }
  if (f.q) {
    const like = "%" + String(f.q).replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    sql.push("(query LIKE ? ESCAPE '\\' OR error LIKE ? ESCAPE '\\' OR collection LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const adv = advWhere(f.adv);
  if (adv) { sql.push(adv.sql); args.push(...adv.args); }
  return { sql: sql.length ? "WHERE " + sql.join(" AND ") : "", args };
}

exports.search = async function (f) {
  const w = where(f);
  const size = Math.min(PAGE_SIZE_MAX, Math.max(10, intOrNull(f.pageSize) || 50));
  const page = Math.max(0, intOrNull(f.page) || 0);
  const [summary, rows, durations] = await Promise.all([
    get(`SELECT COUNT(*) AS total, COUNT(DISTINCT username) AS users,
           SUM(status = 'ok') AS ok, SUM(status = 'error') AS errors, SUM(status = 'stopped') AS stopped, SUM(status = 'invalid') AS invalid,
           AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms
         FROM query_audit ${w.sql}`, w.args),
    all(`SELECT id, executed_at, username, role, ip, connection_name, db_name, action, method, collection,
           substr(query, 1, 400) AS query_head, length(query) AS query_length, page, page_size, status, error,
           duration_ms, docs_returned, has_more, total
         FROM query_audit ${w.sql} ORDER BY executed_at DESC, id DESC LIMIT ? OFFSET ?`, w.args.concat([size, page * size])),
    // p95 from the matching rows' durations (OFFSET into the sorted list)
    get(`SELECT duration_ms AS p95 FROM query_audit ${w.sql} ORDER BY duration_ms DESC LIMIT 1 OFFSET
           (SELECT CAST(COUNT(*) * 0.05 AS INTEGER) FROM query_audit ${w.sql})`, w.args.concat(w.args))
  ]);
  return {
    page, pageSize: size, rows,
    summary: Object.assign({}, summary, { avg_ms: summary.avg_ms == null ? null : Math.round(summary.avg_ms), p95_ms: durations ? durations.p95 : null })
  };
};

exports.get = (id) => get("SELECT * FROM query_audit WHERE id = ?", [id]);

// Values for the filter dropdowns.
exports.options = async function () {
  const [users, collections, connections, ips] = await Promise.all([
    all("SELECT username AS v, COUNT(*) AS n FROM query_audit WHERE username <> '' GROUP BY username ORDER BY username"),
    all("SELECT collection AS v, COUNT(*) AS n FROM query_audit WHERE collection <> '' GROUP BY collection ORDER BY n DESC LIMIT 300"),
    all("SELECT connection_name AS v, COUNT(*) AS n FROM query_audit WHERE connection_name <> '' GROUP BY connection_name ORDER BY connection_name"),
    all("SELECT ip AS v, COUNT(*) AS n, GROUP_CONCAT(DISTINCT username) AS users FROM query_audit WHERE ip <> '' GROUP BY ip ORDER BY n DESC LIMIT 300")
  ]);
  return { users, collections, connections, ips, keepDays: KEEP_DAYS };
};

// ---- export the log (CSV / Excel) ----
const EXPORT_MAX = 100000;
const EXPORT_COLUMNS = [
  { key: "id", label: "ID", type: "n", width: 8 },
  { key: "executed_at", label: "Executed at (Bangkok)", type: "d", width: 20 },
  { key: "username", label: "Executed by", width: 16 },
  { key: "role", label: "Role", width: 10 },
  { key: "ip", label: "Client IP", width: 15 },
  { key: "connection_name", label: "Connection", width: 18 },
  { key: "db_name", label: "Database", width: 14 },
  { key: "action", label: "Action", width: 9 },
  { key: "method", label: "Method", width: 10 },
  { key: "collection", label: "Collection", width: 20 },
  { key: "status", label: "Status", width: 9 },
  { key: "duration_ms", label: "Response (ms)", type: "n", width: 13 },
  { key: "docs_returned", label: "Docs / rows", type: "n", width: 11 },
  { key: "has_more", label: "More pages", width: 10 },
  { key: "total", label: "Total", type: "n", width: 10 },
  { key: "page", label: "Page", type: "n", width: 7 },
  { key: "page_size", label: "Page size", type: "n", width: 9 },
  { key: "error", label: "Error", width: 30 },
  { key: "detail", label: "Detail", width: 30 },
  { key: "user_agent", label: "User agent", width: 30 },
  { key: "query", label: "Query", width: 80 }
];

/** Every entry matching the page's filters, newest first (up to EXPORT_MAX). */
exports.exportRows = async function (f) {
  const w = where(f);
  const rows = await all(
    `SELECT ${EXPORT_COLUMNS.map((c) => c.key).join(", ")} FROM query_audit ${w.sql} ORDER BY executed_at DESC, id DESC LIMIT ?`,
    w.args.concat([EXPORT_MAX + 1])
  );
  const truncated = rows.length > EXPORT_MAX;
  rows.length = Math.min(rows.length, EXPORT_MAX);
  rows.forEach((r) => {
    r.page = r.page == null ? null : r.page + 1;   // 1-based like the page shows
    r.has_more = r.has_more == null ? "" : r.has_more ? "yes" : "no";
  });
  return { columns: EXPORT_COLUMNS, rows, truncated };
};
exports.EXPORT_MAX = EXPORT_MAX;

// ---- clear the log (administrators) ----
const CLEAR_DAYS = [30, 90, 180, 365];

// What a clear removes: everything, entries older than N days, or the entries matching the page's filters.
function clearWhere(b) {
  if (b.scope === "all") return { sql: "", args: [], scope: "all" };
  if (b.scope === "older") {
    const days = CLEAR_DAYS.includes(Number(b.days)) ? Number(b.days) : null;
    if (!days) throw new QueryError("Choose how old the entries to clear are", null);
    return { sql: "WHERE executed_at < ?", args: [new Date(Date.now() - days * 86400000).toISOString()], scope: "older", days };
  }
  if (b.scope === "filtered") return Object.assign(where(b.filters || {}), { scope: "filtered" });
  throw new QueryError("Choose what to clear", null);
}

exports.clearPreview = async function (b) {
  const w = clearWhere(b);
  const row = await get(`SELECT COUNT(*) AS n, MIN(executed_at) AS oldest, MAX(executed_at) AS newest FROM query_audit ${w.sql}`, w.args);
  return { count: row.n, oldest: row.oldest, newest: row.newest };
};

/**
 * Deletes entries and then records the clear itself (action "clear": who, when, what, how many),
 * so the log always shows that it was cleared.
 */
exports.clear = async function (req, b) {
  const w = clearWhere(b);
  const started = Date.now();
  const res = await run(`DELETE FROM query_audit ${w.sql}`, w.args);
  const deleted = (res && res.changes) || 0;
  const filters = w.scope === "filtered" ? Object.fromEntries(Object.entries(b.filters || {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, cut(v, 200)])) : undefined;
  const id = await exports.record({ req: { user: req.user, ip: req.ip, socket: req.socket, get: req.get && req.get.bind(req), body: {} }, action: "clear", startedAt: started, ms: Date.now() - started, result: null, error: null });
  if (id) {
    await run("UPDATE query_audit SET docs_returned = ?, detail = ? WHERE id = ?",
      [deleted, JSON.stringify({ scope: w.scope, days: w.days || null, filters, deleted }), id]);
  }
  return { deleted, auditId: id };
};

/** An administrator switched personal-data censoring on or off (action "censor"). */
exports.recordCensor = async function (req, { before, on, startedAt }) {
  const id = await exports.record({ req: { user: req.user, ip: req.ip, socket: req.socket, get: req.get && req.get.bind(req), body: {} }, action: "censor", startedAt, ms: Date.now() - startedAt, result: null, error: null });
  if (id) await run("UPDATE query_audit SET detail = ? WHERE id = ?", [JSON.stringify({ censor: on ? "on" : "off", before: before ? "on" : "off" }), id]);
  return id;
};

// A switch of the app's database connection from Query Data: detail { from, to } ({ name, db }).
exports.recordConnect = async function (req, { from, to, startedAt, error }) {
  const id = await exports.record({ req: { user: req.user, ip: req.ip, socket: req.socket, get: req.get && req.get.bind(req), body: {} }, action: "connect", startedAt, ms: Date.now() - startedAt, result: null, error });
  if (id) await run("UPDATE query_audit SET detail = ? WHERE id = ?", [JSON.stringify({ from: { name: from.name, db: from.db }, to: { name: to.name, db: to.db } }), id]);
  return id;
};

exports.KEEP_DAYS = KEEP_DAYS;
