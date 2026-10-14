const permissions = require('../permissions');
const activeConnection = require('../../modules/setting/models/activeConnection');

/**
 * Pages that query Mongo need a selected site. The Mongo connection is shared by the whole
 * app, so a session that has not picked a site yet joins the one already connected; when none
 * is (e.g. after a restart) the app connects on its own to the last connection used on
 * Manage Connections. If that fails, the user is sent where the connection can be fixed.
 */
module.exports = async (req, res, next) => {
  if (req.session.dbconnected && activeConnection.isConnected()) return next();

  try {
    await activeConnection.ensure(req);
    return next();
  } catch (err) {
    console.error('Auto-connect failed:', err.message);
    activeConnection.clearSession(req);
    const message = encodeURIComponent(`Could not connect automatically (${err.message}). Choose a connection below.`);
    if (permissions.canAccessPath(req.user, '/database/connections')) return res.redirect('/database/connections?error=' + message);
    return res.redirect('/database/info?dberror=T&sitename=');
  }
};
