// Sign-in, sign-out and first-run installation. These pages render outside the app
// shell (views/login.html, views/install.html) because no user is signed in yet.
const auth = require('../../../core/auth');
const password = require('../../../core/helpers/password');
const { escapeHtml } = require('../../../core/layout');
const usersModel = require('../models/users.model');
const view = require('../../../core/view')('auth');
const { version } = require('../../../../package.json');
const assets = require('../../../core/assets');

// Only same-site paths are accepted as a post-login destination.
const safeNext = (value) => (typeof value === 'string' && /^\/(?!\/)/.test(value) && !value.includes('\\') ? value : '/');

function renderStandalone(res, name, locals, status = 200) {
  const escaped = {};
  Object.keys(locals).forEach((key) => { escaped[key] = escapeHtml(locals[key]); });
  return res.status(status).render(view(name), { locals: { ...escaped, version: escapeHtml(version), assetVersion: assets.version } });
}

// Starts a fresh session for the user (prevents session fixation).
function signIn(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

exports.loginForm = async function (req, res) {
  await auth.ready();
  if (!auth.isInstalled()) return res.redirect('/install');
  if (req.session.userId) return res.redirect(safeNext(req.query.next));
  return renderStandalone(res, 'login', {
    username: '',
    next: safeNext(req.query.next),
    error: '',
    notice: req.query.signedout ? 'You have been signed out.' : ''
  });
};

exports.login = async function (req, res) {
  await auth.ready();
  if (!auth.isInstalled()) return res.redirect('/install');
  const username = String(req.body.username || '').trim();
  const next = safeNext(req.body.next);
  const fail = (error, status = 401) => renderStandalone(res, 'login', { username, next, error, notice: '' }, status);

  const locked = auth.lockedForMinutes(req, username);
  if (locked) return fail(`Too many failed attempts. Try again in ${locked} minute${locked > 1 ? 's' : ''}.`, 429);

  const user = await usersModel.authenticate(username, req.body.password);
  if (!user) {
    auth.recordFailure(req, username);
    return fail('Incorrect username or password.');
  }

  auth.clearFailures(req, username);
  await signIn(req, user);
  return res.redirect(next);
};

exports.logout = function (req, res) {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login?signedout=1');
  });
};

exports.installForm = async function (req, res) {
  await auth.ready();
  if (auth.isInstalled()) return res.redirect('/login');
  return renderStandalone(res, 'install', { username: 'admin', name: '', error: '', minLength: password.MIN_LENGTH });
};

exports.install = async function (req, res) {
  await auth.ready();
  if (auth.isInstalled()) return res.redirect('/login');

  const username = String(req.body.username || '').trim();
  const name = String(req.body.name || '').trim();
  const fail = (error) => renderStandalone(res, 'install', { username, name, error, minLength: password.MIN_LENGTH }, 400);

  if (!auth.checkSetupCode(req.body.setup_code)) {
    return fail('The setup code is not correct. Find it in the server console output or in data/setup-code.txt.');
  }
  if (!usersModel.USERNAME_RE.test(username)) {
    return fail('Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  }
  const passwordError = password.validate(req.body.password, req.body.password_confirm);
  if (passwordError) return fail(passwordError);

  const user = await usersModel.createInitialAdmin({ username, name, plainPassword: req.body.password });
  auth.completeInstall();
  if (!user) return res.redirect('/login');

  await usersModel.recordLogin(user.id);
  await signIn(req, user);
  return res.redirect('/');
};
