// Builds the shared layout chrome (sidebar, top bar, page header) for res.renderPage.
// Layout partials interpolate raw strings, so everything that comes from config or the
// session is escaped here.

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const { version } = require('../../package.json');
const assets = require('./assets');
const permissions = require('./permissions');

// Menu headers mix "BILLING" and "Patient"; show long all-caps ones in title case (LIS/RIS stay).
const displayName = (text) => (/^[A-Z ]{4,}$/.test(text)
  ? text.toLowerCase().replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase())
  : text);

// Avatar letters; Thai leading vowels (เ แ โ ใ ไ) are skipped so สมชาย ใจดี gives สจ.
const initials = (text) => String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  .map((w) => w.replace(/^[\u0E40-\u0E44]/, '').charAt(0)).join('').slice(0, 2).toUpperCase();

// Only the menu items the signed-in user's role can open (see core/permissions.js).
const visibleMenu = (menu, user) => menu
  .map((section) => ({ ...section, items: section.items.filter((item) => item.active && permissions.canAccessItem(user, item)) }))
  .filter((section) => section.items.length);

function renderSidebar(menu, active) {
  return menu.map((section) => {
    const items = section.items;
    const isOpen = !!active && active.section.header === section.header;
    const id = 'nav-' + section.header.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `
      <div class="nav-group${isOpen ? ' is-open has-active' : ''}" data-group="${escapeHtml(id)}">
        <button type="button" class="nav-group-toggle" aria-expanded="${isOpen ? 'true' : 'false'}">
          <i class="nav-group-icon ${escapeHtml(section.icon || 'fas fa-folder')}" aria-hidden="true"></i>
          <span>${escapeHtml(section.header)}</span>
          <i class="fas fa-chevron-down nav-group-chevron"></i>
        </button>
        <ul class="nav-group-items">
          ${items.map((item) => {
            const isActive = !!active && active.item === item;
            return `
            <li>
              <a href="${escapeHtml(item.link)}" class="nav-item-link${isActive ? ' is-active' : ''}"${isActive ? ' aria-current="page"' : ''} title="${escapeHtml(item.text)}">
                <i class="nav-item-icon ${escapeHtml(item.icon)}"></i>
                <span class="nav-item-text">${escapeHtml(item.text)}</span>
              </a>
            </li>`;
          }).join('')}
        </ul>
      </div>`;
  }).join('');
}

/**
 * Values for the layout partials:
 *   shell.sidebar      sidebar navigation markup
 *   shell.section      menu section of the current page (breadcrumb)
 *   shell.siteName     connected site name, '' when not connected
 *   shell.siteColor    connection's "Mark with color" (#rrggbb) or ''
 *   shell.connected    whether a Mongo connection is active for this session
 *   shell.connectLink  where the connection chip goes: Manage Connections, or /database/info without that permission
 *   shell.canConnect   the user may connect (DB Info): the top bar shows Connect DB / Reconnect DB when not connected
 *   shell.lastSite     the site the app was connected to before it dropped ('' since start-up): "Reconnect DB"
 *   shell.here         this page's path, to come back to after connecting
 *   shell.user         signed-in user { username, name, initials, roleName, isAdmin }, escaped; null when signed out
 *   shell.title        page title as markup (controllers put HN/VN links in some titles)
 *   shell.docTitle     plain-text title for <title>
 *   shell.assetVersion cache-busting ?v= value for /css and /js
 */
exports.build = function (req, title) {
  const account = req.user || null;
  const isAdmin = !!account && account.role === 'admin';
  const menu = visibleMenu(global.menu || [], account);
  const active = permissions.findMenuItem(req.path);
  const connected = !!(req.session && req.session.dbconnected);
  return {
    sidebar: renderSidebar(menu, active),
    section: active ? escapeHtml(displayName(active.section.header)) : '',
    siteName: connected ? escapeHtml(req.session.site_name || '') : '',
    siteColor: connected && /^#[0-9a-f]{6}$/i.test(req.session.site_color || '') ? req.session.site_color : '',
    connected,
    // The connection chip opens Manage Connections (connect from there), or DB Info for roles without it.
    connectLink: account && permissions.canAccessPath(account, '/database/connections') ? '/database/connections' : '/database/info',
    canConnect: !connected && !!account && permissions.canAccessPath(account, '/database/connect/last'),
    lastSite: !connected ? escapeHtml((global.sessionData && global.sessionData.site_name) || '') : '',
    here: escapeHtml(req.originalUrl || '/'),
    title: title || 'Centrix HIS Helper Tools',
    docTitle: escapeHtml(String(title || 'Centrix HIS Helper Tools').replace(/<[^>]*>/g, '')),
    user: account && {
      username: escapeHtml(account.username),
      name: escapeHtml(account.name || account.username),
      initials: escapeHtml(initials(account.name || account.username)),
      roleName: escapeHtml(account.roleName || account.role),
      isAdmin
    },
    version: escapeHtml(version),
    assetVersion: assets.version,
    year: new Date().getFullYear()
  };
};

exports.escapeHtml = escapeHtml;
