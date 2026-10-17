const { cached } = require('../../utils/cache.util');
const { safeExecFile } = require('../../utils/exec.util');
const { isValidAppName } = require('../../utils/app-name.util');
const { bytesToSize, timeSince } = require('./ux.helper');
const client = require('./client');
const config = require('../../config');

// Process identifiers reaching PM2 come from HTTP params — same shape the routes validate
// (alphanumeric, _ . , : -) or a plain pm_id.
function assertProcess(process) {
    const id = typeof process === 'number' ? String(process) : process;
    if (!isValidAppName(id)) {
        throw new Error('Invalid PM2 process identifier');
    }
    return id;
}

// PM2 hands back every app's full environment on every listing — on a box with a few dozen
// apps that is megabytes of strings the agent would otherwise pin in its cache for the
// whole TTL. Project each entry down to the fields any endpoint actually reads, once, at
// ingest: the cache then holds a few hundred bytes per app instead of tens of kilobytes.
const slim = (app) => {
    const env = app.pm2_env || {};
    const monit = app.monit || {};
    return {
        name: app.name,
        pm_id: app.pm_id,
        cpu: monit.cpu || 0,
        memoryBytes: monit.memory || 0,
        status: env.status,
        pm_uptime: env.pm_uptime,
        restart_time: env.restart_time,
        node_args: env.node_args,
        node_version: env.node_version,
        pm_out_log_path: env.pm_out_log_path,
        pm_err_log_path: env.pm_err_log_path,
        pm_cwd: env.pm_cwd,
        pm_exec_path: env.pm_exec_path,
        env_file: env.env_file || null
    };
};

// Log paths, cwd and exec path are fixed for the life of a PM2 process. The log view polls
// every 3 s and needs nothing else about the app, so those few strings are kept in an index
// that survives the (deliberately short) list cache — a live log tail then costs one file
// read and no PM2 round trip at all.
const pathIndex = new Map();

const indexPaths = (apps) => {
    const now = Date.now();
    pathIndex.clear();
    for (const app of apps) {
        const entry = {
            pm_out_log_path: app.pm_out_log_path,
            pm_err_log_path: app.pm_err_log_path,
            pm_cwd: app.pm_cwd,
            pm_exec_path: app.pm_exec_path,
            env_file: app.env_file,
            indexedAt: now
        };
        pathIndex.set(app.name, entry);
        pathIndex.set(String(app.pm_id), entry);
    }
};

const listRaw = async () => {
    const apps = (await client.listRaw()).map(slim);
    indexPaths(apps);
    return apps;
};

// One PM2 read is shared by every endpoint and every concurrent caller. The short fresh
// window keeps status/cpu/memory live; the stale window means a poll never *waits* on PM2,
// it gets the last value and a refresh happens behind it.
const listCached = cached(listRaw, {
    freshMs: config.CACHE.PM2_LIST_FRESH,
    staleMs: config.CACHE.PM2_LIST_STALE,
    // With PM2 down every endpoint fails, including the unauthenticated /health a
    // dashboard polls on a timer. Hold the failure briefly so a dead daemon is dialled
    // once every few seconds rather than once per inbound request.
    errorMs: 5000
});

// Mapping the slim list into the dashboard's shape is pure and depends only on the array
// identity, so memoise it against that array: repeat polls inside one cache window reuse
// the formatted result instead of re-running bytesToSize/timeSince for every app.
const listAppsMemo = new WeakMap();

async function listApps() {
    const apps = await listCached();
    const memo = listAppsMemo.get(apps);
    if (memo) return memo;

    const env = config.APP_ENV.toUpperCase();
    const mapped = apps.map(app => ({
        name: app.name,
        status: app.status,
        cpu: app.cpu,
        memory: bytesToSize(app.memoryBytes),
        uptime: timeSince(app.pm_uptime),
        pm_id: app.pm_id,
        restarts: app.restart_time,
        node_args: app.node_args,
        env
    }));
    listAppsMemo.set(apps, mapped);
    return mapped;
}

