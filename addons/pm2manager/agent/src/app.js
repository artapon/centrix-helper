#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const sysinfo = require('./utils/sysinfo.util');
const pm2 = require('./providers/pm2/api');
const { compression } = require('./middlewares/compress');

// A tokenless agent would expose every app name, log line and system metric on the machine
// to anyone who can reach the port. Refusing to start is the only safe default — the
// installer writes a random token, so this only fires on a hand-rolled .env.
if (!config.AGENT_TOKEN || config.AGENT_TOKEN.length < 16) {
    console.error('[agent] AGENT_TOKEN is missing or shorter than 16 characters.');
    console.error('[agent] Set AGENT_TOKEN in ' + path.join(config.AGENT_ROOT, '.env') + ' and start again.');
    process.exit(1);
}

const app = express();

// Deliberately NOT `trust proxy`: req.ip must stay the real socket peer, otherwise any
// caller could satisfy AGENT_ALLOWED_IPS by sending an X-Forwarded-For header of its own.
// Put the agent behind a reverse proxy only together with an IP restriction on the proxy.
app.disable('x-powered-by');

// Nothing is served from disk and every response is generated, so Express's ETag hashing
// is work whose result no caller can act on — the responses are explicitly no-store.
app.disable('etag');

// The only query parameter the agent reads is a numeric `nextKey`. Express's default `qs`
// parser exists for nested objects and arrays this API never accepts, and carries its own
// advisory history (array-limit bypass, isBuffer DoS) — the simple parser has neither.
app.set('query parser', 'simple');

// JSON API only — no cookies, no sessions, nothing a browser can be tricked into replaying.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' }
}));

// Metrics are point-in-time — a cached response is a wrong response.
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
});

// Must sit above the routes: it replaces res.json for the rest of the chain.
app.use(compression());

app.use(require('./routes/api'));

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
});

// Centralised error handler — never leak stack traces to a caller.
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    console.error('[agent] unhandled error:', err.message);
    res.status(status).json({
        success: false,
        error: status === 500 ? 'Internal server error' : err.message
    });
});

/* -- Process-level safety nets --------------------------------------------- */

// A rejected promise nobody awaited would, on Node 16+, take the whole agent down and hand
// PM2 a restart loop. The agent's job is to keep reporting; log it and stay up.
process.on('unhandledRejection', (reason) => {
    console.error('[agent] unhandled rejection:', reason && reason.message ? reason.message : reason);
});

/* -- Listener -------------------------------------------------------------- */

const banner = (scheme) => {
    console.log(`[agent] ${config.AGENT_NAME} listening on ${scheme}://${config.HOST}:${config.PORT}`);
    console.log(`[agent] health   : ${scheme}://${config.HOST}:${config.PORT}/health`);
    console.log(`[agent] platform : ${config.PLATFORM} | pm2 transport: ${pm2.transport()}`);
    console.log(`[agent] ip filter: ${config.AGENT_ALLOWED_IPS.length ? config.AGENT_ALLOWED_IPS.join(', ') : 'disabled (token only)'}`);
};

const createServer = () => {
    if (config.APP_HTTP_MODE !== 'HTTPS') return { server: http.createServer(app), scheme: 'http' };

    const resolveCert = (p) => (path.isAbsolute(p) ? p : path.join(config.AGENT_ROOT, p));
    const certKeyPath = resolveCert(config.CERT_KEY);
    const certCrtPath = resolveCert(config.CERT_PATH);

    let key, cert;
    try {
        key = fs.readFileSync(certKeyPath);
        cert = fs.readFileSync(certCrtPath);
    } catch (err) {
        console.error(`[agent] failed to read certificate files: ${err.message}`);
        console.error(`  CERT_KEY  : ${certKeyPath}`);
        console.error(`  CERT_PATH : ${certCrtPath}`);
        process.exit(1);
    }

    return {
        // A dashboard polls the same agent every few seconds over TLS. Without session
        // resumption every one of those polls pays for a full handshake — an RSA operation
        // per request, on the machine being monitored.
        server: https.createServer({ key, cert, sessionTimeout: 300 }, app),
        scheme: 'https'
    };
};

const { server, scheme } = createServer();

// pm2-admin polls on a timer over a long-lived connection. Holding it open past the default
// 5 s means a poll every few seconds reuses one socket (and one TLS session) instead of
// re-handshaking; headersTimeout must stay above keepAliveTimeout or Node races itself and
// drops the connection mid-request.
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 70 * 1000;
// A caller that opens a socket and then goes quiet must not hold a slot forever.
server.requestTimeout = 30 * 1000;
server.maxHeadersCount = 64;

server.listen(config.PORT, config.HOST, () => {
    banner(scheme);

    // Everything below is start-up warm-up, deliberately after listen(): the port is open
    // and answering before any of it runs, so a slow WMI probe never delays readiness.

    // Fill the caches whose values never change, so the first dashboard request does not
    // pay for CPU/OS/network discovery.
    sysinfo.warmUp().then(() => console.log('[agent] system info cache warm'));

    // Connect to PM2 up front, so the first /api/apps is a cache hit rather than the call
    // that discovers the pm2 module and dials the daemon.
    pm2.pm2Available().then(ok => {
        console.log(`[agent] pm2 ${ok ? 'reachable' : 'NOT reachable'} via ${pm2.transport()}`);
    });
});

/* -- Graceful shutdown ----------------------------------------------------- */

// PM2 sends SIGINT on Windows and SIGINT/SIGTERM elsewhere before it kills the process.
// Closing the PM2 RPC socket here is what keeps a restart loop from leaving a half-open
// connection against the daemon on every cycle.
let shuttingDown = false;

const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[agent] ${signal} received — shutting down`);

    // Stop accepting new connections, then let in-flight requests finish.
    server.close(() => {
        pm2.disconnect();
        process.exit(0);
    });

    // Idle keep-alive sockets would otherwise hold the process open for the full
    // keepAliveTimeout; don't wait on them.
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();

    setTimeout(() => {
        console.warn('[agent] shutdown timed out — exiting anyway');
        pm2.disconnect();
        process.exit(0);
    }, 5000).unref();
};

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
    // SIGHUP has no meaning on Windows and SIGTERM cannot be caught there; registering
    // them is harmless and keeps one code path for both platforms.
    try { process.on(signal, () => shutdown(signal)); } catch (_) { /* unsupported signal */ }
});

module.exports = { app, server };
