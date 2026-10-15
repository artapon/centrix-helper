// Previous / Next paging for list pages: ?page=0, 1, … of `perPage` rows.
//
//   const paging = require('../../../core/http/paging');
//   const p = paging.read(req);                                   // { page, skip, limit, perPage }
//   const rows = await model.list(..., p);                       // the model adds paging.stages(p, oldLimit)
//   const { rows: shown, paging: pg } = paging.page(req, p, rows);
//   res.renderPage(view, { rows: shown, paging: pg });            // <page-pager :paging="paging"> (public/js/page.js)
//
// One row more than a page is read, so the page knows whether there is a next one without counting.
// The Previous / Next links are this page's own address with only `page` changed, so every filter stays.
const PER_PAGE = 50;

/** The page asked for: { page, skip, limit (perPage + 1), perPage }. */
exports.read = function (req, perPage = PER_PAGE) {
  const page = Math.max(0, Math.min(100000, parseInt(req.query && req.query.page, 10) || 0));
  return { page, skip: page * perPage, limit: perPage + 1, perPage };
};

/**
 * Aggregation stages for a model: with paging, $skip and $limit (one row past the page); without it the
 * model's old limit (or none), so its other callers are unchanged.
 */
exports.stages = function (p, fallbackLimit) {
  if (!p) return fallbackLimit ? [{ $limit: fallbackLimit }] : [];
  return (p.skip ? [{ $skip: p.skip }] : []).concat([{ $limit: p.limit }]);
};

// This page's address with `page` set (removed for the first page).
function hrefFor(req, page) {
  const url = new URL(req.originalUrl || req.url || '/', 'http://local');
  if (page > 0) url.searchParams.set('page', String(page)); else url.searchParams.delete('page');
  return url.pathname + (url.search || '');
}

/** The rows read with read(): the page's rows and what the pager shows. */
exports.page = function (req, p, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const shown = list.slice(0, p.perPage);
  const hasMore = list.length > p.perPage;
  return {
    rows: shown,
    paging: {
      page: p.page, perPage: p.perPage, hasMore,
      from: shown.length ? p.skip + 1 : 0, to: p.skip + shown.length,
      prev: p.page > 0 ? hrefFor(req, p.page - 1) : '',
      next: hasMore ? hrefFor(req, p.page + 1) : ''
    }
  };
};

exports.href = hrefFor;            // (req, page) → this page's address with only `page` changed
exports.PER_PAGE = PER_PAGE;
