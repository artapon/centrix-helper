// Add-ons: optional features under addons/<id>/ that an administrator activates or
// deactivates from Administration > Marketplace. Each add-on folder has an addon.json manifest
// (name, description, the paths it owns, its menu section) and the usual routes files.
//
// Widgets ("widgets" in addon.json) are parts of an add-on that other pages can show, e.g. Query
// Studio's Basic Data popup in Jasper Designer. Each one has its own link, /widgets/<addon>/<key>,
// which is a permission like a page's (Roles & Permissions > Widgets) and serves the widget's script
// (<link>/widget.js) and data; a page asks for widgets by id (res.renderPage locals.widgets) and gets
// those the user may use. Pages never load another add-on's code, so add-ons stay independent.
//
// The active state is kept in SQLite app_meta ("addon.<id>" -> {"active","by","at"}), so it
// survives restarts and applies at once without one: an inactive add-on's menu section is
// left out of global.menu (so roles cannot be granted it) and its pages answer "not active".
const fs = require('fs');
const path = require('path');
const { run, all } = require('./config/sqlite');

const ADDONS_DIR = path.join(__dirname, '..', '..', 'addons');
const META_PREFIX = 'addon.';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ADMIN_SECTION = 'Administration';
const WIDGETS_SECTION = 'Widgets';
const COMPONENT_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const MARKETPLACE_ITEM = { text: 'Marketplace', icon: 'fas fa-store', link: '/admin/marketplace', active: true, adminOnly: true };

let manifests = null;          // id -> manifest, in folder-name order
const state = new Map();       // id -> { active, by, at } as stored
let baseMenu = null;           // menu.config.js as loaded, before add-ons
let ready = Promise.resolve();

const linkPath = (link) => String(link || '').split('?')[0];
const under = (p, prefix) => p === prefix || p.startsWith(prefix + '/');

function readManifest(id) {
  const file = path.join(ADDONS_DIR, id, 'addon.json');
  if (!ID_RE.test(id) || !fs.existsSync(file)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (m.id !== id) throw new Error(`"id" must be "${id}" (the folder name)`);
    if (!m.name) throw new Error('"name" is required');
    const items = (m.menu && Array.isArray(m.menu.items) ? m.menu.items : [])
      .filter((item) => item && item.text && item.link)
      .map((item) => ({
        text: String(item.text), icon: String(item.icon || 'fas fa-puzzle-piece'), link: String(item.link), active: true,
        ...(item.adminOnly ? { adminOnly: true } : {}),
        // Actions inside the page, granted on their own (see core/permissions.js)
        ...(Array.isArray(item.actions) && item.actions.length ? { actions: item.actions.filter((a) => a && a.key && a.text).map((a) => ({ key: String(a.key), text: String(a.text), description: String(a.description || '') })) } : {})
      }));
    // Widgets other pages can show; each is granted on its own (see the top of this file)
    const widgets = (Array.isArray(m.widgets) ? m.widgets : [])
      .filter((w) => w && ID_RE.test(String(w.key || '')) && w.text && COMPONENT_RE.test(String(w.component || '')))
      .map((w) => ({
        id: `${id}.${w.key}`, text: String(w.text), icon: String(w.icon || 'fas fa-puzzle-piece'),
        description: String(w.description || ''), component: String(w.component),
        link: `/widgets/${id}/${w.key}`, active: true, widget: true
      }));
    return {
      id,
      name: String(m.name),
      version: String(m.version || '1.0.0'),
      author: String(m.author || ''),
      category: String(m.category || 'Other'),
      icon: String(m.icon || 'fas fa-puzzle-piece'),
      summary: String(m.summary || ''),
      description: String(m.description || ''),
      features: Array.isArray(m.features) ? m.features.map(String) : [],
      requires: Array.isArray(m.requires) ? m.requires.map(String) : [],
      // npm packages the add-on loads; while one is missing it cannot be activated.
      packages: Array.isArray(m.packages) ? m.packages.map(String) : [],
      defaultActive: m.defaultActive !== false,
      // Paths the add-on owns: its menu links plus any listed (APIs under them are covered too).
      paths: [...new Set((Array.isArray(m.paths) ? m.paths.map(String) : []).concat(items.map((item) => linkPath(item.link)), widgets.map((w) => w.link)))],
      widgets,
      menu: items.length ? { header: String((m.menu && m.menu.header) || m.name), icon: String((m.menu && m.menu.icon) || m.icon || 'fas fa-puzzle-piece'), after: (m.menu && m.menu.after) || '', items } : null
    };
  } catch (err) {
    console.error(`Add-on "${id}" skipped: addon.json is not valid (${err.message}).`);
    return null;
  }
}

