const {
    listApps, describeApp, describeAppRaw, appPaths, nodeInfo,
    reloadApp, restartApp, stopApp, resetApp, deleteApp, flushApp
} = require('../providers/pm2/api');
const { readLogsReverse } = require('../utils/read-logs.util');
const { resolveEnvFilePath, readEnvFile, readEnvBackup, writeEnvFileWithBackup } = require('../utils/env.util');
const { isValidAppName } = require('../utils/app-name.util');

// Logs are sent as plain text — the caller renders them with text interpolation, never
// v-html, so terminal output arrives verbatim (quotes, <>, emoji) without HTML escaping.
const MAX_LOG_LINE = 4096;
// CSI/SGR colour codes, OSC sequences and the remaining single-char escapes
const ANSI_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\x5C)|\x1B[@-Z\x5C-_]|\x1B\[[0-?]*[ -\/]*[@-~]/g;
const sanitizeLogLine = (line) => String(line)
    .replace(ANSI_RE, '')
    // drop control chars that would break rendering, keep tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, MAX_LOG_LINE);
const formatLogLines = (lines) => lines.map(sanitizeLogLine).join('\n');

const getAllApps = async (req, res) => {
    try {
        const [apps, node] = await Promise.all([listApps(), nodeInfo()]);

        let stoppedCount = 0;
        let erroredCount = 0;
        let onlineCount = 0;

        apps.forEach(app => {
            if (app.status === 'stopped') stoppedCount++;
            else if (app.status === 'online') onlineCount++;
            else if (app.status === 'errored') erroredCount++;
        });

        res.json({
            success: true,
            data: {
                apps,
                node,
                counts: {
                    stopped: stoppedCount,
                    online: onlineCount,
                    errored: erroredCount,
                    total: apps.length
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getApp = async (req, res) => {
    try {
        const { appName } = req.params;
        if (!isValidAppName(appName)) {
            return res.status(400).json({ success: false, error: 'Invalid app name' });
        }

        const app = await describeApp(appName);
        if (!app) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        res.json({ success: true, data: { app } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAppDescribe = async (req, res) => {
    try {
        const { appName } = req.params;
        if (!isValidAppName(appName)) {
            return res.status(400).json({ success: false, error: 'Invalid app name' });
        }

        const paths = await appPaths(appName);
        if (!paths) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        const raw = await describeAppRaw(appName);
        // The CLI colours its table with ANSI codes — the same sanitiser the logs use
        // strips them, leaving the box-drawing characters intact
        const output = formatLogLines(raw.split('\n'));

        res.json({ success: true, data: { output } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAppLogs = async (req, res) => {
    try {
        const { appName, logType } = req.params;
        const { nextKey } = req.query;

        if (!isValidAppName(appName)) {
            return res.status(400).json({ success: false, error: 'Invalid app name' });
        }
        if (logType !== 'stdout' && logType !== 'stderr') {
            return res.status(400).json({ success: false, error: 'Log Type must be stdout or stderr' });
        }

        // Only the two log paths are needed here, and they never change while a process
        // lives — appPaths() answers from its index, so a live tail polling every few
        // seconds does one file read and no PM2 round trip.
        const paths = await appPaths(appName);
        if (!paths) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        // The path comes from PM2 itself, never from the request — there is no way for a
        // caller to steer this at an arbitrary file.
        const filePath = logType === 'stdout' ? paths.pm_out_log_path : paths.pm_err_log_path;
        const logs = await readLogsReverse({ filePath, nextKey });
        logs.lines = formatLogLines(logs.lines);

        res.json({ success: true, data: { logs } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


/* -- .env file ------------------------------------------------------------- */

// An .env is where the database passwords and API keys live, so both endpoints sit behind
// the agent token like everything else and pm2-admin additionally restricts them to root.
const MAX_ENV_BYTES = 64 * 1024;

const getAppEnv = async (req, res) => {
    try {
        const { appName } = req.params;
        if (!isValidAppName(appName)) {
            return res.status(400).json({ success: false, error: 'Invalid app name' });
        }

        const paths = await appPaths(appName);
        if (!paths) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        const envPath = await resolveEnvFilePath({ cwd: paths.pm_cwd, execPath: paths.pm_exec_path, envFile: paths.env_file });
        const [content, backup] = await Promise.all([readEnvFile(envPath), readEnvBackup(envPath)]);

        // Field names match what pm2-admin puts on a local app, so the same panel renders both
        res.json({
            success: true,
            data: {
                env_file_path: envPath,
                env_file_raw: content,
                env_file_raw_backup: backup
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const updateAppEnv = async (req, res) => {
    try {
        const { appName } = req.params;
        const { env_content } = req.body || {};

        if (!isValidAppName(appName)) {
            return res.status(400).json({ success: false, error: 'Invalid app name' });
        }
        if (typeof env_content !== 'string' || !env_content) {
            return res.status(400).json({ success: false, error: 'env_content is required' });
        }
        if (Buffer.byteLength(env_content, 'utf8') > MAX_ENV_BYTES) {
            return res.status(413).json({ success: false, error: '.env content too large' });
        }

        const paths = await appPaths(appName);
        if (!paths) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        const envPath = await resolveEnvFilePath({ cwd: paths.pm_cwd, execPath: paths.pm_exec_path, envFile: paths.env_file });
        await writeEnvFileWithBackup(envPath, env_content);
        console.log(`env updated : ${appName} (${envPath})`);

        // The running process keeps the old values until it is restarted — say so rather
        // than letting the caller assume the change took effect.
        res.json({
            success: true,
            message: `Environment file for ${appName} updated — restart the app to apply it`,
            data: { env_file_path: envPath }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


/* ── Actions ───────────────────────────────────────────────────────────────── */

// Every action is the same shape: validate the name, run one PM2 command, report what was
// done. The routes decide who may call these (token + optional IP allowlist + the
// AGENT_ALLOW_ACTIONS switch); this layer only guards the argument.
const appAction = (verb, run) => async (req, res) => {
    try {
        const { appName } = req.params;
        if (!isValidAppName(appName)) {
            return res.status(400).json({ success: false, error: 'Invalid app name' });
        }

        // Existence check only — appPaths() is the cheapest thing that can answer it.
        const paths = await appPaths(appName);
        if (!paths) {
            return res.status(404).json({ success: false, error: 'App not found' });
        }

        const apps = await run(appName);
        res.json({ success: true, message: `App ${verb}`, data: { apps } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const reloadAppAction = appAction('reloaded', reloadApp);
const restartAppAction = appAction('restarted', restartApp);
const stopAppAction = appAction('stopped', stopApp);
const resetAppAction = appAction('counters reset', resetApp);
const deleteAppAction = appAction('deleted', deleteApp);
const flushAppAction = appAction('logs flushed', flushApp);

module.exports = {
    getAllApps,
    getApp,
    getAppDescribe,
    getAppLogs,
    getAppEnv,
    updateAppEnv,
    reloadAppAction,
    restartAppAction,
    stopAppAction,
    resetAppAction,
    deleteAppAction,
    flushAppAction
};
