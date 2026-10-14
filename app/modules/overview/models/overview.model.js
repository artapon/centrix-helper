const mongoose = require("mongoose");
const moment = require("moment-timezone");

// MongoDB monitoring for the Overview dashboard (the Studio 3T "Monitoring" menu as charts):
// server status, mongostat, mongotop, in-progress operations, lock status, database sizes,
// replica set / sharding status, profiler and the recent mongod log.
// Each section fails on its own (e.g. a user without clusterMonitor) as { error }.

const TZ = "Asia/Bangkok";
const SYSTEM_DBS = ["admin", "local", "config"];
const LOG_LIMIT = 300;
const COMMAND_LIMIT = 50000; // characters of an operation's command sent to the page

const db = () => mongoose.connection.db;
const admin = () => mongoose.connection.db.admin();

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: err.codeName || err.message || String(err) };
  }
}

const num = (v) => (v == null ? 0 : Number(v));

/** Compact serverStatus sample; the page turns two samples into mongostat rates. */
function statSample(s) {
  const wt = s.wiredTiger && s.wiredTiger.cache;
  const op = s.opcounters || {};
  const gl = s.globalLock || {};
  return {
    at: new Date(s.localTime || Date.now()).getTime(),
    host: s.host,
    version: s.version,
    process: s.process,
    uptime: num(s.uptime),
    storageEngine: s.storageEngine ? s.storageEngine.name : "",
    opcounters: {
      insert: num(op.insert), query: num(op.query), update: num(op.update),
      delete: num(op.delete), getmore: num(op.getmore), command: num(op.command)
    },
    connections: {
      current: num(s.connections && s.connections.current),
      available: num(s.connections && s.connections.available),
      active: num(s.connections && s.connections.active),
      totalCreated: num(s.connections && s.connections.totalCreated)
    },
    network: { bytesIn: num(s.network && s.network.bytesIn), bytesOut: num(s.network && s.network.bytesOut) },
    mem: { resident: num(s.mem && s.mem.resident), virtual: num(s.mem && s.mem.virtual) },
    cache: wt ? {
      used: num(wt["bytes currently in the cache"]),
      dirty: num(wt["tracked dirty bytes in the cache"]),
      max: num(wt["maximum bytes configured"])
    } : null,
    globalLock: {
      queueReaders: num(gl.currentQueue && gl.currentQueue.readers),
      queueWriters: num(gl.currentQueue && gl.currentQueue.writers),
      activeReaders: num(gl.activeClients && gl.activeClients.readers),
      activeWriters: num(gl.activeClients && gl.activeClients.writers)
    },
    locks: Object.keys(s.locks || {}).map((name) => {
      const l = s.locks[name] || {};
      const total = (o) => Object.values(o || {}).reduce((t, v) => t + num(v), 0);
      return {
        name,
        acquire: total(l.acquireCount),
        wait: total(l.acquireWaitCount),
        waitMicros: total(l.timeAcquiringMicros)
      };
    }),
    asserts: s.asserts || {},
    repl: s.repl ? { setName: s.repl.setName, primary: s.repl.primary, me: s.repl.me, isWritablePrimary: !!(s.repl.ismaster || s.repl.isWritablePrimary) } : null
  };
}

exports.getServerStatus = () => safe(async () => statSample(await admin().command({ serverStatus: 1 })));

// mongotop: `top` is cumulative, so keep the previous sample per server and report the
// read / write time spent per collection since then, normalised to milliseconds per second.
let lastTop = null;

