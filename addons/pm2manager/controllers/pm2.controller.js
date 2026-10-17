// PM2 Manager > Environments: the overview of this server and the remote environments (/pm2), their
// create / edit / disable and connection test, and one environment's processes (/pm2/env/<id>, 0 = this
// server) with their actions, logs, describe and .env.
const fs = require('fs');
const path = require('path');
const view = require('../../../app/core/view').addon('pm2manager');
const zip = require('../../../app/core/helpers/zip.helper');
const { actionsFor, ADMIN_ROLE } = require('../../../app/core/permissions');
const environments = require('../models/environments.model');
const settings = require('../models/settings.model');
const source = require('../models/source');
const agent = require('../models/agent.service');

const LINK = '/pm2';
const username = (req) => (req.user && req.user.username) || '';
const envId = (req) => parseInt(req.params.id, 10);

// Errors marked expose (bad input, not found, an agent's answer) go to the page as they are; others are logged.
function fail(res, err, what) {
  if (err && err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`PM2 Manager: ${what}:`, err);
  return res.status(500).json({ error: `The ${what} failed. The details are in the server log.` });
}

const json = (what, fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (err) { fail(res, err, what); }
};

/* ── Pages ─────────────────────────────────────────────────────────────── */

exports.index = async function (req, res) {
  return res.renderPage(view('overview'), {
    title: 'PM2 Environments',
    theme: (await settings.get()).theme,
    can: actionsFor(req.user, LINK),
    isAdmin: !!req.user && req.user.role === ADMIN_ROLE
  });
};

exports.environment = async function (req, res) {
  const id = envId(req);
  const env = id === 0 ? { id: 0, name: 'Local', url: '', description: 'The server this app runs on', enabled: true } : await environments.get(id);
  if (!env) return res.redirect(LINK);
  return res.renderPage(view('environment'), {
    title: `${env.name} · PM2`,
    env,
    theme: (await settings.get()).theme,
    can: actionsFor(req.user, LINK)
  });
};

/* ── Settings ──────────────────────────────────────────────────────────── */

const settingsView = (s) => ({ theme: s.theme, updatedBy: s.updatedBy || '', updatedAt: s.updatedAt || '' });

exports.settingsIndex = async function (req, res) {
  const s = await settings.get();
  return res.renderPage(view('settings'), { title: 'PM2 Manager Settings', theme: s.theme, saved: settingsView(s) });
};

exports.settingsSave = json('saving of the settings', async (req) => settingsView(await settings.save(req.body, username(req))));

/* ── Environments CRUD ─────────────────────────────────────────────────── */

exports.list = json('reading of the environments', async () => ({ environments: await environments.list() }));

// Every environment with its tile (counts, CPU, memory, host), read in parallel; a dead one never holds the others.
exports.overview = json('reading of the overview', async () => {
  const list = (await environments.list()).filter((e) => e.enabled);
  const local = { id: 0, name: 'Local', url: '', description: 'The server this app runs on', enabled: true, local: true };
  const all = [local].concat(list);
  const tiles = await Promise.all(all.map(async (e) => {
    try {
      return Object.assign({}, e, await source.summary(e.id, await source.of(e.id)));
    } catch (err) {
      return Object.assign({}, e, { online: false, error: err.expose ? err.message : 'Could not read this environment' });
    }
  }));
  return { environments: tiles, disabled: (await environments.list()).filter((e) => !e.enabled) };
});

exports.create = json('saving of the environment', async (req) => ({ environment: await environments.create(req.body, username(req)) }));

exports.update = json('saving of the environment', async (req) => {
  const env = await environments.update(envId(req), req.body, username(req));
  if (!env) throw Object.assign(new Error('Environment not found'), { status: 404, expose: true });
  return { environment: env };
});

exports.toggle = json('change of the environment', async (req) => {
  const env = await environments.setEnabled(envId(req), !!(req.body && req.body.enabled), username(req));
  if (!env) throw Object.assign(new Error('Environment not found'), { status: 404, expose: true });
  return { environment: env };
});

