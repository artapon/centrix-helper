// Marketplace: the add-ons under app/addons and whether each one is active (administrators only).
const addons = require('../../../core/addons');
const view = require('../../../core/view')('marketplace');

const back = (res, kind, message, id) => res.redirect(
  `${addons.MARKETPLACE_LINK}?${kind}=${encodeURIComponent(message)}${id ? '#addon-' + encodeURIComponent(id) : ''}`
);

exports.index = async function (req, res) {
  await addons.ready();
  return res.renderPage(view('marketplace'), {
    title: 'Marketplace',
    addons: addons.list(),
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

async function setActive(req, res, on) {
  await addons.ready();
  const addon = addons.get(req.params.id);
  if (!addon) return back(res, 'error', 'Add-on not found.');
  if (addon.active === on) return back(res, 'success', `${addon.name} is already ${on ? 'active' : 'inactive'}.`, addon.id);
  try {
    await addons.setActive(addon.id, on, req.user);
  } catch (err) {
    if (!err.expose) throw err;
    return back(res, 'error', `${addon.name}: ${err.message}`, addon.id);
  }
  console.log(`Add-on ${addon.id} ${on ? 'activated' : 'deactivated'} by ${req.user.username}`);
  return back(res, 'success', on
    ? `${addon.name} is active. Its menu items are back for administrators and for roles that have them.`
    : `${addon.name} is inactive. Its menu items are hidden and its pages are closed for everyone; its data is kept.`, addon.id);
}

exports.activate = (req, res) => setActive(req, res, true);
exports.deactivate = (req, res) => setActive(req, res, false);
