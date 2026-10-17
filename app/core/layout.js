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

// Only the menu items the signed-in user's role can open (see core/permissions.js); the hidden
// Widgets section (permissions of add-on widgets) is not drawn.
const visibleMenu = (menu, user) => menu
  .filter((section) => !section.hidden)
  .map((section) => ({ ...section, items: section.items.filter((item) => item.active && permissions.canAccessItem(user, item)) }))
  .filter((section) => section.items.length);

// Sub-items an add-on lists under one of its menu items at run time (Service Monitor: its organizations):
// submenu(link, provider), provider() -> [{ text, link, icon?, color? }] with links under the item's own,
// so they share its permission. The provider is called on every page, so it answers from memory.
const submenus = new Map();
exports.submenu = (link, provider) => { submenus.set(permissions.linkPath(link), provider); };

const pathUnder = (path, link) => path === link || path.startsWith(link + '/');

function subItems(item, path) {
  const provider = submenus.get(permissions.linkPath(item.link));
  if (!provider) return [];
  let list;
  try { list = provider() || []; } catch (err) { console.error(`Sub-menu of ${item.link} failed:`, err); return []; }
  const own = permissions.linkPath(item.link) + '/';
  const subs = list.filter((s) => s && s.text && String(s.link || '').startsWith(own));
  // the longest link the path is under is the active one
  const active = subs.filter((s) => pathUnder(path, permissions.linkPath(s.link)))
    .sort((a, b) => b.link.length - a.link.length)[0];
  return subs.map((s) => ({ ...s, active: s === active }));
}

function renderSidebar(menu, active, path) {
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
            const subs = subItems(item, path || '');
            // with a sub-item active, the item itself is its parent, not the current page
            const subActive = subs.some((s) => s.active);
            const isActive = !!active && active.item === item && !subActive;
            return `
            <li${subs.length ? ' class="has-sub"' : ''}>
              <a href="${escapeHtml(item.link)}" class="nav-item-link${isActive ? ' is-active' : ''}${subActive ? ' is-parent' : ''}"${isActive ? ' aria-current="page"' : ''} title="${escapeHtml(item.text)}">
                <i class="nav-item-icon ${escapeHtml(item.icon)}"></i>
                <span class="nav-item-text">${escapeHtml(item.text)}</span>
              </a>${subs.length ? `
              <ul class="nav-sub-items">
                ${subs.map((s) => `
                <li>
                  <a href="${escapeHtml(s.link)}" class="nav-item-link is-sub${s.active ? ' is-active' : ''}"${s.active ? ' aria-current="page"' : ''} title="${escapeHtml(s.text)}">
                    ${/^#[0-9a-f]{6}$/i.test(s.color || '')
                      ? `<span class="nav-sub-dot" style="background:${s.color}" aria-hidden="true"></span>`
                      : `<i class="nav-item-icon ${escapeHtml(s.icon || 'fas fa-angle-right')}"></i>`}
                    <span class="nav-item-text">${escapeHtml(s.text)}</span>
                  </a>
                </li>`).join('')}
              </ul>` : ''}
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
 *   shell.connectLink  where the connection chip goes: DB Connections, or /database/info without that permission
 *   shell.canConnect   the user may connect (DB Info): the top bar shows Connect DB / Reconnect DB when not connected
 *   shell.lastSite     the site the app was connected to before it dropped ('' since start-up): "Reconnect DB"
 *   shell.here         this page's path, to come back to after connecting
 *   shell.user         signed-in user { username, name, initials, roleName, isAdmin }, escaped; null when signed out
 *   shell.title        page title as markup (controllers put HN/VN links in some titles); not drawn since
 *                      the page header was removed, the breadcrumb shows docTitle
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
    sidebar: renderSidebar(menu, active, req.path),
    section: active ? escapeHtml(displayName(active.section.header)) : '',
    siteName: connected ? escapeHtml(req.session.site_name || '') : '',
    siteColor: connected && /^#[0-9a-f]{6}$/i.test(req.session.site_color || '') ? req.session.site_color : '',
    connected,
    // The connection chip opens DB Connections (connect from there), or DB Info for roles without it.
    connectLink: account && permissions.canAccessPath(account, '/database/connections') ? '/database/connections' : '/database/info',
    canConnect: !connected && !!account && permissions.canAccessPath(account, '/database/connect/last'),
    lastSite: !connected ? escapeHtml((global.sessionData && global.sessionData.site_name) || '') : '',
    here: escapeHtml(req.originalUrl || '/'),
    title: title || 'Centrix Suite',
    docTitle: escapeHtml(String(title || 'Centrix Suite').replace(/<[^>]*>/g, '')),
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
