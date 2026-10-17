const fsp = require('fs').promises;
const path = require('path');

// Every filesystem call here is async. These endpoints are rare compared with the metric
// polls, but the agent is a single-threaded server: a synchronous stat or copy on a slow
// network share stalls every in-flight metric request behind it, not just this one.
const exists = async (p) => {
    try {
        await fsp.access(p);
        return true;
    } catch (_) {
        return false;
    }
};

// Locating an app's .env is the same problem pm2-admin solves for its own machine, so the
// resolution order is deliberately identical:
//   1. pm2_env.env_file (relative paths resolve against pm_cwd, like PM2 does)
//   2. <cwd>/.env when it exists
//   3. <dir of the script>/.env when it exists (ecosystem apps without env_file)
//   4. <cwd>/.env as the default target for writes
const resolveEnvFilePath = async ({ cwd, execPath, envFile } = {}) => {
    if (envFile) return path.resolve(cwd || '.', envFile);
    const candidates = [];
    if (cwd) candidates.push(path.join(cwd, '.env'));
    if (execPath) candidates.push(path.join(path.dirname(execPath), '.env'));
    for (const candidate of candidates) {
        if (await exists(candidate)) return candidate;
    }
    return candidates[0] || null;
};

// The backup lives next to the file it mirrors — `.env` -> `.env.backup`
const backupPathFor = (envPath) => (envPath ? envPath + '.backup' : null);

const readFileOrNull = async (filePath) => {
    if (!filePath) return null;
    try {
        return await fsp.readFile(filePath, 'utf-8');
    } catch (_) {
        return null;
    }
};

const readEnvFile = (envPath) => readFileOrNull(envPath);
const readEnvBackup = (envPath) => readFileOrNull(backupPathFor(envPath));

// Writes the caller's text verbatim after copying the current file to `.env.backup`.
//
// Deliberately not a parse/stringify round trip: an .env is edited by people, and comments,
// blank lines and key order are part of what they wrote. The caller sends the whole file,
// so echoing it back byte for byte is both simpler and less destructive — and the backup is
// what makes a bad edit recoverable.
const writeEnvFileWithBackup = async (envPath, content) => {
    if (!envPath) throw new Error('No .env file location resolved for this app');

    const dir = path.dirname(envPath);
    if (!await exists(dir)) throw new Error(`Directory does not exist: ${dir}`);

    if (await exists(envPath)) {
        await fsp.copyFile(envPath, backupPathFor(envPath));
    }
    await fsp.writeFile(envPath, content, 'utf-8');
    return true;
};

module.exports = {
    resolveEnvFilePath,
    backupPathFor,
    readEnvFile,
    readEnvBackup,
    writeEnvFileWithBackup
};
