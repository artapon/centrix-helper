const addons = require('../addons');
const permissions = require('../permissions');
const view = require('../view')('marketplace');

const wantsJson = (req) => req.xhr || req.path.startsWith('/api/') || /json/i.test(req.get('accept') || '') || req.method !== 'GET';

/**
 * Pages and APIs of a deactivated add-on (see core/addons.js) answer 404 with an explanation
 * instead of falling through to "Cannot GET". Mounted right after requireAuth.
 */
module.exports = async (req, res, next) => {
  try {
    await addons.ready();
    const addon = addons.ownerOf(req.path);
    if (!addon || addons.isActive(addon.id)) return next();

    const isAdmin = !!req.user && req.user.role === permissions.ADMIN_ROLE;
    const message = `${addon.name} is not active. ` + (isAdmin
      ? 'You can activate it in Administration > Marketplace.'
      : 'Ask an administrator to activate it in Marketplace.');
    if (wantsJson(req)) return res.status(404).json({ error: message });
    return res.status(404).renderPage(view('inactive'), {
      title: addon.name,
      addon: { id: addon.id, name: addon.name, icon: addon.icon, summary: addon.summary },
      isAdmin,
      marketplace: addons.MARKETPLACE_LINK
    });
  } catch (err) {
    return next(err);
  }
};
