const mongoose = require("mongoose");
const { parse, toTagged } = require("../../../app/core/helpers/shellquery.helper");
const { applySearch } = require("./searchfilter.helper");
const censor = require("../../../app/core/helpers/censor.helper");

// Read-only queries for the Query Data page, on the connected database.
const MAX_TIME_MS = 30000;   // a query (or count / explain) is stopped after this
const MAX_PAGE_SIZE = 500;
const MAX_EXPORT_BATCH = 5000;  // Export fetches the results in batches of up to this many
const SAMPLE_SIZE = 200;     // documents sampled to suggest field names
const MAX_FIELDS = 600;

const db = () => mongoose.connection.db;
const admin = () => mongoose.connection.db.admin();

// Each run carries a token from the page as the command's comment, so "Stop" can find and kill it.
const TOKEN_RE = /^qd-[a-z0-9]{8,40}$/;
const tokenOf = (t) => (typeof t === "string" && TOKEN_RE.test(t) ? t : undefined);
const toNum = (v) => (v && typeof v.toNumber === "function" ? v.toNumber() : Number(v || 0));
const isZero = (id) => !id || (typeof id.isZero === "function" ? id.isZero() : Number(id) === 0);

/**
 * Runs an aggregate command directly (the driver's aggregate() drops the comment) and returns
 * up to max documents. Longs are kept as Long so cursor ids stay exact.
 */
async function aggregateDocs(name, pipeline, max, comment) {
  const cmd = { aggregate: name, pipeline, cursor: { batchSize: max }, allowDiskUse: true, maxTimeMS: MAX_TIME_MS };
  if (comment) cmd.comment = comment;
  const opts = { promoteLongs: false };
  const res = await db().command(cmd, opts);
  let docs = res.cursor.firstBatch;
  let id = res.cursor.id;
  while (docs.length < max && !isZero(id)) {
    const more = await db().command({ getMore: id, collection: name, batchSize: max - docs.length, maxTimeMS: MAX_TIME_MS }, opts);
    docs = docs.concat(more.cursor.nextBatch);
    id = more.cursor.id;
  }
  if (!isZero(id)) await db().command({ killCursors: name, cursors: [id] }).catch(() => null);
  return docs;
}

async function countMatching(name, filter, { skip, limit } = {}, comment) {
  const pipeline = [{ $match: filter }];
  if (skip) pipeline.push({ $skip: skip });
  if (limit) pipeline.push({ $limit: limit });
  pipeline.push({ $group: { _id: 1, n: { $sum: 1 } } });
  const [row] = await aggregateDocs(name, pipeline, 1, comment);
  return row ? toNum(row.n) : 0;
}

async function distinctValues(name, key, filter, comment) {
  const cmd = { distinct: name, key, query: filter, maxTimeMS: MAX_TIME_MS };
  if (comment) cmd.comment = comment;
  return (await db().command(cmd)).values || [];
}
const clampPage = (n) => Math.max(0, parseInt(n, 10) || 0);
const clampSize = (n, max = MAX_PAGE_SIZE) => Math.min(max, Math.max(1, parseInt(n, 10) || 50));

