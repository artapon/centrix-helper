// Roles and the menu items each one may open (administrators only).
const permissions = require('../../../core/permissions');
const addons = require('../../../core/addons');
const rolesModel = require('../models/roles.model');
const view = require('../../../core/view')('auth');

const ROLES_URL = '/admin/roles';
const back = (res, kind, message) => res.redirect(`${ROLES_URL}?${kind}=${encodeURIComponent(message)}`);

// Checked boxes arrive as permissions[] (one value or many); keep only grantable menu links.
function submittedPermissions(body) {
  const raw = [].concat(body.permissions || body['permissions[]'] || []);
  const grantable = new Set(permissions.grantablePermissions());
  return [...new Set(raw.map(String))].filter((p) => grantable.has(p));
}

// Internal role key from the name; names without Latin letters (e.g. Thai) get a generated key.
const toKey = (name) => {
  const slug = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return rolesModel.KEY_RE.test(slug) ? slug : 'role-' + Date.now().toString(36);
};

exports.index = async function (req, res) {
  const [roles, permissionMap] = await Promise.all([rolesModel.list(), rolesModel.permissionMap()]);
  // Only current menu items count (a link removed from menu.config.js may still be stored).
  const grantable = new Set(permissions.grantablePermissions());
  return res.renderPage(view('roles'), {
    title: 'Roles & Permissions',
    roles: roles.map((role) => ({ ...role, permissions: (permissionMap[role.key] || []).filter((p) => grantable.has(p)) })),
    menu: permissions.grantableMenu(),
    adminRole: permissions.ADMIN_ROLE,
    success: req.query.success || '',
    error: req.query.error || ''
  });
};

exports.create = async function (req, res) {
  const name = String(req.body.name || '').trim();
  if (!name) return back(res, 'error', 'Role name is required.');
  const key = toKey(name);
  if (await rolesModel.getByKey(key)) return back(res, 'error', `A role with the key "${key}" already exists.`);

  await rolesModel.create({ key, name, description: req.body.description });
  await rolesModel.setPermissions(key, submittedPermissions(req.body));
  return back(res, 'success', `Role "${name}" created.`);
};

exports.update = async function (req, res) {
  const role = await rolesModel.getByKey(req.params.key);
  if (!role) return back(res, 'error', 'Role not found.');
  if (role.key === permissions.ADMIN_ROLE) return back(res, 'error', 'The Administrator role always has full access and cannot be changed.');

  const name = String(req.body.name || '').trim();
  if (!name) return back(res, 'error', 'Role name is required.');

  await rolesModel.update(role.key, { name, description: req.body.description });
  // Grants for a deactivated add-on are not in the form; keep them for when it is activated again.
  const dormant = addons.dormantPermissions();
  const kept = (await rolesModel.permissions(role.key)).filter((p) => dormant.has(p));
  await rolesModel.setPermissions(role.key, [...new Set(submittedPermissions(req.body).concat(kept))]);
  return back(res, 'success', `Role "${name}" saved. Changes apply on users' next page load.`);
};

exports.remove = async function (req, res) {
  const roles = await rolesModel.list();
  const role = roles.find((r) => r.key === req.params.key);
  if (!role) return back(res, 'error', 'Role not found.');
  if (role.is_system) return back(res, 'error', 'Built-in roles cannot be deleted.');
  if (role.user_count > 0) {
    return back(res, 'error', `"${role.name}" is assigned to ${role.user_count} user(s). Move them to another role first.`);
  }
  await rolesModel.remove(role.key);
  return back(res, 'success', `Role "${role.name}" deleted.`);
};