// Tests a saved environment (/:id/test), or the one in the form (/test with url and token), before saving.
// A failed test is an answer to show, not an error. /health needs no token; /api/info proves the token.
exports.test = json('connection test', async (req) => {
  let target;
  const b = req.body || {};
  if (req.params.id) {
    const id = envId(req);
    if (b.token || b.url) {
      // editing: the form's values, with the stored token when none is typed
      const stored = await environments.target(id).catch(() => null);
      target = { url: environments.validateUrl(b.url), token: b.token ? environments.validateToken(b.token) : (stored && stored.token), allowInsecureTls: !!b.allowInsecureTls };
      if (!target.token) throw Object.assign(new Error('Enter the agent token'), { status: 400, expose: true });
    } else {
      target = await environments.target(id);
    }
  } else {
    target = { url: environments.validateUrl(b.url), token: environments.validateToken(b.token), allowInsecureTls: !!b.allowInsecureTls };
  }
  const started = Date.now();
  try {
    const health = await agent.get(target, '/health');
    const info = await agent.get(target, '/api/info');
    return { reachable: true, latencyMs: Date.now() - started, pm2: health.pm2, agent: info.agent, host: info.host, node: info.node };
  } catch (err) {
    if (err instanceof agent.AgentError) return { reachable: false, error: err.message };
    throw err;
  }
});

/* ── pm2-agent download ────────────────────────────────────────────────── */

// The agent builds bundled with the add-on, zipped on request into a pm2-agent/ folder (no .env, no
// node_modules: its installer creates the .env with a fresh token and runs npm install on the target server).
// standard: agent/ (Node.js 16+); node12: agent-node12/ (Node.js 12.12+, older helmet / rate-limit, pm2@5).
const AGENT_BUILDS = {
  standard: { dir: path.join(__dirname, '..', 'agent'), suffix: '' },
  node12: { dir: path.join(__dirname, '..', 'agent-node12'), suffix: '-node12' }
};
const AGENT_SKIP = new Set(['.env', 'node_modules', '.git']);

function agentFiles(dir, prefix) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !AGENT_SKIP.has(d.name)).flatMap((d) => {
    const full = path.join(dir, d.name);
    const name = `${prefix}/${d.name}`;
    return d.isDirectory() ? agentFiles(full, name) : [{ name, data: fs.readFileSync(full) }];
  });
}

exports.agentDownload = function (req, res) {
  const build = AGENT_BUILDS[req.params.build || 'standard'];
  if (!build) return res.status(404).send('Unknown pm2-agent build.');
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(build.dir, 'package.json'), 'utf8'));
    const buf = zip.write(agentFiles(build.dir, 'pm2-agent'));
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="pm2-agent-${version}${build.suffix}.zip"`);
    return res.send(buf);
  } catch (err) {
    console.error('PM2 Manager: packing of pm2-agent failed:', err);
    return res.status(500).send('The pm2-agent package could not be made. The details are in the server log.');
  }
};

/* ── One environment's processes ───────────────────────────────────────── */

const src = (req) => {
  const id = envId(req);
  if (!Number.isInteger(id) || id < 0) throw Object.assign(new Error('Invalid environment'), { status: 400, expose: true });
  return source.of(id);
};

exports.apps = json('reading of the processes', async (req) => {
  const s = await src(req);
  const [apps, monitor] = await Promise.all([s.apps(), s.monitor().catch(() => null)]);
  return { apps: apps.apps || [], node: apps.node || null, counts: source.counts(apps.apps), monitor };
});

// The machine: node, OS, host, IP, clock and disks (the info bar and disk cards).
exports.system = json('reading of the server', async (req) => (await src(req)).system());

exports.app = json('reading of the process', async (req) => (await src(req)).app(req.params.app));
exports.logs = json('reading of the logs', async (req) => (await src(req)).logs(req.params.app, req.params.type, req.query.nextKey));
exports.describe = json('reading of pm2 describe', async (req) => (await src(req)).describe(req.params.app));
exports.env = json('reading of the .env file', async (req) => (await src(req)).env(req.params.app));

exports.saveEnv = json('saving of the .env file', async (req) => {
  const data = await (await src(req)).saveEnv(req.params.app, req.body && req.body.content);
  console.log(`PM2 Manager: .env of "${req.params.app}" (environment ${envId(req)}) saved by ${username(req)}`);
  return Object.assign({ message: 'Saved. Restart the app to apply it.' }, data);
});

exports.action = json('process action', async (req) => {
  const verb = req.params.verb;
  const data = await (await src(req)).action(req.params.app, verb);
  console.log(`PM2 Manager: ${verb} "${req.params.app}" (environment ${envId(req)}) by ${username(req)}`);
  return data;
});

