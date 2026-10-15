const auth = require('../auth');
const permissions = require('../permissions');
const usersModel = require('../../modules/auth/models/users.model');
const rolesModel = require('../../modules/auth/models/roles.model');
const view = require('../view')('auth');

const wantsJson = (req) => req.xhr || req.path.startsWith('/api/') || /json/i.test(req.get('accept') || '');

function forbidden(req, res, message) {
  if (wantsJson(req)) return res.status(403).json({ error: message });
  return res.status(403).renderPage(view('forbidden'), { title: 'Access denied', message });
}

/**
 * Signed-in users only. Loads the account and its role's permissions on every request,
 * so deactivated users and permission changes take effect immediately, and refuses pages
 * whose menu item the role has not been granted (see core/permissions.js).
 * Exposes req.user / res.locals.user; req.auth.user keeps the express-basic-auth shape.
 */
module.exports = async (req, res, next) => {
  try {
    await auth.ready();
    if (!auth.isInstalled()) return res.redirect('/install');

    const id = req.session && req.session.userId;
    const user = id ? await usersModel.getById(id) : null;
    if (!user || !user.is_active) {
      if (id) delete req.session.userId;
      if (wantsJson(req)) return res.status(401).json({ error: 'Not signed in' });
      const back = req.method === 'GET' && req.originalUrl !== '/' ? '?next=' + encodeURIComponent(req.originalUrl) : '';
      return res.redirect('/login' + back);
    }

    const [role, granted] = await Promise.all([
      rolesModel.getByKey(user.role),
      user.role === permissions.ADMIN_ROLE ? [] : rolesModel.permissions(user.role)
    ]);
    user.roleName = role ? role.name : user.role;
    user.permissions = new Set(granted);
    req.user = user;
    req.auth = { user: user.username };
    res.locals.user = user;

    const owner = permissions.findMenuItem(req.path);
    if (owner && !permissions.canAccessItem(user, owner.item)) {
      if (req.path === '/') return res.redirect(permissions.firstAccessibleLink(user));
      return forbidden(req, res, owner.item.adminOnly
        ? 'This page is for administrators only.'
        : `Your role doesn't include "${owner.item.text}". Ask an administrator if you need it.`);
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * An action inside a page (see core/permissions.js), e.g. requireAction('/reports/publish', 'deploy-prod').
 * Comes after the page check, so the role already has the page.
 */
module.exports.requireAction = (link, key) => (req, res, next) => {
  if (permissions.canDo(req.user, link, key)) return next();
  return forbidden(req, res, `Your role can't "${permissions.actionText(link, key)}". Ask an administrator if you need it.`);
};

module.exports.requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === permissions.ADMIN_ROLE) return next();
  return forbidden(req, res, 'This page is for administrators only.');
};
