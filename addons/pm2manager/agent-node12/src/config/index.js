const path = require('path');
const os = require('os');

// Anchor to the install directory instead of process.cwd(): PM2 keeps whatever cwd the
// agent was started from (and restores it on resurrect), so a cwd-relative .env would be
// silently ignored and the agent would fall back to defaults on the next machine reboot.
const AGENT_ROOT = path.resolve(__dirname, '../..');

require('dotenv').config({ path: path.join(AGENT_ROOT, '.env') });

const list = (raw) => String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const bool = (raw, fallback) => {
    if (raw === undefined || raw === null || raw === '') return fallback;
    return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
};

const int = (raw, fallback) => {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const PLATFORM = process.platform;
const IS_WINDOWS = PLATFORM === 'win32';
const IS_LINUX = PLATFORM === 'linux';

const config = {
    AGENT_NAME: process.env.AGENT_NAME || os.hostname(),
    AGENT_ROOT,
    HOST: process.env.HOST || '0.0.0.0',
    PORT: parseInt(process.env.PORT, 10) || 7003,
    AGENT_TOKEN: process.env.AGENT_TOKEN || null,
    AGENT_ALLOWED_IPS: list(process.env.AGENT_ALLOWED_IPS),
    // Mutating endpoints (restart/stop/delete/... on this machine's PM2 apps).
    // Opt out with AGENT_ALLOW_ACTIONS=false to keep an agent strictly read-only.
    AGENT_ALLOW_ACTIONS: bool(process.env.AGENT_ALLOW_ACTIONS, true),
    APP_ENV: process.env.APP_ENV || 'production',
    APP_HTTP_MODE: (process.env.APP_HTTP_MODE || 'HTTP').toUpperCase(),
    CERT_KEY: process.env.CERT_KEY || 'cert.key',
    CERT_PATH: process.env.CERT_PATH || 'cert.crt',

    PLATFORM,
    IS_WINDOWS,
    IS_LINUX,
    IS_POSIX: !IS_WINDOWS,

    // How the agent talks to PM2:
    //   api  – connect to the PM2 daemon over its RPC socket (no process spawn per read)
    //   cli  – always shell out to `pm2 jlist`
    //   auto – use the RPC socket when the pm2 module can be resolved, else the CLI
    // The RPC path answers in single-digit milliseconds; a CLI spawn costs a whole Node
    // start-up (~1 s, ~40 MB RSS) *per poll*, which is the agent's single largest cost.
    PM2_MODE: (process.env.AGENT_PM2_MODE || 'auto').trim().toLowerCase(),

    // Response compression. App/port/process listings are highly repetitive JSON and
    // compress 8-12x; the CPU cost is paid once per response instead of on every byte
    // crossing a WAN link. Small bodies skip it (see COMPRESS_MIN_BYTES).
    COMPRESSION: bool(process.env.AGENT_COMPRESSION, true),
    COMPRESS_MIN_BYTES: int(process.env.AGENT_COMPRESS_MIN_BYTES, 1024),

    // Cache TTLs, in milliseconds. `fresh` is served without any work; within `stale` the
    // cached value is returned instantly and refreshed in the background.
    CACHE: {
        PM2_LIST_FRESH: int(process.env.AGENT_CACHE_PM2_MS, 1000),
        PM2_LIST_STALE: int(process.env.AGENT_CACHE_PM2_STALE_MS, 8000),
        // Log paths are fixed for the life of a process — the 3 s log poll should never
        // pay for a PM2 listing just to re-learn a filename.
        PM2_PATHS_FRESH: int(process.env.AGENT_CACHE_PM2_PATHS_MS, 30000),
        CURRENT_LOAD: int(process.env.AGENT_CACHE_LOAD_MS, 2000),
        CONNECTIONS: int(process.env.AGENT_CACHE_PORTS_MS, 5000),
        PROCESSES: int(process.env.AGENT_CACHE_PROCESSES_MS, 5000),
        // `pm2 describe` renders a table for a human to read; nobody needs it sub-second.
        DESCRIBE_RAW: int(process.env.AGENT_CACHE_DESCRIBE_MS, 3000)
    },

    DEFAULTS: {
        LINES_PER_REQUEST: 50,
        // Cap on how many rows /api/system/processes returns.
        TOP_PROCESSES: int(process.env.AGENT_TOP_PROCESSES, 100)
    }
};

module.exports = config;
