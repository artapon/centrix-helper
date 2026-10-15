const mongoose = require("mongoose");
const model = require("../models/querydata.model");
const { QueryError } = require("../../../app/core/helpers/shellquery.helper");
const view = require('../../../app/core/view').addon('querystudio');
const permissions = require('../../../app/core/permissions');

// Query Data: a read-only mongo-shell query editor with a visual query builder.
exports.index = async function (req, res) {
  return res.renderPage(view('querydata'), {
    title: 'Query Data : ' + mongoose.connection.name,
    dbName: mongoose.connection.name,
    connection: Object.assign(currentConnection(), { canSwitch: canSwitchDb(req) }),
    canEditTemplates: permissions.canAccessPath(req.user, '/query-studio/templates'),
    censor: { on: await censor.isOn(), canChange: !!req.user && req.user.role === permissions.ADMIN_ROLE }
  });
};

// Query mistakes come back as 400 with the position to mark in the editor; MongoDB errors as 400 too.
function fail(res, err) {
  if (err instanceof QueryError) return res.status(400).json({ error: err.message, line: err.line, col: err.col });
  const message = [err.codeName, err.errmsg || err.message].filter(Boolean).join(': ');
  console.error('Query Data:', message);
  return res.status(400).json({ error: message || 'Query failed' });
}

const handle = (fn) => async (req, res) => {
  try {
    return res.json(await fn(req));
  } catch (err) {
    return fail(res, err);
  }
};

exports.collections = handle(() => model.collections());
exports.indexes = handle((req) => model.indexes(req.params.name));
exports.schema = handle((req) => model.schema(req.params.name));
// Run / Count / Explain are written to the Query Data audit log (Query Data Audit page), failures included.
const audit = require("../../../app/core/models/queryaudit.model");
const audited = (action, fn) => async (req, res) => {
  const startedAt = Date.now();
  let result = null, error = null;
  try {
    result = await fn(req);
  } catch (err) {
    error = err;
  }
  const auditId = await audit.record({ req, action, startedAt, ms: Date.now() - startedAt, result, error });
  // An export's first batch: the page finishes this audit row when the file is made (exportDone).
  if (action === 'export' && result) result.auditId = auditId;
  return error ? fail(res, error) : res.json(result);
};

exports.run = audited('run', (req) => model.run(req.body || {}));
exports.count = audited('count', (req) => model.count(req.body || {}));
exports.explain = audited('explain', (req) => model.explain(req.body || {}));
// Export: the first batch is audited (who exported what, when); the rest of the batches are not.
const exportAudited = audited('export', (req) => model.exportBatch(req.body || {}));
const exportPlain = handle((req) => model.exportBatch(req.body || {}));
exports.exportBatch = (req, res) => (parseInt((req.body || {}).page, 10) > 0 ? exportPlain : exportAudited)(req, res);
exports.exportDone = handle(async (req) => ({ ok: await audit.finishExport(req, req.body || {}) }));
exports.kill = handle((req) => model.kill(req.body || {}));
// The editor's query as a Jaspersoft MongoDB query (for a JRXML report); nothing is run.
const jasperQuery = require("../models/jasperquery.helper");
exports.toJasper = handle((req) => jasperQuery.convert(String((req.body || {}).query || ""), { useParams: !!(req.body || {}).useParams }));
// A Jaspersoft MongoDB query back to Query Data syntax; nothing is run.
exports.fromJasper = handle((req) => {
  const b = req.body || {};
  return jasperQuery.fromJasper(String(b.text || ""), { values: b.values });
});

// ---- saved queries (private to the signed-in user) ----
const saved = require("../models/savedqueries.model");
const { parse } = require("../../../app/core/helpers/shellquery.helper");
const owner = (req) => (req.user && req.user.username) || (req.auth && req.auth.user) || '';

exports.savedList = handle((req) => saved.list(owner(req), req.query.type === 'jasper' ? 'jasper' : 'query'));

