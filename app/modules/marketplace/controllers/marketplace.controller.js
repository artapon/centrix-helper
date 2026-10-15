// Marketplace: the add-ons under addons and whether each one is active (administrators only).
const addons = require('../../../core/addons');
const view = require('../../../core/view')('marketplace');

// Back to the list (at the add-on's card), or to the add-on's page when the change was made there.
const back = (res, kind, message, id, toDetail) => res.redirect(toDetail && id
  ? `${addons.MARKETPLACE_LINK}/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(message)}`
  : `${addons.MARKETPLACE_LINK}?${kind}=${encodeURIComponent(message)}${id ? '#addon-' + encodeURIComponent(id) : ''}`
);

exports.index = async function (req, res) {
  await addons.ready();
  return res.renderPage(view('marketplace'), {
    title: 'Marketplace',
    addons: addons.list(),
    pending: require('../models/install.service').pending(),
    canRestart: process.env.pm_id !== undefined,
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

// One add-on's page: description, features, needs, menu items, pages and activate / deactivate.
exports.detail = async function (req, res) {
  await addons.ready();
  const addon = addons.get(req.params.id);
  if (!addon) return back(res, 'error', 'Add-on not found.');
  return res.renderPage(view('addon'), {
    title: addon.name,
    addon,
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

async function setActive(req, res, on) {
  await addons.ready();
  const toDetail = (req.body || {}).from === 'detail';
  const addon = addons.get(req.params.id);
  if (!addon) return back(res, 'error', 'Add-on not found.');
  if (addon.active === on) return back(res, 'success', `${addon.name} is already ${on ? 'active' : 'inactive'}.`, addon.id, toDetail);
  try {
    await addons.setActive(addon.id, on, req.user);
  } catch (err) {
    if (!err.expose) throw err;
    return back(res, 'error', `${addon.name}: ${err.message}`, addon.id, toDetail);
  }
  console.log(`Add-on ${addon.id} ${on ? 'activated' : 'deactivated'} by ${req.user.username}`);
  return back(res, 'success', on
    ? `${addon.name} is active. Its menu items are back for administrators and for roles that have them.`
    : `${addon.name} is inactive. Its menu items are hidden and its pages are closed for everyone; its data is kept.`, addon.id, toDetail);
}

exports.activate = (req, res) => setActive(req, res, true);
exports.deactivate = (req, res) => setActive(req, res, false);

// ---- Developer guide and Upload add-on ----

const install = require('../models/install.service');

// The guide to building an add-on, with the starter add-on to download.
exports.guide = async function (req, res) {
  return res.renderPage(view('guide'), { title: 'Add-on developer guide' });
};

exports.starter = function (req, res) {
  const id = /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(req.query.id || '')) ? String(req.query.id) : 'my-addon';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
  res.send(install.starter(id, req.query.name));
};

// Step 1: the uploaded .zip is checked and kept for a few minutes; the page shows what installing it does.
exports.uploadPreview = async function (req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose an add-on package (.zip).' });
    res.json(install.inspect(req.file.buffer, req.user.username));
  } catch (err) {
    if (!err.expose) { console.error('Marketplace upload:', err); return res.status(500).json({ error: 'The package could not be read. The details are in the server log.' }); }
    res.status(err.status || 400).json({ error: err.message });
  }
};

// Step 2: install it, after the administrator confirmed they trust its code.
exports.uploadInstall = async function (req, res) {
  try {
    if (!req.body || req.body.trust !== true) return res.status(400).json({ error: 'Confirm that you trust this add-on\'s code first.' });
    const r = install.install(req.body.token, req.user.username);
    console.log(`Add-on ${r.id} ${r.version} ${r.update ? 'updated' : 'installed'} by ${req.user.username}${r.backup ? ' (previous version in ' + r.backup + ')' : ''}; loads after a restart.`);
    res.json(r);
  } catch (err) {
    if (!err.expose) { console.error('Marketplace install:', err); return res.status(500).json({ error: 'The add-on could not be installed. The details are in the server log.' }); }
    res.status(err.status || 400).json({ error: err.message });
  }
};

// ---- Restart (after installing add-ons) ----
// Only when the app runs under pm2 (it sets pm_id): the app exits and pm2 starts it again (autorestart).
// Started any other way, exiting would just stop it, so the page asks for a manual restart instead.
const underPm2 = () => process.env.pm_id !== undefined;
exports.canRestart = underPm2;

exports.restart = function (req, res) {
  if (!underPm2()) return res.status(409).json({ error: 'The app does not run under pm2 here, so it cannot restart itself. Restart it on the server.' });
  console.log(`Server restart requested by ${req.user.username} (Marketplace): exiting for pm2 to start it again.`);
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 600);       // after the answer has gone out
};
