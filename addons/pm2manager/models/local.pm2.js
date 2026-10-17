// "Local": PM2 on the machine this app runs on, read and driven through the pm2 command line.
// Every answer has the same shape a pm2-agent gives (see agent.service.js), so the pages render a
// local and a remote environment the same way.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./exec');
const { AgentError } = require('./agent.service');

const APP_NAME_RE = /^[A-Za-z0-9_.,:\-]{1,128}$/;
const LOG_LINES = 200;
const MAX_LOG_LINE = 4096;
const MAX_ENV_BYTES = 64 * 1024;
const ACTIONS = ['reload', 'restart', 'stop', 'reset', 'flush', 'delete'];

const isValidAppName = (n) => typeof n === 'string' && APP_NAME_RE.test(n);

function bytesToSize(bytes) {
  const b = Number(bytes) || 0;
  const units = [['tb', 1024 ** 4], ['gb', 1024 ** 3], ['mb', 1024 ** 2], ['kb', 1024]];
  const unit = units.find(([, size]) => b >= size);
  return unit ? `${(b / unit[1]).toFixed(1)}${unit[0]}` : `${b}b`;
}

function timeSince(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s >= 86400) return `${Math.floor(s / 86400)}d`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

// `pm2 jlist` takes over a second to spawn: one shared read for a moment, concurrent callers wait
// for the same one, and every action drops it so the next read is fresh.
let cache = { at: 0, value: null, pending: null };
const FRESH_MS = 1500;
function jlist() {
  if (cache.value && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.value);
  if (cache.pending) return cache.pending;
  cache.pending = run('pm2', ['jlist'], { timeout: 30000 })
    .then((stdout) => {
      // PM2 can print a banner before the JSON on its first start: take the outer array only
      const start = stdout.indexOf('[');
      const end = stdout.lastIndexOf(']');
      if (start < 0 || end < start) throw new Error('Unexpected output from pm2 jlist');
      const apps = JSON.parse(stdout.slice(start, end + 1));
      cache = { at: Date.now(), value: Array.isArray(apps) ? apps : [], pending: null };
      return cache.value;
    })
    .catch((err) => {
      cache.pending = null;
      throw new AgentError(/not recognized|not found|ENOENT/i.test(err.message) ? 'PM2 is not installed on this server (npm install -g pm2)' : `pm2 jlist failed: ${err.message}`, 503);
    });
  return cache.pending;
}
const invalidate = () => { cache = { at: 0, value: null, pending: null }; };

async function find(name) {
  if (!isValidAppName(name)) throw new AgentError('Invalid app name', 400);
  const app = (await jlist()).find((a) => a.name === name || String(a.pm_id) === name);
  if (!app) throw new AgentError('App not found', 404);
  return app;
}

const ENV_LABEL = () => String(process.env.APP_ENV || 'production').toUpperCase();

function listItem(app) {
  const e = app.pm2_env || {};
  return {
    name: app.name, status: e.status, cpu: (app.monit || {}).cpu, memory: bytesToSize((app.monit || {}).memory),
    uptime: e.status === 'online' ? timeSince(e.pm_uptime) : '', pm_id: app.pm_id, restarts: e.restart_time,
    node_args: e.node_args, env: ENV_LABEL()
  };
}

let nodeVersion = null;
async function nodeInfo() {
  if (!nodeVersion) nodeVersion = { node: process.version };
  return nodeVersion;
}

exports.apps = async function () {
  const apps = (await jlist()).map(listItem);
  return { apps, node: await nodeInfo() };
};

exports.app = async function (name) {
  const app = await find(name);
  const e = app.pm2_env || {};
  return {
    app: Object.assign(listItem(app), {
      memory: (app.monit || {}).memory,
      pm_out_log_path: e.pm_out_log_path, pm_err_log_path: e.pm_err_log_path,
      pm2_env_cwd: e.pm_cwd, project_path: e.pm_cwd, exec_path: e.pm_exec_path,
      exec_mode: e.exec_mode, instances: e.instances, node_version: e.node_version,
      restart_time: e.restart_time, created_at: e.created_at, unstable_restarts: e.unstable_restarts
    })
  };
};

// The CLI's own table, colours stripped.
exports.describe = async function (name) {
  await find(name);
  const raw = await run('pm2', ['describe', name], { timeout: 30000 });
  return { output: sanitize(raw.split('\n')) };
};

