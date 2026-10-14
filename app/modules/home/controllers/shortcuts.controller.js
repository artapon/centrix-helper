// Shortcuts page: everyone with the "Shortcuts" menu item can use it; administrators
// add, edit, reorder and delete groups and links (routes guarded with requireAdmin).
const shortcutsModel = require('../models/shortcuts.model');
const permissions = require('../../../core/permissions');
const view = require('../../../core/view')('home');

const PAGE = '/tools/shortcuts';
const back = (res, kind, message) => res.redirect(`${PAGE}?${kind}=${encodeURIComponent(message)}`);

exports.index = async function (req, res) {
  return res.renderPage(view('shortcuts'), {
    title: 'Shortcuts',
    groups: await shortcutsModel.listGrouped(),
    canEdit: req.user.role === permissions.ADMIN_ROLE,
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

// ─── Groups ───────────────────────────────────────────────────────────
exports.createGroup = async function (req, res) {
  if (!String(req.body.name || '').trim()) return back(res, 'error', 'Group name is required.');
  await shortcutsModel.createGroup(req.body);
  return back(res, 'success', `Group "${req.body.name.trim()}" added.`);
};

exports.updateGroup = async function (req, res) {
  if (!(await shortcutsModel.getGroup(req.params.id))) return back(res, 'error', 'Group not found.');
  if (!String(req.body.name || '').trim()) return back(res, 'error', 'Group name is required.');
  await shortcutsModel.updateGroup(req.params.id, req.body);
  return back(res, 'success', 'Group saved.');
};

exports.removeGroup = async function (req, res) {
  const group = await shortcutsModel.getGroup(req.params.id);
  if (!group) return back(res, 'error', 'Group not found.');
  await shortcutsModel.removeGroup(group.id);
  return back(res, 'success', `Group "${group.name}" and its links deleted.`);
};

exports.moveGroup = async function (req, res) {
  await shortcutsModel.moveGroup(req.params.id, req.body.direction === 'up' ? -1 : 1);
  return res.redirect(PAGE);
};

// ─── Links ────────────────────────────────────────────────────────────
async function validLink(body) {
  if (!String(body.title || '').trim()) return 'Link name is required.';
  if (!shortcutsModel.URL_RE.test(String(body.url || '').trim())) return 'Enter a full web address starting with http:// or https://.';
  if (!(await shortcutsModel.getGroup(body.group_id))) return 'Choose a group for the link.';
  return '';
}

exports.createLink = async function (req, res) {
  const error = await validLink(req.body);
  if (error) return back(res, 'error', error);
  await shortcutsModel.createLink(req.body);
  return back(res, 'success', `Link "${req.body.title.trim()}" added.`);
};

exports.updateLink = async function (req, res) {
  if (!(await shortcutsModel.getLink(req.params.id))) return back(res, 'error', 'Link not found.');
  const error = await validLink(req.body);
  if (error) return back(res, 'error', error);
  await shortcutsModel.updateLink(req.params.id, req.body);
  return back(res, 'success', 'Link saved.');
};

exports.removeLink = async function (req, res) {
  const link = await shortcutsModel.getLink(req.params.id);
  if (!link) return back(res, 'error', 'Link not found.');
  await shortcutsModel.removeLink(link.id);
  return back(res, 'success', `Link "${link.title}" deleted.`);
};

exports.moveLink = async function (req, res) {
  await shortcutsModel.moveLink(req.params.id, req.body.direction === 'up' ? -1 : 1);
  return res.redirect(PAGE);
};