async function describeApp(appName) {
    const name = assertProcess(appName);
    // `pm2 describe` only renders a human table, so read the same data from the listing.
    const apps = await listCached();
    const app = apps.find(a => a.name === name || String(a.pm_id) === name);
    if (!app) return null;
    return {
        name: app.name,
        status: app.status,
        cpu: app.cpu,
        memory: app.memoryBytes,
        uptime: timeSince(app.pm_uptime),
        pm_id: app.pm_id,
        pm_out_log_path: app.pm_out_log_path,
        pm_err_log_path: app.pm_err_log_path,
        pm2_env_cwd: app.pm_cwd,
        project_path: app.pm_cwd,
        exec_path: app.pm_exec_path,
        env_file: app.env_file,
        node_version: app.node_version,
        node_args: app.node_args,
        restart_time: app.restart_time,
        restarts: app.restart_time,
        env: config.APP_ENV.toUpperCase()
    };
}

// Everything the log endpoint needs, and nothing that would make it pay for a PM2 listing.
// A hit inside the index TTL answers without touching PM2; anything else falls through to
// the shared list, which also re-fills the index.
async function appPaths(appName) {
    const name = assertProcess(appName);
    const hit = pathIndex.get(name);
    if (hit && Date.now() - hit.indexedAt < config.CACHE.PM2_PATHS_FRESH) return hit;

    await listCached();
    return pathIndex.get(name) || null;
}

// The CLI's own rendering of `pm2 describe` — a human-readable table the dashboard shows
// verbatim, unlike describeApp() which reads the same facts out of the listing as fields.
// It is the one call with no API equivalent, so it still spawns; a few seconds of caching
// keeps a reloading detail page from spawning one PM2 process per refresh.
const describeRawCaches = new Map();

async function describeAppRaw(appName) {
    const name = assertProcess(appName);
    let entry = describeRawCaches.get(name);
    if (!entry) {
        // Bound the map the same way the path index is bounded by the real app count:
        // names are validated and only ever come from an app that exists.
        if (describeRawCaches.size >= 128) describeRawCaches.clear();
        entry = cached(() => client.describeRaw(name), { freshMs: config.CACHE.DESCRIBE_RAW });
        describeRawCaches.set(name, entry);
    }
    return entry();
}

// Callers treat a non-empty array as success — a PM2 refusal rejects instead. Every cache
// derived from the process list is dropped straight after, so the next read reflects the
// change instead of the pre-action snapshot.
async function runAction(action, process) {
    const target = assertProcess(process);
    console.log(`pm2 ${action} : ${target}`);
    await client.runAction(action, target);
    listCached.invalidate();
    pathIndex.clear();
    describeRawCaches.delete(target);
    return [{ name: target }];
}

const reloadApp = (process) => runAction('reload', process);
const restartApp = (process) => runAction('restart', process);
const stopApp = (process) => runAction('stop', process);
// `pm2 reset` zeroes the counters PM2 keeps about a process (restart count, uptime);
// the process itself keeps running untouched.
const resetApp = (process) => runAction('reset', process);
const deleteApp = (process) => runAction('delete', process);
// `pm2 flush` truncates the app's stdout/stderr files.
const flushApp = (process) => runAction('flush', process);

// The node on PATH is what the monitored apps run under, which is not necessarily the one
// running the agent — so it is still read from the CLI. It cannot change under a running
// process, so the spawn happens once for the lifetime of the agent and never again.
const nodeInfo = cached(async () => {
    const stdout = await safeExecFile('node', ['-v']);
    return { node: stdout.trim() };
}, { freshMs: Infinity });

// Whether the PM2 daemon answers at all — reported by /health so a dashboard can tell
// "agent down" apart from "PM2 down on an otherwise healthy box". /health is the one
// unauthenticated endpoint, so it must never be able to *cause* a PM2 read: a cached
// listing answers it, and only when there is nothing cached at all is PM2 actually probed.
const pm2Available = async () => {
    if (listCached.peek() !== undefined) return true;
    try {
        await listCached();
        return true;
    } catch (_) {
        return false;
    }
};

module.exports = {
    listApps,
    describeApp,
    describeAppRaw,
    appPaths,
    reloadApp,
    restartApp,
    stopApp,
    resetApp,
    deleteApp,
    flushApp,
    nodeInfo,
    pm2Available,
    transport: client.transport,
    disconnect: client.disconnect,
    invalidate: () => { listCached.invalidate(); pathIndex.clear(); describeRawCaches.clear(); }
};
