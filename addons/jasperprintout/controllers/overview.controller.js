// Reports > Overview: the reports work at a glance (designs, publishing, the UAT -> Production deploys,
// the JasperServers and the site's HIS report templates) as charts.
const view = require('../../../app/core/view').addon('jasperprintout');
const settingsModel = require('../models/settings.model');
const his = require('../models/his.model');
const overview = require('../models/overview.model');
const { ADMIN_ROLE } = require('../../../app/core/permissions');

const MONTHS = [6, 12, 24];

exports.index = async function (req, res) {
  const settings = await settingsModel.forPage('designer');
  return res.renderPage(view('overview'), {
    title: 'Reports Overview',
    servers: settings.servers.map((sv) => ({ name: sv.name, configured: sv.configured, zone: sv.zone || '' })),
    directPublish: settings.allowDirectPublish !== false,
    isAdmin: !!req.user && req.user.role === ADMIN_ROLE
  });
};

/** The dashboard's numbers for the last `months` months (6, 12 or 24). */
exports.data = async function (req, res) {
  try {
    const months = MONTHS.includes(parseInt(req.query.months, 10)) ? parseInt(req.query.months, 10) : 12;
    const org = await his.siteOrg(req.session);
    const d = await overview.get({ months, orgId: org && org._id });
    res.json(Object.assign(d, { site: org ? { name: org.name, code: org.code } : null }));
  } catch (err) {
    console.error('Reports Overview:', err);
    res.status(500).json({ error: 'The overview could not be read. The details are in the server log.' });
  }
};
