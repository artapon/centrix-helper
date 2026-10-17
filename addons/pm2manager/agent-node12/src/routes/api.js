const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { isAllowedIp, isAuthenticated } = require('../middlewares/auth');
const config = require('../config');
const appsController = require('../controllers/apps.controller');
const systemController = require('../controllers/system.controller');

// Reads are served from short-lived caches, so a burst mostly costs JSON serialisation
// rather than a PM2 round trip or a WMI query. The limit still exists because serialisation
// is not free either: it is generous enough for several dashboards polling every few
// seconds, and low enough that a runaway loop is stopped.
const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests' }
});

// Listing every process on the box is the most expensive call the agent makes — a full
// process table walk. It is cached for a few seconds, so the budget below bounds how many
// *walks* a caller can trigger rather than how many responses it can read.
const heavyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests' }
});

// Actions change process state on this machine; a dashboard issues them one click at a
// time, so anything beyond this is a runaway caller.
const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests' }
});

// The only endpoint that reads a body. Parsing is attached to that route alone, so every
// other path stays a body-less GET the way it always was.
const jsonBody = express.json({ limit: '128kb' });

// Refuses every mutating route when the agent is configured read-only, before the handler
// (and PM2) is ever reached.
const actionsEnabled = (req, res, next) => {
    if (!config.AGENT_ALLOW_ACTIONS) {
        return res.status(403).json({ success: false, error: 'This agent is read-only (AGENT_ALLOW_ACTIONS=false)' });
    }
    next();
};

// Liveness probe: no token, no machine details, and it never itself causes a PM2 read —
// it reports whatever the shared cache already knows. Rate limited all the same, since it
// is the one endpoint reachable by anyone who can open a socket to the agent.
router.get('/health', readLimiter, systemController.getHealth);

// Everything below is token-gated (and IP-gated when AGENT_ALLOWED_IPS is set).
router.use('/api', isAllowedIp, isAuthenticated, readLimiter);

// Who am I / what machine is this
router.get('/api/info', systemController.getAgentInfo);

// PM2 apps
router.get('/api/apps', appsController.getAllApps);
router.get('/api/apps/:appName', appsController.getApp);
router.get('/api/apps/:appName/describe', appsController.getAppDescribe);
router.get('/api/apps/:appName/logs/:logType', appsController.getAppLogs);
router.get('/api/apps/:appName/env', appsController.getAppEnv);

// PM2 app actions — same set the local dashboard offers for its own machine
router.post('/api/apps/:appName/reload', actionsEnabled, writeLimiter, appsController.reloadAppAction);
router.post('/api/apps/:appName/restart', actionsEnabled, writeLimiter, appsController.restartAppAction);
router.post('/api/apps/:appName/stop', actionsEnabled, writeLimiter, appsController.stopAppAction);
router.post('/api/apps/:appName/reset', actionsEnabled, writeLimiter, appsController.resetAppAction);
router.post('/api/apps/:appName/flush', actionsEnabled, writeLimiter, appsController.flushAppAction);
router.delete('/api/apps/:appName', actionsEnabled, writeLimiter, appsController.deleteAppAction);
router.post('/api/apps/:appName/env', actionsEnabled, writeLimiter, jsonBody, appsController.updateAppEnv);

// System metrics
router.get('/api/system/info', systemController.getServerInfo);
router.get('/api/system/monitor', systemController.getSystemMonitor);
router.get('/api/system/ports', systemController.getListeningPorts);
router.get('/api/system/processes', heavyLimiter, systemController.getTopProcesses);

module.exports = router;