function discover() {
  if (manifests) return manifests;
  manifests = new Map();
  if (!fs.existsSync(ADDONS_DIR)) return manifests;
  fs.readdirSync(ADDONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .forEach((id) => {
      const m = readManifest(id);
      if (m) manifests.set(id, m);
    });
  return manifests;
}

const ROOT_DIR = path.join(__dirname, '..', '..');
const missingPackages = (m) => m.packages.filter((name) => {
  try { require.resolve(name, { paths: [ROOT_DIR] }); return false; } catch (err) { return true; }
});

const isActive = (id) => {
  const m = discover().get(id);
  if (!m || missingPackages(m).length) return false;
  const s = state.get(id);
  return s ? s.active : m.defaultActive;
};

// The add-on that owns a request path (longest matching prefix), or null.
function ownerOf(p) {
  let best = null;
  discover().forEach((m) => m.paths.forEach((prefix) => {
    if (under(p, prefix) && (!best || prefix.length > best.length)) best = { addon: m, length: prefix.length };
  }));
  return best && best.addon;
}

// An item with `after: "<link>"` moves to just below that item of its section (e.g. a
// menu.config.js item placed among an add-on's items); without that item it stays put.
function placeAfter(section) {
  section.items.filter((item) => item.after).forEach((item) => {
    const from = section.items.indexOf(item);
    const target = section.items.findIndex((other) => linkPath(other.link) === linkPath(item.after));
    if (target < 0 || target === from) return;
    section.items.splice(from, 1);
    section.items.splice(target > from ? target : target + 1, 0, item);
  });
}

/**
 * global.menu = menu.config.js, without items that belong to an add-on (older configs still
 * list Query Data), plus Marketplace under Administration and a section per active add-on.
 */
function composeMenu() {
  if (!baseMenu) baseMenu = global.menu || [];
  const menu = baseMenu
    .map((section) => ({ ...section, items: section.items.filter((item) => !ownerOf(linkPath(item.link))) }))
    .filter((section) => section.items.length);

  let admin = menu.find((section) => section.header === ADMIN_SECTION);
  if (!admin) menu.push(admin = { header: ADMIN_SECTION, items: [] });
  if (!admin.items.some((item) => linkPath(item.link) === MARKETPLACE_ITEM.link)) admin.items = admin.items.concat(MARKETPLACE_ITEM);

  discover().forEach((m) => {
    if (!m.menu || !isActive(m.id)) return;
    const items = m.menu.items.map((item) => ({ ...item, addon: m.id }));
    const same = menu.find((section) => section.header === m.menu.header);
    if (same) { same.items = same.items.concat(items); return; }
    const section = { header: m.menu.header, icon: m.menu.icon, addon: m.id, items };
    const after = menu.findIndex((s) => s.header === m.menu.after);
    const at = after >= 0 ? after + 1 : menu.indexOf(admin);
    menu.splice(at, 0, section);
  });
  menu.forEach(placeAfter);

  // Widgets of active add-ons: a section for permissions only (not drawn in the sidebar)
  const widgets = [];
  discover().forEach((m) => {
    if (isActive(m.id)) m.widgets.forEach((w) => widgets.push({ ...w, addon: m.id, source: m.name }));
  });
  if (widgets.length) menu.push({ header: WIDGETS_SECTION, icon: 'fas fa-puzzle-piece', hidden: true, items: widgets });
  global.menu = menu;
  return menu;
}

async function load() {
  const rows = await all('SELECT key, value FROM app_meta WHERE key LIKE ?', [META_PREFIX + '%']);
  state.clear();
  rows.forEach((row) => {
    try {
      const v = JSON.parse(row.value);
      state.set(row.key.slice(META_PREFIX.length), { active: !!v.active, by: v.by || '', at: v.at || '' });
    } catch (err) { /* ignore a malformed row: the manifest default applies */ }
  });
}

// Page actions new to this install go to the roles that have their page (roles.model.grantNewActions);
// widgets new to this install go to every role that has any permission, so no one loses what a page showed.
function grantNewActions() {
  const roles = require('../modules/auth/models/roles.model');
  const widgetLinks = (global.menu || []).filter((s) => s.header === WIDGETS_SECTION).flatMap((s) => s.items.map((w) => w.link));
  return roles.grantNewActions(require('./permissions').grantableMenu())
    .then(() => roles.grantNewWidgets(widgetLinks))
    .catch((err) => console.error('Failed to grant new page actions / widgets:', err.message));
}

/** Reads the manifests and builds the menu now; the stored states follow once SQLite is ready. */
exports.init = function (schemaReady) {
  discover();
  composeMenu();
  ready = Promise.resolve(schemaReady)
    .then(load)
    .then(composeMenu)
    .then(grantNewActions)
    .catch((err) => console.error('Failed to load add-on settings:', err.message));
  return ready;
};

exports.ready = () => ready;

/** Mounts addons/<id>/<routesFile> for every add-on; requests reach it only while it is active. */
exports.mountRoutes = function (app, routesFile) {
  discover().forEach((m) => {
    const file = path.join(ADDONS_DIR, m.id, routesFile);
    if (!fs.existsSync(file)) return;
    const missing = missingPackages(m);
    if (missing.length) {
      console.warn(`Add-on "${m.id}" is not loaded: missing npm package(s) ${missing.join(', ')}. Run: npm install ${missing.join(' ')}`);
      return;
    }
    const router = require(file);
    app.use((req, res, next) => (isActive(m.id) ? router(req, res, next) : next()));
  });
};

/** Marketplace listing: manifests with their current state. */
exports.list = () => [...discover().values()].map((m) => {
  const s = state.get(m.id);
  return { ...m, active: isActive(m.id), missing: missingPackages(m), changedBy: s ? s.by : '', changedAt: s ? s.at : '' };
});

exports.get = (id) => exports.list().find((m) => m.id === id) || null;
exports.isActive = isActive;
exports.ownerOf = ownerOf;

exports.setActive = async function (id, on, user) {
  if (!discover().has(id)) {
    const err = new Error('Add-on not found.');
    err.status = 404;
    throw err;
  }
  const missing = missingPackages(discover().get(id));
  if (on && missing.length) {
    const err = new Error(`Install ${missing.join(', ')} first (npm install ${missing.join(' ')}), then restart the server.`);
    err.status = 409;
    err.expose = true;
    throw err;
  }
  const rec = { active: !!on, by: (user && user.username) || '', at: new Date().toISOString() };
  await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [META_PREFIX + id, JSON.stringify(rec)]);
  state.set(id, rec);
  composeMenu();
  if (on) await grantNewActions();
  return rec;
};