/** Collections and views with an estimated document count. */
exports.collections = async function () {
  const infos = await db().listCollections({}, { nameOnly: false }).toArray();
  const list = infos
    .filter((c) => !c.name.startsWith("system.") || c.name === "system.profile")
    .map((c) => ({ name: c.name, type: c.type || "collection", count: null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Counts come from collection metadata (no scan); a few at a time to spare the server.
  for (let i = 0; i < list.length; i += 25) {
    await Promise.all(list.slice(i, i + 25).map(async (c) => {
      if (c.type !== "collection") return;
      c.count = await db().collection(c.name).estimatedDocumentCount({ maxTimeMS: 2000 }).catch(() => null);
    }));
  }
  return { db: db().databaseName, collections: list };
};

exports.indexes = async function (name) {
  const list = await db().collection(name).indexes();
  return list.map((ix) => ({
    name: ix.name,
    key: toTagged(ix.key),
    unique: !!ix.unique,
    sparse: !!ix.sparse,
    ttl: ix.expireAfterSeconds != null ? ix.expireAfterSeconds : null,
    partial: ix.partialFilterExpression ? toTagged(ix.partialFilterExpression) : null
  }));
};

const typeName = (v) => {
  if (v === null || v === undefined) return "Null";
  if (Array.isArray(v)) return "Array";
  if (v instanceof Date) return "Date";
  if (v instanceof RegExp) return "Regex";
  if (typeof v === "number") return Number.isInteger(v) ? "Int32" : "Double";
  if (typeof v === "string") return "String";
  if (typeof v === "boolean") return "Boolean";
  if (v._bsontype) return { ObjectID: "ObjectId", Long: "Int64" }[v._bsontype] || v._bsontype;
  return "Object";
};

/** Field paths and their types, from a random sample of the collection (for the builder and autocomplete). */
exports.schema = async function (name) {
  const docs = await db().collection(name)
    .aggregate([{ $sample: { size: SAMPLE_SIZE } }], { maxTimeMS: 10000, allowDiskUse: true })
    .toArray();
  const fields = {};
  const walk = (obj, prefix, depth) => {
    Object.keys(obj).forEach((k) => {
      const path = prefix ? prefix + "." + k : k;
      const v = obj[k];
      const t = typeName(v);
      const f = fields[path] || (fields[path] = { path, types: {}, count: 0 });
      f.types[t] = (f.types[t] || 0) + 1;
      f.count++;
      if (depth >= 4) return;
      if (t === "Object") walk(v, path, depth + 1);
      else if (t === "Array") v.slice(0, 5).forEach((el) => { if (typeName(el) === "Object") walk(el, path, depth + 1); });
    });
  };
  docs.forEach((d) => walk(d, "", 0));
  return {
    sampled: docs.length,
    fields: Object.values(fields)
      .map((f) => ({ path: f.path, count: f.count, type: Object.keys(f.types).sort((a, b) => f.types[b] - f.types[a])[0], types: f.types }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, MAX_FIELDS)
  };
};

/**
 * Runs a query and returns one page of results:
 * { collection, method, kind: 'docs' | 'value', docs | value, page, pageSize, offset, hasMore, ms }
 */
exports.run = async function ({ query, page, pageSize, token, search }, maxSize = MAX_PAGE_SIZE) {
  const q = applySearch(parse(query), search);
  // Personal data (patients / organisations) is censored unless an administrator switched it off.
  const censorOn = await censor.isOn();
  if (censorOn) censor.checkQuery(q);
  const comment = tokenOf(token);
  const coll = db().collection(q.collection);
  const size = clampSize(pageSize, maxSize);
  const offset = clampPage(page) * size;
  const started = Date.now();
  const result = { collection: q.collection, method: q.method, page: clampPage(page), pageSize: size, offset, hasMore: false };
  if (q.search) result.search = toTagged(q.search);   // the filter the whole-collection search added
  // The projection in effect, so the page's field picker can start from it.
  if (q.method === "find") result.projection = q.projection ? toTagged(q.projection) : null;
  if (q.method === "aggregate") {
    const last = q.pipeline[q.pipeline.length - 1];
    result.projection = last && last.$project ? toTagged(last.$project) : null;
    // Joined collections, so the field picker can offer their fields under the output name.
    result.lookups = q.pipeline
      .filter((st) => st.$lookup && typeof st.$lookup.from === "string" && typeof st.$lookup.as === "string")
      .map((st) => ({ from: st.$lookup.from, as: st.$lookup.as }));
  }

  if (q.method === "count") {
    result.kind = "value";
    result.value = await countMatching(q.collection, q.filter, {}, comment);
  } else if (q.method === "estimatedCount") {
    result.kind = "value";
    result.value = await coll.estimatedDocumentCount({ maxTimeMS: MAX_TIME_MS });
  } else {
    let docs = [];
    if (q.method === "find") {
      // limit(n) caps the whole result; pages are cut out of it.
      const take = q.limit ? Math.max(0, Math.min(size, q.limit - offset)) : size;
      if (take > 0) {
        const options = { skip: q.skip + offset, limit: take + 1, maxTimeMS: MAX_TIME_MS };
        if (comment) options.comment = comment;
        if (q.projection) options.projection = q.projection;
        if (q.sort) options.sort = q.sort;
        if (q.hint) options.hint = q.hint;
        docs = await coll.find(q.filter, options).toArray();
      }
      result.hasMore = docs.length > take && (!q.limit || offset + take < q.limit);
      docs = docs.slice(0, take);
    } else if (q.method === "aggregate") {
      docs = await aggregateDocs(q.collection, q.pipeline.concat([{ $skip: offset }, { $limit: size + 1 }]), size + 1, comment);
      result.hasMore = docs.length > size;
      docs = docs.slice(0, size);
    } else if (q.method === "distinct") {
      const values = await distinctValues(q.collection, q.field, q.filter, comment);
      result.total = values.length;
      result.field = q.field;
      docs = values.slice(offset, offset + size);
      result.hasMore = offset + size < values.length;
    }
    result.kind = "docs";
    result.docs = docs.map(toTagged);
    if (censorOn) result.docs = censor.maskResult(q, result.docs);
  }
  result.censor = { on: censorOn, applied: censorOn && (censor.touches(q) || !!q.censorDistinct) };
  result.ms = Date.now() - started;
  return result;
};

/** One batch of an export: the same as run, in bigger pages. */
exports.exportBatch = (args) => exports.run(args, MAX_EXPORT_BATCH);
exports.MAX_EXPORT_BATCH = MAX_EXPORT_BATCH;

/** Total documents the query matches (find honours skip / limit; aggregate counts its output). */
exports.count = async function ({ query, token, search }) {
  const q = applySearch(parse(query), search);
  const comment = tokenOf(token);
  const started = Date.now();
  let total;
  if (q.method === "find") {
    total = await countMatching(q.collection, q.filter, { skip: q.skip, limit: q.limit }, comment);
  } else if (q.method === "aggregate") {
    const [row] = await aggregateDocs(q.collection, q.pipeline.concat([{ $count: "n" }]), 1, comment);
    total = row ? toNum(row.n) : 0;
  } else if (q.method === "distinct") {
    total = (await distinctValues(q.collection, q.field, q.filter, comment)).length;
  } else {
    total = 1;
  }
  return { total, ms: Date.now() - started };
};

// Winning-plan stages, outermost first: FETCH > IXSCAN { orguid: 1 }
function planStages(plan) {
  const out = [];
  let node = plan;
  while (node) {
    const stage = node.stage || (node.queryPlan && node.queryPlan.stage);
    if (!stage) break;
    out.push({ stage, index: node.indexName || null, keyPattern: node.keyPattern ? toTagged(node.keyPattern) : null });
    node = node.inputStage || (node.inputStages && node.inputStages[0]) || (node.queryPlan && node.queryPlan.inputStage) || null;
  }
  return out;
}

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  if (obj[key]) return obj[key];
  for (const k of Object.keys(obj)) {
    const found = findKey(obj[k], key, depth + 1);
    if (found) return found;
  }
  return null;
}

/** explain("executionStats") with a summary: stages, index used, keys / docs examined, time. */
exports.explain = async function ({ query, search }) {
  const q = applySearch(parse(query), search);
  let command;
  if (q.method === "find") {
    command = { find: q.collection, filter: q.filter };
    if (q.projection) command.projection = q.projection;
    if (q.sort) command.sort = q.sort;
    if (q.skip) command.skip = q.skip;
    if (q.limit) command.limit = q.limit;
    if (q.hint) command.hint = q.hint;
  } else if (q.method === "aggregate") {
    command = { aggregate: q.collection, pipeline: q.pipeline, cursor: {}, allowDiskUse: true };
  } else if (q.method === "count") {
    command = { count: q.collection, query: q.filter };
  } else if (q.method === "distinct") {
    command = { distinct: q.collection, key: q.field, query: q.filter };
  } else {
    command = { count: q.collection };
  }
  const raw = await db().command({ explain: command, verbosity: "executionStats" }, { maxTimeMS: MAX_TIME_MS });
  const planner = findKey(raw, "queryPlanner") || {};
  const stats = findKey(raw, "executionStats") || {};
  const stages = planStages(planner.winningPlan);
  return {
    collection: q.collection,
    method: q.method,
    summary: {
      stages,
      index: (stages.find((s) => s.index) || {}).index || null,
      collscan: stages.some((s) => s.stage === "COLLSCAN"),
      nReturned: stats.nReturned != null ? stats.nReturned : null,
      keysExamined: stats.totalKeysExamined != null ? stats.totalKeysExamined : null,
      docsExamined: stats.totalDocsExamined != null ? stats.totalDocsExamined : null,
      timeMs: stats.executionTimeMillis != null ? stats.executionTimeMillis : null
    },
    raw: toTagged(raw)
  };
};

/** Stops a running query: kills this app's operations tagged with the page's token. */
exports.kill = async function ({ token }) {
  const t = tokenOf(token);
  if (!t) return { killed: 0 };
  const res = await admin().command({
    currentOp: 1,
    $ownOps: true,
    $or: [{ "command.comment": t }, { "cursor.originatingCommand.comment": t }, { "originatingCommand.comment": t }]
  });
  const ops = res.inprog || [];
  await Promise.all(ops.map((op) => admin().command({ killOp: 1, op: op.opid }).catch(() => null)));
  return { killed: ops.length };
};
