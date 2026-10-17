// One environment's PM2, local (id 0, local.pm2.js) or remote (a pm2-agent, agent.service.js),
// behind the same calls. Answers are the agent's `data` shapes, so the pages need not know which.
const local = require('./local.pm2');
const agent = require('./agent.service');
const environments = require('./environments.model');

const ACTION_TIMEOUT_MS = 20000;
// a remote process table walk is slow; a dashboard tile must not wait long on one dead server
const OVERVIEW_TIMEOUT_MS = 5000;

const appPath = (name) => {
  if (!local.isValidAppName(name)) throw new agent.AgentError('Invalid app name', 400);
  return `/api/apps/${encodeURIComponent(name)}`;
};

function remote(target) {
  return {
    apps: (o = {}) => agent.get(target, '/api/apps', o),
    app: (name) => agent.get(target, appPath(name)),
    describe: (name) => agent.get(target, `${appPath(name)}/describe`),
    logs: (name, type, nextKey) => {
      if (type !== 'stdout' && type !== 'stderr') throw new agent.AgentError('Log type must be stdout or stderr', 400);
      return agent.get(target, `${appPath(name)}/logs/${type}`, { query: { nextKey } });
    },
    env: (name) => agent.get(target, `${appPath(name)}/env`),
    saveEnv: (name, content) => {
      if (typeof content !== 'string' || !content) throw new agent.AgentError('env_content is required', 400);
      if (Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new agent.AgentError('.env content too large', 413);
      return agent.send(target, `${appPath(name)}/env`, { body: { env_content: content }, timeoutMs: ACTION_TIMEOUT_MS });
    },
    action: (name, verb) => {
      if (!local.ACTIONS.includes(verb)) throw new agent.AgentError('Unknown action', 400);
      return verb === 'delete'
        ? agent.send(target, appPath(name), { method: 'DELETE', timeoutMs: ACTION_TIMEOUT_MS })
        : agent.send(target, `${appPath(name)}/${verb}`, { timeoutMs: ACTION_TIMEOUT_MS });
    },
    monitor: (o = {}) => agent.get(target, '/api/system/monitor', o),
    info: (o = {}) => agent.get(target, '/api/info', o),
    system: async () => systemFrom(await agent.get(target, '/api/system/info', { timeoutMs: 15000 }))
  };
}

// The agent's /api/system/info (preformatted text) in the shape local.pm2.js system() gives.
// osinfo: "win32 10.0.26200 | Hostname : HOST | IP : 10.0.0.1"; timeinfo: "<Date string> <IANA zone>".
function systemFrom(d) {
  const s = (d && d.serverinfo) || {};
  const os = String(s.osinfo || '');
  const pick = (re) => { const m = os.match(re); return m ? m[1].trim() : null; };
  const t = String(s.timeinfo || '');
  const time = Date.parse(t.replace(/\s*\(.*$/, '')) || null;
  const off = t.match(/GMT([+-])(\d\d)(\d\d)/);
  const platform = os.split('|')[0].trim();
  return {
    node: d && d.node ? d.node.node || null : null,
    os: platform.replace(/^win32\b/i, 'Windows').replace(/^linux\b/i, 'Linux').replace(/^darwin\b/i, 'macOS'),
    hostname: pick(/Hostname\s*:\s*([^|]+)/),
    ip: pick(/IP\s*:\s*([^|]+)/),
    cpu: s.cpuInfo || '',
    time,
    offsetMin: off ? (off[1] === '-' ? -1 : 1) * (parseInt(off[2], 10) * 60 + parseInt(off[3], 10)) : null,
    timezone: (t.match(/\)\s*(\S+)\s*$/) || [])[1] || '',
    disks: (s.disks || []).map((x) => ({ mount: x.mount, total: x.total, used: x.used, percent: parseFloat(x.percent) || 0 }))
  };
}

/** The environment with id `id` (0 = this server). */
exports.of = async function (id) {
  if (id === 0) return local;
  return remote(await environments.target(id));
};

exports.remote = remote;

// PM2's own modules (pm2-logrotate, ...) are listed apart and left out of the counts.
const isModule = (app) => /^pm2-/.test(String(app && app.name));
exports.isModule = isModule;
exports.counts = function (apps) {
  const c = { online: 0, stopped: 0, errored: 0, total: 0 };
  (apps || []).filter((a) => !isModule(a)).forEach((a) => {
    c.total++;
    if (c[a.status] !== undefined) c[a.status]++;
  });
  return c;
};

/** A tile for the overview: counts, CPU, memory and host, or why it could not be read. Never rejects. */
exports.summary = async function (id, src) {
  try {
    const o = id === 0 ? {} : { timeoutMs: OVERVIEW_TIMEOUT_MS };
    const [apps, monitor, info] = await Promise.all([src.apps(o), src.monitor(o), src.info(o)]);
    return { online: true, counts: exports.counts(apps.apps), node: apps.node, cpu: monitor.cpu, memory: monitor.memory, host: info.host, agent: info.agent };
  } catch (err) {
    return { online: false, error: err && err.expose ? err.message : 'Could not read this environment' };
  }
};
