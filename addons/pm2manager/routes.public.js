// Mounted before the DB-connection guard: environments live in SQLite and PM2 is read from the
// command line or a pm2-agent, so no Mongo connection is needed.
const path = require('path');
const express = require('express');
const asyncHandler = require('../../app/core/http/async.handler');
const { requireAction, requireAdmin } = require('../../app/core/middleware/requireauth.middleware');
const controller = require('./controllers/pm2.controller');
const environments = require('./models/environments.model');
const layout = require('../../app/core/layout');

const LINK = '/pm2';
// One permission, "Manage PM2": without it a role sees the environments, processes and logs only.
// .env files and pm2 describe (paths, settings, credentials) count as managing.
const manage = requireAction(LINK, 'manage');

const ENV = ':id(\\d+)';
// The browser sends ':' and ',' (multi-port names like "svc:8198,8199") percent-encoded, and routes match
// the raw path: '%' is allowed here, and the decoded name is checked again (local.pm2 isValidAppName).
const APP = ':app([A-Za-z0-9_.,:%\\-]{1,384})';

const router = express.Router();

// The pages' shared theme stylesheet and script.
router.use(`${LINK}/assets`, express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

// "Settings" (administrators only): the pages' light / dark theme.
router.get(`${LINK}/settings`, requireAdmin, asyncHandler(controller.settingsIndex));
router.post(`${LINK}/settings`, requireAdmin, controller.settingsSave);

// Access follows the "Environments" menu item (/pm2 and everything under it).
router.get(LINK, asyncHandler(controller.index));
router.get(`${LINK}/overview`, controller.overview);
router.get(`${LINK}/environments`, controller.list);
router.post(`${LINK}/environments`, manage, controller.create);
router.post(`${LINK}/environments/test`, manage, controller.test);
router.post(`${LINK}/environments/${ENV}`, manage, controller.update);
router.post(`${LINK}/environments/${ENV}/enabled`, manage, controller.toggle);
router.post(`${LINK}/environments/${ENV}/test`, manage, controller.test);

// pm2-agent as a .zip, to install on a server before adding it as an environment: the standard build
// (agent/, Node.js 16+) or the Node.js 12 build (agent-node12/).
router.get(`${LINK}/agent/download/:build(standard|node12)?`, manage, controller.agentDownload);

router.get(`${LINK}/env/${ENV}`, asyncHandler(controller.environment));
router.get(`${LINK}/env/${ENV}/apps`, controller.apps);
router.get(`${LINK}/env/${ENV}/system`, controller.system);
router.get(`${LINK}/env/${ENV}/apps/${APP}`, controller.app);
router.get(`${LINK}/env/${ENV}/apps/${APP}/logs/:type(stdout|stderr)`, controller.logs);
router.get(`${LINK}/env/${ENV}/apps/${APP}/describe`, manage, controller.describe);
router.get(`${LINK}/env/${ENV}/apps/${APP}/env`, manage, controller.env);
router.post(`${LINK}/env/${ENV}/apps/${APP}/env`, manage, controller.saveEnv);
router.post(`${LINK}/env/${ENV}/apps/${APP}/:verb(reload|restart|stop|reset|flush|delete)`, manage, controller.action);

// The sidebar lists this server and every enabled environment under "Environments".
layout.submenu(LINK, environments.menu);
environments.init().catch((err) => console.error('PM2 Manager: reading of the environments failed:', err));

module.exports = router;
