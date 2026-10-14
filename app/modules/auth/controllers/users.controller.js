// User management (admins) and the signed-in user's own account page.
const password = require('../../../core/helpers/password');
const usersModel = require('../models/users.model');
const rolesModel = require('../models/roles.model');

// The submitted role if it exists, otherwise the fallback.
const validRole = async (key, fallback) => (key && (await rolesModel.getByKey(key)) ? key : fallback);
const view = require('../../../core/view')('auth');

const USERS_URL = '/admin/users';
const back = (res, url, kind, message) => res.redirect(`${url}?${kind}=${encodeURIComponent(message)}`);

exports.index = async function (req, res) {
  return res.renderPage(view('users'), {
    title: 'Users',
    users: await usersModel.list(),
    roles: (await rolesModel.list()).map((r) => ({ key: r.key, name: r.name })),
    currentUserId: req.user.id,
    minLength: password.MIN_LENGTH,
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

exports.create = async function (req, res) {
  const username = String(req.body.username || '').trim();
  const role = await validRole(req.body.role, 'user');

  if (!usersModel.USERNAME_RE.test(username)) {
    return back(res, USERS_URL, 'error', 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  }
  const passwordError = password.validate(req.body.password);
  if (passwordError) return back(res, USERS_URL, 'error', passwordError);

  try {
    await usersModel.create({ username, name: req.body.name, role, plainPassword: req.body.password });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return back(res, USERS_URL, 'error', `Username "${username}" is already taken.`);
    throw err;
  }
  return back(res, USERS_URL, 'success', `User "${username}" created.`);
};

exports.update = async function (req, res) {
  const user = await usersModel.getById(req.params.id);
  if (!user) return back(res, USERS_URL, 'error', 'User not found.');

  const isSelf = user.id === req.user.id;
  const role = isSelf ? user.role : await validRole(req.body.role, user.role);
  const isActive = isSelf ? true : req.body.is_active === '1';

  const losesAdmin = user.role === 'admin' && user.is_active && (role !== 'admin' || !isActive);
  if (losesAdmin && (await usersModel.countActiveAdmins()) <= 1) {
    return back(res, USERS_URL, 'error', 'At least one active administrator is required.');
  }

  if (req.body.password) {
    const passwordError = password.validate(req.body.password);
    if (passwordError) return back(res, USERS_URL, 'error', passwordError);
  }

  await usersModel.update(user.id, { name: req.body.name, role, isActive });
  if (req.body.password) await usersModel.setPassword(user.id, req.body.password);
  return back(res, USERS_URL, 'success', `User "${user.username}" updated.`);
};

exports.remove = async function (req, res) {
  const user = await usersModel.getById(req.params.id);
  if (!user) return back(res, USERS_URL, 'error', 'User not found.');
  if (user.id === req.user.id) return back(res, USERS_URL, 'error', 'You cannot delete your own account.');
  if (user.role === 'admin' && user.is_active && (await usersModel.countActiveAdmins()) <= 1) {
    return back(res, USERS_URL, 'error', 'At least one active administrator is required.');
  }
  await usersModel.remove(user.id);
  return back(res, USERS_URL, 'success', `User "${user.username}" deleted.`);
};

exports.account = async function (req, res) {
  const role = await rolesModel.getByKey(req.user.role);
  return res.renderPage(view('account'), {
    title: 'My Account',
    profile: { username: req.user.username, name: req.user.name, role: req.user.role, roleName: role ? role.name : req.user.role, last_login_at: req.user.last_login_at },
    minLength: password.MIN_LENGTH,
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

exports.updateProfile = async function (req, res) {
  await usersModel.update(req.user.id, { name: req.body.name, role: req.user.role, isActive: true });
  return back(res, '/account', 'success', 'Profile updated.');
};

exports.changePassword = async function (req, res) {
  if (!(await usersModel.verifyPassword(req.user.id, req.body.current_password))) {
    return back(res, '/account', 'error', 'Current password is incorrect.');
  }
  const passwordError = password.validate(req.body.password, req.body.password_confirm);
  if (passwordError) return back(res, '/account', 'error', passwordError);
  await usersModel.setPassword(req.user.id, req.body.password);
  return back(res, '/account', 'success', 'Password changed.');
};