exports.getTop = () => safe(async () => {
  const key = mongoose.connection.host + "/" + mongoose.connection.name;
  const totals = (await admin().command({ top: 1 })).totals || {};
  const now = Date.now();
  const sample = {};
  Object.keys(totals).forEach((ns) => {
    const t = totals[ns];
    if (ns === "note" || !t || !t.total) return;
    if (SYSTEM_DBS.includes(ns.split(".")[0])) return;
    sample[ns] = { read: num(t.readLock.time), write: num(t.writeLock.time), total: num(t.total.time) };
  });

  const prev = lastTop && lastTop.key === key ? lastTop : null;
  lastTop = { key, at: now, sample };
  if (!prev || now - prev.at < 500) return { collecting: true, rows: [] };

  const secs = (now - prev.at) / 1000;
  const rows = Object.keys(sample)
    .map((ns) => {
      const p = prev.sample[ns] || { read: 0, write: 0, total: 0 };
      // micros -> ms, per second of wall time
      const rate = (a, b) => Math.max(0, (a - b) / 1000 / secs);
      return { ns, read: rate(sample[ns].read, p.read), write: rate(sample[ns].write, p.write), total: rate(sample[ns].total, p.total) };
    })
    // "other": time top counts for the collection outside its read / write locks, so busy
    // collections never draw as empty bars.
    .map((r) => ({
      ns: r.ns,
      read: +r.read.toFixed(2),
      write: +r.write.toFixed(2),
      other: +Math.max(0, r.total - r.read - r.write).toFixed(2),
      total: +r.total.toFixed(2)
    }))
    // Rounded first, so collections whose activity rounds to 0 ms/s are not drawn as empty bars.
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  return { collecting: false, seconds: +secs.toFixed(1), rows };
});

/** In-progress operations (active, excluding this monitor's own currentOp). */
exports.getCurrentOps = () => safe(async () => {
  const res = await admin().command({ currentOp: 1, active: true });
  return (res.inprog || [])
    .filter((op) => !(op.command && op.command.currentOp))
    .map((op) => {
      const cmd = op.command || op.query || {};
      let text = "";
      try { text = JSON.stringify(cmd); } catch (e) { text = ""; }
      // The full command opens in a popup from the operations table.
      if (text.length > COMMAND_LIMIT) text = text.slice(0, COMMAND_LIMIT);
      return {
        opid: String(op.opid),
        op: op.op || "",
        ns: op.ns || "",
        secs: num(op.secs_running),
        micros: num(op.microsecs_running),
        client: op.client || op.client_s || "",
        appName: op.appName || "",
        desc: op.desc || "",
        user: op.effectiveUsers && op.effectiveUsers[0] ? op.effectiveUsers[0].user : "",
        planSummary: op.planSummary || "",
        waitingForLock: !!op.waitingForLock,
        command: text,
        commandTruncated: text.length >= COMMAND_LIMIT
      };
    })
    .sort((a, b) => b.micros - a.micros)
    .slice(0, 50);
});

/** Show Database Name And Storage Size. */
exports.getDatabases = () => safe(async () => {
  const list = await admin().listDatabases();
  const stats = await Promise.all((list.databases || []).map((d) =>
    mongoose.connection.client.db(d.name).stats()
      .then((s) => ({
        name: d.name,
        collections: num(s.collections),
        objects: num(s.objects),
        dataSize: num(s.dataSize),
        storageSize: num(s.storageSize),
        indexSize: num(s.indexSize),
        sizeOnDisk: num(d.sizeOnDisk)
      }))
      .catch(() => ({ name: d.name, collections: 0, objects: 0, dataSize: 0, storageSize: 0, indexSize: 0, sizeOnDisk: num(d.sizeOnDisk) }))
  ));
  return stats.sort((a, b) => (b.storageSize + b.indexSize) - (a.storageSize + a.indexSize));
});

