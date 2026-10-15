const fs = require('fs');
const layout = require('../layout');
const addons = require('../addons');

const BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

// Values the old server-side templates printed via String(): keep the same text in the page data.
function replacer(key, value) {
  const raw = this[key];
  if (raw instanceof Date) return String(raw);
  if (raw && raw._bsontype) return raw.toString(); // ObjectId, Decimal128, Long
  return value;
}

// JSON that is safe to embed inside <script>
const serialize = (data) => JSON.stringify(data, replacer)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

// Splits a module view into its Vue template and the <script>/<style> blocks around it.
// Cached in production; in development views are re-read so edits show up immediately.
const CACHE_VIEWS = process.env.NODE_ENV === 'production';
const viewCache = new Map();

function readView(file) {
  if (CACHE_VIEWS && viewCache.has(file)) return viewCache.get(file);
  const src = fs.readFileSync(file, 'utf8');
  const blocks = [];
  const template = src.replace(BLOCK_RE, (block) => { blocks.push(block); return ''; });
  const view = { template, blocks };
  if (CACHE_VIEWS) viewCache.set(file, view);
  return view;
}

// Top-level locals that are undefined become null: JSON drops undefined keys, and the view then fails
// to mount with "<name> is not defined" (e.g. a query whose .catch only logged and returned nothing).
function definedLocals(locals) {
  const out = {};
  Object.keys(locals || {}).forEach((k) => { out[k] = locals[k] === undefined ? null : locals[k]; });
  return out;
}

/**
 * res.renderPage(viewFile, locals)
 * Renders the shared layout with the module view mounted as a Vue 2 page.
 * `locals` become the page's Vue data; view scripts can add options via Page.setup({...}).
 * locals.widgets: ids of add-on widgets the page can show (e.g. ['querystudio.basic-data']). It becomes
 * { id: { text, icon, component, link } } of those the user may use (core/addons.js widgetsFor), and their
 * scripts load before the page mounts; a page shows a widget only when its id is there.
 */
module.exports = (req, res, next) => {
  res.locals.menu = global.menu;
  res.renderPage = function (viewFile, locals = {}) {
    let view;
    try {
      view = readView(viewFile);
    } catch (err) {
      return next(err);
    }
    let widgetScripts = [];
    if (Array.isArray(locals.widgets)) {
      const widgets = addons.widgetsFor(req.user, locals.widgets);
      widgetScripts = Object.values(widgets).map((w) => `<script src="${w.script}"></script>`);
      locals = { ...locals, widgets };
    }
    const page = [
      '<div id="page-app" class="row"></div>',
      `<script type="text/x-template" id="page-template"><div class="row">${view.template}</div></script>`,
      `<script>Page.data = ${serialize(definedLocals(locals))};</script>`,
      ...widgetScripts,
      ...view.blocks,
      '<script>Page.mount();</script>',
    ].join('\n');
    return res.render("index", {
      locals: { ...locals, page, shell: layout.build(req, locals.title) },
      partials: {
        metadata: '/partials/metadata',
        navbar: '/partials/navbar',
        aside: '/partials/aside',
        footer: '/partials/footer'
      }
    });
  };
  next();
};

// Page-data JSON (same conversions as Page.data) for endpoints that feed a rendered page.
module.exports.toJson = serialize;
