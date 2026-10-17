const si = require('systeminformation');
const { cached } = require('./cache.util');
const config = require('../config');

// Deliberately NOT using si.powerShellStart(): piping every WMI query through one long-
// lived PowerShell child sounds like the obvious Windows optimisation, but measured on
// systeminformation 5.33 it buys nothing (currentLoad 517 ms with the session vs 511 ms
// without, networkConnections 108 ms vs 63 ms) and si.processes() never returns at all
// under it. Caching is where the Windows win actually comes from, and it costs no
// resident PowerShell process.

// systeminformation has no cache of its own. Every call does real work on both platforms:
// on Windows it shells out to WMI/PowerShell (1-2 s each), on Linux it walks /proc and /sys
// (cheaper, but a full process table is still thousands of file reads). They were being
// re-read on every dashboard load, app detail view and monitor poll.
//
// The TTLs below match how fast each value can realistically change. Nothing here is
// uncached: even the "cheap" probes are cheap only relative to the expensive ones, and the
// agent is polled on a timer by possibly several dashboards at once.
const HOUR = 60 * 60 * 1000;

/* -- Cached probes --------------------------------------------------------- */

// Hardware and OS identity: fixed for the lifetime of the process.
const cpuInfo = cached(() => si.cpu(), { freshMs: HOUR });
const osInfo = cached(() => si.osInfo(), { freshMs: HOUR });

// Addresses change only when someone reconfigures the network.
const networkInterfaces = cached(() => si.networkInterfaces(), { freshMs: 60 * 1000, staleMs: 60 * 1000 });

// Disk usage moves slowly; memory is the one metric worth keeping near-live.
const fsSize = cached(() => si.fsSize(), { freshMs: 15 * 1000, staleMs: 30 * 1000 });
const mem = cached(() => si.mem(), { freshMs: 2 * 1000 });

// currentLoad diffs two CPU-time samples, so it is genuinely expensive on Windows (a WMI
// round trip) and non-trivial on Linux. The dashboard polls it on a timer and no human
// distinguishes a 1 s old load figure from a live one.
const currentLoad = cached(() => si.currentLoad(), {
    freshMs: config.CACHE.CURRENT_LOAD,
    staleMs: config.CACHE.CURRENT_LOAD * 2
});

// The full socket table: `netstat -ano` on Windows, /proc/net/{tcp,tcp6} plus an inode->pid
// walk over /proc/*/fd on Linux. Both are heavy, and listening ports barely change.
const networkConnections = cached(() => si.networkConnections(), {
    freshMs: config.CACHE.CONNECTIONS,
    staleMs: config.CACHE.CONNECTIONS * 3
});

// The single most expensive probe the agent can make — a full process table walk. Its route
// carries a tighter rate limit for that reason; caching means even a caller sitting on that
// limit costs one walk per TTL rather than thirty a minute.
const processes = cached(() => si.processes(), {
    freshMs: config.CACHE.PROCESSES,
    staleMs: config.CACHE.PROCESSES * 3
});

const isWindows = async () => (await osInfo()).platform.toLowerCase().includes('win');

// Default network IP, used for the app URLs shown in the UI.
const defaultIp = async () => {
    const networks = await networkInterfaces();
    return networks.filter(n => n.default)[0]?.ip4 || 'localhost';
};

// Warms the probes whose values never change, so the first dashboard request does not pay
// for CPU/OS identity discovery. Failures are ignored: a cold cache is not a start-up error.
const warmUp = () => Promise.allSettled([cpuInfo(), osInfo(), networkInterfaces()]);

module.exports = {
    cpuInfo,
    osInfo,
    networkInterfaces,
    fsSize,
    mem,
    currentLoad,
    networkConnections,
    processes,
    isWindows,
    defaultIp,
    warmUp,
    // Wall-clock and timezone: a plain Date read, no probing.
    time: () => si.time()
};