const ANSI_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\x5C)|\x1B[@-Z\x5C-_]|\x1B\[[0-?]*[ -/]*[@-~]/g;
const sanitize = (lines) => lines
  .map((line) => String(line).replace(ANSI_RE, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, MAX_LOG_LINE))
  .join('\n');

// The last LOG_LINES lines before byte `nextKey` (the end of the file without one): { lines, nextKey }.
// nextKey <= 0 means the start of the file was reached. The path comes from PM2, never from the request.
function readLogsReverse(filePath, nextKey) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) return resolve({ lines: [], nextKey: -1, linesPerRequest: LOG_LINES });
    const size = fs.statSync(filePath).size;
    const asked = parseInt(nextKey, 10);
    const end = Number.isFinite(asked) && asked >= 0 ? Math.min(asked, size) : size;
    const start = Math.max(0, end - LOG_LINES * 200);
    if (end <= 0) return resolve({ lines: [], nextKey: -1, linesPerRequest: LOG_LINES });
    const chunks = [];
    fs.createReadStream(filePath, { start, end: end - 1 })
      .on('data', (c) => chunks.push(c))
      .on('error', () => resolve({ lines: [], nextKey: -1, linesPerRequest: LOG_LINES }))
      .on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let lines = text.split('\n');
        // the first line is likely cut in the middle unless the read started at the file's start
        let consumed = Buffer.byteLength(text, 'utf8');
        if (start > 0 && lines.length > 1) consumed -= Buffer.byteLength(lines.shift() + '\n', 'utf8');
        if (lines.length > LOG_LINES) {
          const drop = lines.slice(0, lines.length - LOG_LINES);
          consumed -= Buffer.byteLength(drop.join('\n') + '\n', 'utf8');
          lines = lines.slice(-LOG_LINES);
        }
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        const next = end - consumed;
        resolve({ lines, nextKey: next > 0 ? next : -1, linesPerRequest: LOG_LINES });
      });
  });
}

exports.logs = async function (name, type, nextKey) {
  if (type !== 'stdout' && type !== 'stderr') throw new AgentError('Log type must be stdout or stderr', 400);
  const e = (await find(name)).pm2_env || {};
  const logs = await readLogsReverse(type === 'stdout' ? e.pm_out_log_path : e.pm_err_log_path, nextKey);
  logs.lines = sanitize(logs.lines);
  return { logs };
};

// Ecosystem apps often share a cwd and keep their .env in a sub folder (env_file), so: env_file
// (relative to the cwd, like PM2), else <cwd>/.env, else <script folder>/.env, else <cwd>/.env for a write.
function envPathOf(app) {
  const e = app.pm2_env || {};
  if (e.env_file) return path.resolve(e.pm_cwd || '.', e.env_file);
  const candidates = [e.pm_cwd && path.join(e.pm_cwd, '.env'), e.pm_exec_path && path.join(path.dirname(e.pm_exec_path), '.env')].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || candidates[0] || null;
}
const readOrNull = (p) => fs.promises.readFile(p, 'utf8').catch(() => null);

exports.env = async function (name) {
  const envPath = envPathOf(await find(name));
  return { env_file_path: envPath, env_file_raw: envPath ? await readOrNull(envPath) : null, env_file_raw_backup: envPath ? await readOrNull(envPath + '.backup') : null };
};

// The current file is kept as .env.backup, then the new content written as it was sent.
exports.saveEnv = async function (name, content) {
  if (typeof content !== 'string' || !content) throw new AgentError('env_content is required', 400);
  if (Buffer.byteLength(content, 'utf8') > MAX_ENV_BYTES) throw new AgentError('.env content too large', 413);
  const envPath = envPathOf(await find(name));
  if (!envPath) throw new AgentError('No .env location could be found for this app', 409);
  const current = await readOrNull(envPath);
  if (current !== null) await fs.promises.writeFile(envPath + '.backup', current, 'utf8');
  await fs.promises.writeFile(envPath, content, 'utf8');
  return { env_file_path: envPath };
};

exports.action = async function (name, verb) {
  if (!ACTIONS.includes(verb)) throw new AgentError('Unknown action', 400);
  const app = await find(name);
  console.log(`PM2 Manager: pm2 ${verb} ${app.name}`);
  try {
    await run('pm2', [verb, app.name], { timeout: 60000 });
  } finally {
    invalidate();
  }
  return { apps: [{ name: app.name }] };
};

