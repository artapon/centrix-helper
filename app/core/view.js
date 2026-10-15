const path = require('path');

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const ADDONS_DIR = path.join(__dirname, '..', '..', 'addons');
const SHARED_VIEWS_DIR = path.join(__dirname, 'views', 'shared');

// Absolute view paths (ending in .html) are used as-is by express-es6-template-engine,
// so module views can live next to their controllers instead of under app.set('views').
const moduleView = (moduleName, name) => path.join(MODULES_DIR, moduleName, 'views', `${name}.html`);

/**
 * const view = require('../../../core/view')('billing');
 * view('patientbills')           -> app/modules/billing/views/patientbills.html
 * view.of('patients', 'summary') -> app/modules/patients/views/summary.html
 * view.shared('postdata')        -> app/core/views/shared/postdata.html
 *
 * require('../../../app/core/view').addon('querystudio')('audit') -> addons/querystudio/views/audit.html
 */
module.exports = function (moduleName) {
  const view = (name) => moduleView(moduleName, name);
  view.of = moduleView;
  view.shared = (name) => path.join(SHARED_VIEWS_DIR, `${name}.html`);
  return view;
};

module.exports.addon = function (addonId) {
  const view = (name) => path.join(ADDONS_DIR, addonId, 'views', `${name}.html`);
  view.of = moduleView;
  view.shared = (name) => path.join(SHARED_VIEWS_DIR, `${name}.html`);
  return view;
};
