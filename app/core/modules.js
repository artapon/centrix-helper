const fs = require('fs');
const path = require('path');
const addons = require('./addons');

const MODULES_DIR = path.join(__dirname, '..', 'modules');

const moduleNames = () => fs.readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Mounts every app/modules/<name>/<routesFile> router on the app.
 *   routes.public.js -> reachable without a Mongo connection (settings, connect)
 *   routes.js        -> mounted after the requireDbConnection guard
 * Then the same file of every add-on (addons/<id>/), which answers only while active.
 */
exports.mountRoutes = function (app, routesFile) {
  for (const name of moduleNames()) {
    const file = path.join(MODULES_DIR, name, routesFile);
    if (fs.existsSync(file)) app.use(require(file));
  }
  addons.mountRoutes(app, routesFile);
};
