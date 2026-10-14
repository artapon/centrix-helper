// Reports > Settings (administrators): one page for the JasperServer connection, Centrix HIS
// registration and the defaults of the Print-Out Builder, Jasper Designer and Publish Report.
const view = require('../../../core/view').addon('jasperprintout');
const settingsModel = require('../models/settings.model');
const jasper = require('../models/jasper.service');
const his = require('../models/his.model');

const bad = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const json = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (!err.expose) console.error('Report Settings:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. The details are in the server log.' });
  }
};

exports.index = async function (req, res) {
  const [settings, org] = await Promise.all([settingsModel.forPage(), his.siteOrg(req.session)]);
  return res.renderPage(view('settings'), {
    title: 'Settings',
    settings,
    defaults: settingsModel.DEFAULTS,
    site: { connected: !!org, name: (req.session && req.session.site_name) || (org && org.name) || '', code: org ? org.code : '' }
  });
};

exports.save = json(async (req, res) => {
  const saved = await settingsModel.save(req.body);
  console.log(`Report settings saved by ${req.user.username}`);
  res.json({ ok: true, settings: saved });
});

// Tests one server's form values: { id, url, user, password, clearPassword, allowSelfSigned }
// (the stored password of that server when the field is left blank).
exports.test = json(async (req, res) => {
  const stored = await settingsModel.get();
  const b = req.body || {};
  const saved = stored.servers.find((sv) => sv.id === b.id) || {};
  const probe = {
    jasperUrl: String(b.url || '').trim().replace(/\/+$/, ''),
    jasperUser: String(b.user || '').trim(),
    jasperPassword: b.password ? String(b.password) : (b.clearPassword ? '' : saved.password || ''),
    allowSelfSigned: b.allowSelfSigned === true || b.allowSelfSigned === 'true'
  };
  if (!/^https?:\/\/\S+$/i.test(probe.jasperUrl)) throw bad('Enter the JasperServer URL, e.g. http://10.0.0.5:8080/jasperserver.');
  res.json(await jasper.test(probe));
});
