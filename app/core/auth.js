// Authentication state shared by the auth middleware and the auth module:
// first-run setup (no users yet) and sign-in throttling.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const usersModel = require('../modules/auth/models/users.model');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SETUP_CODE_FILE = path.join(DATA_DIR, 'setup-code.txt');

let schemaReady = Promise.resolve();
let installed = false;
let setupCode = '';

/**
 * Call once at startup with the sqlite schema promise. While no user exists the app
 * only serves /install, which asks for a one-time setup code printed to the server
 * console (and saved to data/setup-code.txt) so the first visitor cannot claim admin.
 */
exports.init = function (ready) {
  schemaReady = ready.then(async () => {
    installed = (await usersModel.count()) > 0;
    if (installed) {
      fs.rmSync(SETUP_CODE_FILE, { force: true });
      return;
    }
    setupCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    fs.writeFileSync(SETUP_CODE_FILE, setupCode + '\n');
    console.log('='.repeat(64));
    console.log(' No users yet. Open /install to create the administrator account.');
    console.log(' Setup code: ' + setupCode + '   (also saved in data/setup-code.txt)');
    console.log('='.repeat(64));
  });
  return schemaReady;
};

exports.ready = () => schemaReady;
exports.isInstalled = () => installed;

exports.checkSetupCode = function (code) {
  const given = Buffer.from(String(code || '').trim().toUpperCase());
  const expected = Buffer.from(setupCode);
  return !!setupCode && given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

exports.completeInstall = function () {
  installed = true;
  setupCode = '';
  fs.rmSync(SETUP_CODE_FILE, { force: true });
};

// Session cookie secret: SESSION_SECRET from .env, else a random one kept in data/.
exports.sessionSecret = function () {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, secret);
    return secret;
  }
};

// ─── Sign-in throttling: 5 failures per IP+username lock it for 15 minutes ───
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map();

const throttleKey = (req, username) => `${req.ip}|${String(username || '').trim().toLowerCase()}`;

exports.lockedForMinutes = function (req, username) {
  const entry = failures.get(throttleKey(req, username));
  if (!entry || entry.count < MAX_FAILURES) return 0;
  const left = entry.first + LOCK_MS - Date.now();
  if (left <= 0) {
    failures.delete(throttleKey(req, username));
    return 0;
  }
  return Math.ceil(left / 60000);
};

exports.recordFailure = function (req, username) {
  const key = throttleKey(req, username);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > LOCK_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count++;
};

exports.clearFailures = function (req, username) {
  failures.delete(throttleKey(req, username));
};