/** Replica Set Status: members with replication lag behind the primary. */
exports.getReplicaSet = () => safe(async () => {
  const rs = await admin().command({ replSetGetStatus: 1 });
  const optime = (m) => (m.optimeDate ? new Date(m.optimeDate).getTime() : null);
  const primary = (rs.members || []).find((m) => m.stateStr === "PRIMARY");
  const primaryOptime = primary ? optime(primary) : null;
  return {
    set: rs.set,
    date: rs.date,
    members: (rs.members || []).map((m) => ({
      name: m.name,
      state: m.stateStr,
      health: num(m.health),
      uptime: num(m.uptime),
      self: !!m.self,
      pingMs: m.pingMs != null ? num(m.pingMs) : null,
      syncSource: m.syncSourceHost || m.syncingTo || "",
      optimeDate: m.optimeDate || null,
      lagSecs: primaryOptime != null && optime(m) != null ? Math.max(0, (primaryOptime - optime(m)) / 1000) : null,
      message: m.lastHeartbeatMessage || m.infoMessage || ""
    }))
  };
});

/** Sharding Status: only a mongos router answers; a plain mongod is reported as not sharded. */
exports.getSharding = () => safe(async () => {
  const hello = await admin().command({ isMaster: 1 });
  if (hello.msg !== "isdbgrid") return { sharded: false };
  const [shards, balancer, dbs] = await Promise.all([
    admin().command({ listShards: 1 }),
    admin().command({ balancerStatus: 1 }).catch(() => null),
    mongoose.connection.client.db("config").collection("databases").find({}).toArray().catch(() => [])
  ]);
  return {
    sharded: true,
    shards: (shards.shards || []).map((s) => ({ id: s._id, host: s.host, state: s.state })),
    balancer: balancer ? { mode: balancer.mode, inBalancerRound: !!balancer.inBalancerRound } : null,
    databases: dbs.map((d) => ({ name: d._id, primary: d.primary, partitioned: !!d.partitioned }))
  };
});

/** Database Profiler for the connected database: level, slowms and the latest profiled ops. */
exports.getProfiler = () => safe(async () => {
  const level = await db().command({ profile: -1 });
  let ops = [];
  if (level.was > 0) {
    ops = (await db().collection("system.profile").find({}).sort({ ts: -1 }).limit(20).toArray())
      .map((p) => ({
        ts: p.ts,
        op: p.op,
        ns: p.ns,
        millis: num(p.millis),
        docsExamined: num(p.docsExamined),
        nreturned: num(p.nreturned),
        planSummary: p.planSummary || "",
        client: p.client || ""
      }));
  }
  return { db: mongoose.connection.name, level: level.was, slowms: level.slowms, sampleRate: level.sampleRate, ops };
});

// attr.client is an address on auth events but the connection name ("conn123") on "client metadata".
const isAddress = (v) => typeof v === "string" && /:\d+$/.test(v) && !/^conn\d+$/.test(v);
const remoteOf = (attr) => (attr && (attr.remote || (isAddress(attr.client) ? attr.client : ""))) || "";
const appOf = (attr) => (attr && (attr.appName || (attr.doc && attr.doc.application && attr.doc.application.name))) || "";

/**
 * Client address and app name per connection ("conn123"): open connections from currentOp,
 * then the log's own "Connection accepted" / "client metadata" events for closed ones.
 */
async function connectionMap(events) {
  const map = {};
  const set = (conn, client, appName) => {
    if (!conn) return;
    const c = map[conn] || (map[conn] = { client: "", appName: "" });
    if (client && !c.client) c.client = client;
    if (appName && !c.appName) c.appName = appName;
  };
  const ops = await admin().command({ currentOp: 1, $all: true }).catch(() => ({ inprog: [] }));
  (ops.inprog || []).forEach((op) => {
    const conn = op.desc || (op.connectionId != null ? "conn" + op.connectionId : "");
    if (/^conn\d+$/.test(conn)) set(conn, op.client, op.appName);
  });
  events.forEach((e) => {
    if (!e.attr) return;
    if (e.msg === "Connection accepted" && e.attr.connectionId != null) set("conn" + e.attr.connectionId, e.attr.remote, "");
    else set(e.ctx, remoteOf(e.attr), appOf(e.attr));
  });
  return map;
}