// CPU use over a short sample, like the agent's /api/system/monitor.
function cpuTimes() {
  return os.cpus().reduce((t, c) => {
    const total = Object.values(c.times).reduce((s, v) => s + v, 0);
    return { idle: t.idle + c.times.idle, total: t.total + total };
  }, { idle: 0, total: 0 });
}
exports.monitor = async function () {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, 250));
  const b = cpuTimes();
  const total = b.total - a.total;
  const usage = total > 0 ? (1 - (b.idle - a.idle) / total) * 100 : 0;
  const mem = { total: os.totalmem(), free: os.freemem() };
  mem.used = mem.total - mem.free;
  const cpus = os.cpus();
  return {
    cpu: { usage: parseFloat(usage.toFixed(2)), cores: cpus.length, model: cpus[0] ? cpus[0].model.trim() : '' },
    memory: Object.assign(mem, { percent: parseFloat((mem.used * 100 / mem.total).toFixed(2)) }),
    timestamp: Date.now()
  };
};

exports.info = async function () {
  const ip = await primaryIp();
  return {
    agent: { name: 'Local', version: '', env: ENV_LABEL() },
    host: { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), isWindows: os.platform() === 'win32', ip }
  };
};

// Sizes as the agent writes them ("457.16 GB"), so local and remote disks read the same.
function formatBytes(b) {
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, n = Number(b) || 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${parseFloat(n.toFixed(2))} ${units[i]}`;
}

// Disks: drive letters on Windows, real file systems from /proc/mounts elsewhere. A drive that does not
// answer within a moment (a dropped network share) is left out instead of holding the page.
const LINUX_FS = /^(ext[234]|xfs|btrfs|zfs|f2fs|jfs|reiserfs|ntfs|ntfs3|vfat|exfat|fuseblk)$/;
async function mounts() {
  if (process.platform === 'win32') {
    return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:`).filter((m) => { try { return fs.existsSync(`${m}/`); } catch (e) { return false; } });
  }
  const text = await fs.promises.readFile('/proc/mounts', 'utf8').catch(() => '');
  const seen = new Set();
  return text.split('\n').map((l) => l.split(' ')).filter((p) => p[1] && LINUX_FS.test(p[2]) && !seen.has(p[0]) && seen.add(p[0])).map((p) => p[1]);
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
let diskCache = { at: 0, value: [] };
async function disks() {
  if (Date.now() - diskCache.at < 15000) return diskCache.value;
  const list = await Promise.all((await mounts()).map(async (mount) => {
    const s = await withTimeout(fs.promises.statfs(process.platform === 'win32' ? `${mount}/` : mount).catch(() => null), 2000);
    if (!s || !s.blocks) return null;
    const total = s.blocks * s.bsize, used = (s.blocks - s.bfree) * s.bsize;
    return { mount, total: formatBytes(total), used: formatBytes(used), percent: parseFloat((used * 100 / total).toFixed(2)) };
  }));
  diskCache = { at: Date.now(), value: list.filter(Boolean) };
  return diskCache.value;
}

// The address of the default route (the one the agent reports too): a UDP "connect" picks the outgoing
// interface from the routing table without sending anything. Falls back to the first IPv4 address.
let ipCache = { at: 0, value: null };
function primaryIp() {
  if (ipCache.value && Date.now() - ipCache.at < 60000) return Promise.resolve(ipCache.value);
  const fallback = () => { const n = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal); return n ? n.address : null; };
  return new Promise((resolve) => {
    const sock = require('dgram').createSocket('udp4');
    const done = (ip) => { try { sock.close(); } catch (e) { /* closed */ } ipCache = { at: Date.now(), value: ip }; resolve(ip); };
    sock.on('error', () => done(fallback()));
    sock.connect(53, '8.8.8.8', () => { try { done(sock.address().address); } catch (e) { done(fallback()); } });
  });
}

/** The machine: { node, os, hostname, ip, cpu, time, offsetMin, timezone, disks } (same shape as a remote one). */
exports.system = async function () {
  const cpus = os.cpus();
  return {
    node: process.version,
    os: `${os.type() === 'Windows_NT' ? 'Windows' : os.type()} ${os.release()}`,
    hostname: os.hostname(),
    ip: await primaryIp(),
    cpu: cpus[0] ? `${cpus[0].model.trim()} · ${cpus.length} cores` : '',
    time: Date.now(),
    offsetMin: -new Date().getTimezoneOffset(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    disks: await disks()
  };
};

exports.isValidAppName = isValidAppName;
exports.ACTIONS = ACTIONS;