// Saves the query under a name (replacing one with the same name); only a valid query is saved.
exports.save = handle(async (req) => {
  const name = String((req.body && req.body.name) || '').trim();
  const query = String((req.body && req.body.query) || '');
  if (!name) throw new QueryError('Give the query a name', null);
  if (name.length > saved.MAX_NAME) throw new QueryError(`Keep the name under ${saved.MAX_NAME} characters`, null);
  if (query.length > saved.MAX_QUERY) throw new QueryError('The query is too long to save', null);
  if ((req.body || {}).type === 'jasper') {
    // A Jaspersoft MongoDB query (from "To Jasper"): checked by reading it back; its $P{} parameters are kept.
    const back = jasperQuery.fromJasper(query, {});
    const params = (Array.isArray(req.body.params) ? req.body.params : [])
      .filter((x) => x && /^[\w.$-]{1,100}$/.test(String(x.name || '')))
      .slice(0, 50)
      .map((x) => ({ name: String(x.name), cls: /^[\w.$]{1,120}$/.test(String(x.cls || '')) ? String(x.cls) : 'java.lang.String', def: String(x.def || '').slice(0, 500) }));
    back.params.forEach((x) => { if (!params.some((y) => y.name === x.name)) params.push({ name: x.name, cls: 'java.lang.String', def: '' }); });
    const replaced = !!(await saved.findByName(owner(req), name));
    const id = await saved.save(owner(req), { name, collection: back.collection, query, type: 'jasper', meta: { params, method: back.method } });
    return { id, name, collection: back.collection, replaced, type: 'jasper' };
  }
  const q = parse(query);
  const replaced = !!(await saved.findByName(owner(req), name));
  const id = await saved.save(owner(req), { name, collection: q.collection, query });
  return { id, name, collection: q.collection, replaced };
});

exports.savedRemove = handle(async (req) => {
  await saved.remove(owner(req), parseInt(req.params.id, 10));
  return { ok: true };
});

// ---- Widgets ("widgets" in addon.json): other pages show them to roles granted the widget ----
// Their scripts are this add-on's browser components; the data comes from the handlers below and
// basicData / basicVisit / basicHn, all under /widgets/querystudio/<key> (the widget's permission).
const WIDGET_DIR = require('path').join(__dirname, '..', 'public');
exports.widgetScript = (file) => (req, res) => res.type('application/javascript').sendFile(require('path').join(WIDGET_DIR, file));

// Saved Jasper queries widget: the signed-in user's queries saved from Query Data → To Jasper → Save.
exports.jasperQueries = handle(async (req) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = await saved.list(owner(req), 'jasper');
  if (q) list = list.filter((x) => (x.name + ' ' + x.collection + ' ' + x.query).toLowerCase().includes(q));
  return { queries: list.slice(0, 200) };
});
exports.jasperQueryRemove = handle(async (req) => {
  await saved.remove(owner(req), parseInt(req.params.id, 10), 'jasper');
  return { ok: true };
});

// ---- View a result row: its ObjectId fields looked up in the collections they point to ----
const lookupModel = require("../../../app/core/models/lookup.model");
exports.lookup = handle((req) => lookupModel.lookup(req.body || {}));

// ---- basic data popup (organisation, dates, encounter types, visit ids) ----
const basicData = require("../models/basicdata.model");

exports.basicData = handle((req) => basicData.basic(req.session && req.session.sitecode));
exports.basicVisit = handle((req) => basicData.visit(req.query.visitid));
exports.basicHn = handle((req) => basicData.patientByHn(req.query.hn));

// ---- Query Data Audit page (own menu item / permission; reads SQLite only) ----
exports.auditIndex = async function (req, res) {
  return res.renderPage(view('audit'), {
    title: 'Query Data Audit',
    keepDays: audit.KEEP_DAYS,
    exportMax: audit.EXPORT_MAX,
    canClear: !!req.user && req.user.role === permissions.ADMIN_ROLE,
    canQuery: permissions.canAccessPath(req.user, '/query-studio')
  });
};
exports.auditSearch = handle((req) => audit.search(req.query || {}));
exports.auditOptions = handle(() => audit.options());
// The log as a file (CSV / Excel) with the page's filters; up to audit.EXPORT_MAX entries.
const sheet = require('../../../app/core/spreadsheet');
exports.auditExport = async function (req, res) {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const { columns, rows, truncated } = await audit.exportRows(req.query || {});
    const stamp = sheet.bkkText(new Date()).slice(0, 16).replace(/[-:]/g, '').replace(' ', '-');
    const name = `query-data-audit_${stamp}.${format}`;
    const body = format === 'csv' ? sheet.toCsv(columns, rows) : sheet.toXlsx('Query Data Audit', columns, rows);
    res.set({
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Rows': String(rows.length),
      'X-Truncated': truncated ? '1' : '0',
      'Cache-Control': 'no-store'
    });
    return res.send(body);
  } catch (err) {
    return fail(res, err);
  }
};

