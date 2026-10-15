// Role-based access, keyed by menu item: a role is granted menu links (menu.config.js), and
// a request for a page under a link the role lacks is refused. Administrators have every
// permission; items marked adminOnly (user and role management) are never grantable.
// Add-on widgets are granted the same way: they sit in a hidden "Widgets" section of the menu
// (link /widgets/<addon>/<key>, see core/addons.js) that the sidebar doesn't draw.

const ADMIN_ROLE = 'admin';

const linkPath = (link) => String(link || '').split('?')[0];

const pathMatches = (path, link) => (link === '/' ? path === '/' : path === link || path.startsWith(link + '/'));

/**
 * The active menu item that owns a request path: the longest matching link wins, so
 * /patients/summary belongs to "Patient Summary" rather than a shorter prefix.
 * "/" serves the Overview dashboard. Returns { section, item, link } or null.
 */
function findMenuItem(path, menu = global.menu || []) {
  let best = null;
  menu.forEach((section) => {
    section.items.filter((item) => item.active).forEach((item) => {
      const links = [linkPath(item.link)].concat(item.match || []);
      links.forEach((link) => {
        if (pathMatches(path, link) && (!best || link.length > best.length)) {
          best = { section, item, link: linkPath(item.link), length: link.length };
        }
      });
    });
  });
  if (!best && path === '/') return findMenuItem('/overview', menu);
  return best;
}

// Actions inside a page (menu item "actions": [{ key, text, description }]) are granted on their
// own as "<link>#<key>", e.g. "/reports/publish#deploy-prod". An action only counts together with
// its page: a role without the page can't use it either.
const ACTION_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const actionPermission = (link, key) => `${linkPath(link)}#${key}`;
const itemActions = (item) => (Array.isArray(item.actions) ? item.actions : [])
  .filter((a) => a && ACTION_KEY.test(String(a.key || '')) && a.text)
  .map((a) => ({ key: String(a.key), text: String(a.text), description: String(a.description || ''), permission: actionPermission(item.link, a.key) }));

// Menu items an administrator can grant to a role, grouped by menu section, each with its actions.
function grantableMenu(menu = global.menu || []) {
  return menu
    .map((section) => ({
      header: section.header,
      ...(section.hidden ? { widgets: true } : {}),
      items: section.items
        .filter((item) => item.active && !item.adminOnly)
        .map((item) => ({
          text: item.text, icon: item.icon, permission: linkPath(item.link), actions: itemActions(item),
          ...(item.widget ? { widget: true, description: item.description || '', source: item.source || '' } : {})
        }))
    }))
    .filter((section) => section.items.length);
}

const grantablePermissions = () => grantableMenu().flatMap((section) => section.items.flatMap((item) => [item.permission].concat(item.actions.map((a) => a.permission))));

// Whether the user may do an action of a page: administrators always; others need both grants.
function canDo(user, link, key) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  const page = linkPath(link);
  return !!user.permissions && user.permissions.has(page) && user.permissions.has(actionPermission(page, key));
}

// { key: true | false } for every action of a page's menu item, for the page's buttons.
function actionsFor(user, link, menu = global.menu || []) {
  const page = linkPath(link);
  const out = {};
  menu.forEach((section) => section.items.forEach((item) => {
    if (linkPath(item.link) === page) itemActions(item).forEach((a) => { out[a.key] = canDo(user, page, a.key); });
  }));
  return out;
}

// The action's label in the menu, for "Your role can't …" messages.
function actionText(link, key, menu = global.menu || []) {
  const page = linkPath(link);
  for (const section of menu) {
    for (const item of section.items) {
      if (linkPath(item.link) !== page) continue;
      const a = itemActions(item).find((x) => x.key === key);
      if (a) return a.text;
    }
  }
  return key;
}

// user.permissions is a Set of granted links, loaded by requireAuth.
function canAccessItem(user, item) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  if (item.adminOnly) return false;
  return !!user.permissions && user.permissions.has(linkPath(item.link));
}

// Whether the user may open a path (paths outside the menu are open to every signed-in user).
function canAccessPath(user, path, menu = global.menu || []) {
  const owner = findMenuItem(path, menu);
  return !owner || canAccessItem(user, owner.item);
}

// Where "/" should send a user whose role does not include the Overview.
function firstAccessibleLink(user, menu = global.menu || []) {
  for (const section of menu.filter((s) => !s.hidden)) {
    const item = section.items.find((it) => it.active && canAccessItem(user, it));
    if (item) return item.link;
  }
  return '/account';
}

module.exports = {
  ADMIN_ROLE, linkPath, findMenuItem, grantableMenu, grantablePermissions, canAccessItem, canAccessPath, firstAccessibleLink,
  actionPermission, itemActions, canDo, actionsFor, actionText
};
