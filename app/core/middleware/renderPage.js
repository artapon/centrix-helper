const fs = require('fs');
const layout = require('../layout');

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

/**
 * res.renderPage(viewFile, locals)
 * Renders the shared layout with the module view mounted as a Vue 2 page.
 * `locals` become the page's Vue data; view scripts can add options via Page.setup({...}).
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
    const page = [
      '<div id="page-app" class="row"></div>',
      `<script type="text/x-template" id="page-template"><div class="row">${view.template}</div></script>`,
      `<script>Page.data = ${serialize(locals)};</script>`,
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
