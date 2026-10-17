const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { safeExecFile } = require('../../utils/exec.util');

// Two ways to read PM2, picked once at start-up and re-picked if the first stops working.
//
//   api — require the pm2 module already installed on this machine and talk to the running
//         daemon over its RPC socket. A listing answers in single-digit milliseconds.
//   cli — spawn `pm2 jlist` and parse stdout. Correct everywhere, but a full Node start-up
//         (~1 s wall, ~40 MB RSS) for every read. With a dashboard polling logs every 3 s
//         that is a process spawn every three seconds, forever.
//
// `auto` (the default) prefers the API and silently falls back to the CLI when the pm2
// module cannot be found or the daemon refuses to talk to it.

const PM2_BIN = 'pm2';

// `pm2 jlist` embeds each app's full environment, so the payload grows fast.
// Default execFile maxBuffer (1 MB) is not enough once a handful of apps run.
const JLIST_MAX_BUFFER = 10 * 1024 * 1024;

// After the API path fails, stop retrying it for this long. Reconnect attempts against a
// daemon that is down are exactly the kind of per-request work this module exists to avoid.
const API_COOLDOWN_MS = 60 * 1000;

/* -- Locating the pm2 module ----------------------------------------------- */

const isPm2Package = (dir) => {
    try {
        return fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'index.js'));
    } catch (_) {
        return false;
    }
};

// The `pm2` on PATH is the installed package's own bin script: on Linux a symlink into
// <prefix>/lib/node_modules/pm2/bin/pm2, on Windows a .cmd shim sitting next to
// node_modules\pm2. Resolving it covers nvm, fnm, Volta and a plain `npm i -g` alike,
// which no hard-coded prefix list does.
const fromPathLookup = () => {
    const exts = config.IS_WINDOWS ? ['.cmd', '.CMD', '.exe', ''] : [''];
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);

    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = path.join(dir, PM2_BIN + ext);
            if (!fs.existsSync(candidate)) continue;
            let real = candidate;
            try { real = fs.realpathSync(candidate); } catch (_) { /* keep the shim path */ }
            // <root>/bin/pm2  ->  <root>
            const viaBin = path.resolve(path.dirname(real), '..');
            if (isPm2Package(viaBin)) return viaBin;
            // <dir>/pm2.cmd  ->  <dir>/node_modules/pm2
            const viaShim = path.join(path.dirname(candidate), 'node_modules', PM2_BIN);
            if (isPm2Package(viaShim)) return viaShim;
        }
    }
    return null;
};

const globalPrefixCandidates = () => {
    const nodeDir = path.dirname(process.execPath);
    const prefixes = [
        process.env.PM2_MODULE_PATH,
        process.env.npm_config_prefix,
        config.IS_WINDOWS ? nodeDir : path.resolve(nodeDir, '..'),
        config.IS_WINDOWS ? path.join(process.env.APPDATA || '', 'npm') : null,
        config.IS_WINDOWS ? null : '/usr/local',
        config.IS_WINDOWS ? null : '/usr',
        config.IS_WINDOWS ? null : path.join(process.env.HOME || '', '.npm-global')
    ].filter(Boolean);

    const out = [];
    for (const prefix of prefixes) {
        // A PM2_MODULE_PATH pointing straight at the package is honoured as-is.
        out.push(prefix);
        out.push(path.join(prefix, 'node_modules', PM2_BIN));
        out.push(path.join(prefix, 'lib', 'node_modules', PM2_BIN));
    }
    return out;
};

const resolvePm2Module = () => {
    // A pm2 listed in the agent's own dependencies wins — nothing to guess.
    try { return path.dirname(require.resolve('pm2/package.json')); } catch (_) { /* not local */ }

    for (const candidate of globalPrefixCandidates()) {
        if (isPm2Package(candidate)) return candidate;
    }
    return fromPathLookup();
};

/* -- API transport --------------------------------------------------------- */

let pm2Api = null;          // the required module, once
let connectPromise = null;  // single-flight connect
let connected = false;
let apiDisabledUntil = 0;
let modePicked = null;      // 'api' | 'cli', for /health and logging

const wantsApi = () => config.PM2_MODE === 'api' || config.PM2_MODE === 'auto';

