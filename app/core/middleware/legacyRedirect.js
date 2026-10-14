const { upgrade } = require('../routeMap');

/**
 * Old URLs (bookmarks, saved links, other systems linking here) move permanently to the
 * domain URLs in core/routeMap.js, with the rest of the path and the query string kept.
 * GET/HEAD get 301; other methods 308, so a form post or fetch keeps its method and body.
 */
module.exports = (req, res, next) => {
  const target = upgrade(req.originalUrl);
  if (!target) return next();
  return res.redirect(req.method === 'GET' || req.method === 'HEAD' ? 301 : 308, target);
};