// Menu links of inactive add-ons: kept in a role's permissions when the role is saved,
// so activating the add-on again restores what each role had.
exports.dormantPermissions = () => {
  const links = new Set();
  discover().forEach((m) => {
    if (!isActive(m.id)) m.widgets.forEach((w) => links.add(w.link));
    if (m.menu && !isActive(m.id)) {
      m.menu.items.forEach((item) => {
        links.add(linkPath(item.link));
        (item.actions || []).forEach((a) => links.add(`${linkPath(item.link)}#${a.key}`));
      });
    }
  });
  return links;
};

/**
 * The widgets a page asked for (ids like "querystudio.basic-data") that the user may use: from an
 * active add-on and granted to the user's role. { id: { text, icon, component, link, script } };
 * a page shows a widget's button only when its id is there.
 */
exports.widgetsFor = function (user, ids) {
  const permissions = require('./permissions');
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
  const out = {};
  (global.menu || []).filter((s) => s.header === WIDGETS_SECTION).forEach((s) => s.items.forEach((w) => {
    if (wanted.has(w.id) && permissions.canAccessItem(user, w)) {
      out[w.id] = { text: w.text, icon: w.icon, component: w.component, link: w.link, script: w.link + '/widget.js' };
    }
  }));
  return out;
};

exports.WIDGETS_SECTION = WIDGETS_SECTION;
exports.MARKETPLACE_LINK = MARKETPLACE_ITEM.link;