const disableApi = (reason) => {
    if (config.PM2_MODE === 'api') {
        // Explicitly pinned to the API: say so loudly instead of quietly degrading.
        console.error(`[agent] PM2 API unavailable (${reason}) - AGENT_PM2_MODE=api, falling back to the CLI anyway`);
    } else {
        console.warn(`[agent] PM2 API unavailable (${reason}) - using the pm2 CLI for the next ${API_COOLDOWN_MS / 1000}s`);
    }
    connected = false;
    apiDisabledUntil = Date.now() + API_COOLDOWN_MS;
    modePicked = 'cli';
};

const loadApi = () => {
    if (pm2Api) return pm2Api;
    const modulePath = resolvePm2Module();
    if (!modulePath) return null;
    // Requiring pm2 in-process costs ~30 MB RSS but removes a ~40 MB, ~1 s spawn from
    // every single read. AGENT_PM2_MODE=cli opts out on a memory-tight box.
    pm2Api = require(modulePath);
    console.log(`[agent] PM2 API loaded from ${modulePath}`);
    return pm2Api;
};

const connect = () => {
    if (connected) return Promise.resolve(pm2Api);
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
        let api;
        try {
            api = loadApi();
        } catch (err) {
            return reject(new Error(`pm2 module failed to load: ${err.message}`));
        }
        if (!api) return reject(new Error('pm2 module not found'));

        // No argument = connect to (and if necessary start) the shared daemon. Passing
        // `true` here would run PM2 *inside* this process, which is emphatically not what
        // a monitoring agent should do.
        api.connect((err) => {
            if (err) return reject(err instanceof Error ? err : new Error(String(err)));
            connected = true;
            modePicked = 'api';
            resolve(api);
        });
    });

    const settled = connectPromise;
    settled.catch(() => {}).then(() => { if (connectPromise === settled) connectPromise = null; });

    return connectPromise;
};

const call = (method, ...args) => new Promise((resolve, reject) => {
    pm2Api[method](...args, (err, result) => {
        if (err) return reject(err instanceof Error ? err : new Error(err && err.message ? err.message : String(err)));
        resolve(result);
    });
});

const apiUsable = () => wantsApi() && Date.now() >= apiDisabledUntil;

/* -- CLI transport --------------------------------------------------------- */

const cli = (args, options = {}) => safeExecFile(PM2_BIN, args, options);

// `pm2 jlist` prints JSON on stdout, but PM2 can prepend banner/daemon-spawn
// noise on first connect — slice to the outermost array before parsing.
const cliList = async () => {
    const stdout = await cli(['jlist'], { maxBuffer: JLIST_MAX_BUFFER });
    const start = stdout.indexOf('[');
    const end = stdout.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {
        throw new Error('Unexpected output from `pm2 jlist`');
    }
    const apps = JSON.parse(stdout.slice(start, end + 1));
    return Array.isArray(apps) ? apps : [];
};

/* -- Public surface -------------------------------------------------------- */

// The raw PM2 process list, from whichever transport is working.
const listRaw = async () => {
    if (apiUsable()) {
        try {
            await connect();
            const apps = await call('list');
            return Array.isArray(apps) ? apps : [];
        } catch (err) {
            disableApi(err.message);
        }
    }
    modePicked = modePicked || 'cli';
    return cliList();
};

// The action words PM2 exposes as API methods and accepts as CLI subcommands alike, so
// one table drives both transports.
const ACTIONS = new Set(['reload', 'restart', 'stop', 'delete', 'reset', 'flush']);

const runAction = async (action, target) => {
    if (!ACTIONS.has(action)) throw new Error(`Unsupported PM2 action: ${action}`);

    if (apiUsable()) {
        try {
            await connect();
            await call(action, target);
            return;
        } catch (err) {
            // A genuine PM2 refusal ("process not found") must surface as an error, not be
            // retried through the CLI as though the transport were at fault.
            if (/not found|not exist/i.test(err.message)) throw err;
            disableApi(err.message);
        }
    }
    await cli([action, target]);
};

// `pm2 describe` renders a human-readable table that only the CLI produces.
const describeRaw = (target) => cli(['describe', target]);

const transport = () => modePicked || (wantsApi() ? 'api (pending)' : 'cli');

const disconnect = () => {
    if (!connected || !pm2Api) return;
    connected = false;
    try { pm2Api.disconnect(); } catch (_) { /* shutting down anyway */ }
};

module.exports = {
    listRaw,
    runAction,
    describeRaw,
    transport,
    disconnect,
    // exported for the start-up probe in app.js
    resolvePm2Module,
    wantsApi
};