// Clearing the log is for administrators only, whoever else can open the page.
const adminOnly = (fn) => async (req, res) => {
  if (!req.user || req.user.role !== permissions.ADMIN_ROLE) return res.status(403).json({ error: 'Only administrators can clear the audit log' });
  return fn(req, res);
};
exports.auditClearPreview = adminOnly(handle((req) => audit.clearPreview(req.body || {})));
exports.auditClear = adminOnly(handle(async (req) => {
  if ((req.body || {}).confirm !== 'CLEAR') throw new QueryError('Type CLEAR to confirm', null);
  return audit.clear(req, req.body || {});
}));
exports.auditDetail = handle(async (req) => {
  const row = await audit.get(parseInt(req.params.id, 10));
  if (!row) throw new QueryError('Audit entry not found', null);
  return row;
});

// Personal-data censoring: on for everyone unless an administrator switches it off.
const censor = require("../../../app/core/helpers/censor.helper");
exports.censorState = handle(async (req) => ({
  on: await censor.isOn(), canChange: !!req.user && req.user.role === permissions.ADMIN_ROLE
}));
// Only administrators switch it; each switch is written to the Query Data audit log.
exports.censorSet = async function (req, res) {
  if (!req.user || req.user.role !== permissions.ADMIN_ROLE) {
    return res.status(403).json({ error: 'Only administrators can switch personal-data censoring' });
  }
  try {
    const want = !!(req.body && req.body.on);
    const startedAt = Date.now();
    const before = await censor.isOn();
    const on = await censor.setOn(want);
    await audit.recordCensor(req, { before, on, startedAt });
    return res.json({ on, canChange: true });
  } catch (err) {
    return fail(res, err);
  }
};

// Database connection: the app has one Mongo connection shared by every session, so switching
// it here changes it for everyone (as DB Connections does). Needs the "DB Info" permission
// (/database/connect); each switch is written to the Query Data audit log.
const dbConnections = require('../../../app/modules/setting/models/dbconnections.model');
const activeConnection = require('../../../app/modules/setting/models/activeconnection.service');
const canSwitchDb = (req) => permissions.canAccessPath(req.user, '/database/connect');
const canManageDb = (req) => permissions.canAccessPath(req.user, '/database/connections');
function currentConnection() {
  const s = global.sessionData || {};
  const connected = mongoose.connection.readyState === 1;
  return {
    siteIndex: connected && s.site_index !== undefined && s.site_index !== '' ? s.site_index : null,
    name: connected ? s.site_name || '' : '',
    color: connected ? s.site_color || '' : '',
    db: connected ? mongoose.connection.name : ''
  };
}
exports.currentConnection = currentConnection;

exports.connections = async function (req, res) {
  try {
    const list = await dbConnections.list();
    return res.json({
      current: currentConnection(),
      canSwitch: canSwitchDb(req),
      canManage: canManageDb(req),
      // Names, database and site code only: no hosts or credentials reach the browser.
      connections: list.map((c) => ({ siteIndex: c.SITE_INDEX, name: c.NAME, color: c.COLOR, db: c.MONGODB_DB, siteCode: c.DEFAULT_SITE_CODE }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.switchConnection = async function (req, res) {
  if (!canSwitchDb(req)) {
    return res.status(403).json({ error: 'Your role doesn\'t include "DB Info", which is needed to change the database connection.' });
  }
  const startedAt = Date.now();
  const before = currentConnection();
  const target = await dbConnections.getByIndex(parseInt((req.body || {}).siteIndex, 10));
  if (!target) return res.status(404).json({ error: 'That connection no longer exists. Reload the list.' });
  const to = { name: target.NAME, db: target.MONGODB_DB };
  if (before.siteIndex !== null && Number(before.siteIndex) === target.SITE_INDEX) {
    activeConnection.joinSession(req);
    return res.json({ ok: true, unchanged: true, current: before });
  }
  try {
    await activeConnection.connect(target.SITE_INDEX);
    activeConnection.joinSession(req);
  } catch (err) {
    // Connecting closes the old connection first: put it back so nobody is left without one.
    let restored = false;
    if (before.siteIndex !== null) {
      try {
        await activeConnection.connect(before.siteIndex);
        activeConnection.joinSession(req);
        restored = true;
      } catch (e) { /* the old one is unreachable too */ }
    }
    if (!restored) activeConnection.clearSession(req);
    await audit.recordConnect(req, { from: before, to, startedAt, error: err });
    return res.status(502).json({
      error: `Could not connect to ${target.NAME}: ${err.message}. ` + (restored ? `Still connected to ${before.name}.` : 'No database is connected now; choose another connection.'),
      restored,
      current: currentConnection()
    });
  }
  await audit.recordConnect(req, { from: before, to, startedAt, error: null });
  return res.json({ ok: true, current: currentConnection() });
};