/** Log Viewer: the most recent mongod events (getLog keeps the last 1024), with client and app. */
exports.getLog = () => safe(async () => {
  const lines = (await admin().command({ getLog: "global" })).log || [];
  const events = lines.map((line) => {
    try {
      return JSON.parse(line); // 4.4+ structured log
    } catch (err) {
      return { msg: line, plain: true };
    }
  });
  const conns = await connectionMap(events);

  return events.slice(-LOG_LIMIT).reverse().map((e) => {
    if (e.plain) return { t: "", s: "", c: "", ctx: "", msg: e.msg, durationMillis: null, ns: "", client: "", appName: "", attr: "", attrTruncated: false };
    const attr = e.attr ? JSON.stringify(e.attr) : "";
    const conn = conns[e.ctx] || {};
    return {
      t: e.t && e.t.$date ? e.t.$date : "",
      s: e.s || "",
      c: e.c || "",
      ctx: e.ctx || "",
      msg: e.msg || "",
      durationMillis: e.attr && e.attr.durationMillis != null ? num(e.attr.durationMillis) : null,
      ns: e.attr && e.attr.ns ? e.attr.ns : "",
      client: remoteOf(e.attr) || conn.client || "",
      appName: appOf(e.attr) || conn.appName || "",
      attr: attr.slice(0, COMMAND_LIMIT), // shown formatted in a popup
      attrTruncated: attr.length > COMMAND_LIMIT
    };
  });
});

/** More Server Info: build and host. */
exports.getServerInfo = () => safe(async () => {
  const [build, host] = await Promise.all([
    admin().command({ buildInfo: 1 }),
    admin().command({ hostInfo: 1 }).catch(() => null)
  ]);
  return {
    version: build.version,
    gitVersion: build.gitVersion,
    modules: build.modules || [],
    os: host && host.os ? [host.os.name, host.os.version].filter(Boolean).join(" ") : "",
    hostname: host && host.system ? host.system.hostname : "",
    cpuCores: host && host.system ? host.system.numCores : null,
    memSizeMB: host && host.system ? host.system.memSizeMB : null,
    cpuArch: host && host.system ? host.system.cpuArch : ""
  };
});

/** Polled every few seconds: mongostat, mongotop, in-progress operations, locks. */
exports.live = async function () {
  const [status, top, ops] = await Promise.all([exports.getServerStatus(), exports.getTop(), exports.getCurrentOps()]);
  return { status, top, ops };
};

/**
 * Today's Centrix login sessions (by last activity), counted per 30 minutes in Bangkok time:
 * { total, buckets: [{ slot, count }] } where slot 0 = 00:00, 1 = 00:30 … 47 = 23:30.
 */
exports.getLoginSessions = () => safe(async () => {
  const start = moment().tz(TZ).startOf("day");
  const rows = await db().collection("loginsessions").aggregate([
    { $match: { statusflag: "A", lastactivitydate: { $gte: start.toDate(), $lte: start.clone().endOf("day").toDate() } } },
    { $project: { p: { $dateToParts: { date: "$lastactivitydate", timezone: TZ } } } },
    { $group: { _id: { $add: [{ $multiply: ["$p.hour", 2] }, { $cond: [{ $gte: ["$p.minute", 30] }, 1, 0] }] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ], { maxTimeMS: 15000 }).toArray();
  const buckets = rows.map((r) => ({ slot: r._id, count: r.count }));
  return { total: buckets.reduce((t, b) => t + b.count, 0), buckets };
});

/** Refreshed on demand / every minute: logins, sizes, replica set, sharding, profiler, log, server info. */
exports.details = async function () {
  const [logins, databases, replicaSet, sharding, profiler, log, serverInfo] = await Promise.all([
    exports.getLoginSessions(), exports.getDatabases(), exports.getReplicaSet(), exports.getSharding(),
    exports.getProfiler(), exports.getLog(), exports.getServerInfo()
  ]);
  return { logins, databases, replicaSet, sharding, profiler, log, serverInfo };
};
