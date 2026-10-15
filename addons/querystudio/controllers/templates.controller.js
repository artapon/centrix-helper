const mongoose = require("mongoose");
const templates = require("../models/querytemplates.model");
const helper = require("../models/template.helper");
const { QueryError } = require("../../../app/core/helpers/shellquery.helper");
const organisationsModel = require("../../../app/core/models/organisations.model");
const validateModel = require("../../../app/modules/validate/models/validate.model");
const permissions = require('../../../app/core/permissions');
const view = require('../../../app/core/view').addon('querystudio');

const owner = (req) => (req.user && req.user.username) || (req.auth && req.auth.user) || '';

const handle = (fn) => async (req, res) => {
  try {
    return res.json(await fn(req));
  } catch (err) {
    if (err instanceof QueryError) {
      return res.status(400).json({ error: err.message, query: err.query, line: err.qline || err.line, col: err.qcol || err.col });
    }
    if (!err.status) console.error('Query Template:', err);
    return res.status(err.status || 400).json({ error: err.message || 'Request failed' });
  }
};

// ---- Query Template page (own menu item / permission; SQLite only) ----
exports.index = async function (req, res) {
  return res.renderPage(view('templates'), {
    title: 'Query Template',
    types: helper.PARAM_TYPES,
    mods: helper.MODS,
    builtins: helper.BUILTINS,
    canQuery: permissions.canAccessPath(req.user, '/query-studio')
  });
};
exports.list = handle(async () => ({ templates: await templates.list() }));
exports.save = handle(async (req) => ({ template: await templates.save(req.body || {}, owner(req)) }));
exports.remove = handle(async (req) => {
  await templates.remove(parseInt(req.params.id, 10));
  return { ok: true };
});
exports.restore = handle((req) => templates.restoreBuiltIns(owner(req)));
// A Jaspersoft MongoDB query as a template query, its $P{…} as parameters; nothing is saved or run.
const jasperQuery = require("../models/jasperquery.helper");
exports.fromJasper = handle(async (req) => jasperQuery.toTemplate(String((req.body || {}).text || '')));

// ---- Using a template in Query Data (access follows "Query Data") ----
// The list for the picker: what is needed to fill a template, not who edited it.
exports.pickList = handle(async () => ({
  templates: (await templates.list()).map((t) => ({
    id: t.id, name: t.name, category: t.category, description: t.description, params: t.params,
    queries: t.queries.map((q) => ({ title: q.title, collection: q.collection }))
  }))
}));

// Choices for a "reference" parameter: the reference values of a domain (e.g. ENTYPE).
exports.options = handle(async (req) => {
  const domain = String(req.query.domain || '').toUpperCase();
  if (!/^[A-Z0-9_]{1,60}$/.test(domain)) throw new QueryError('Give a reference domain code', null);
  const org = await organisationsModel.getOrgData(req.session && req.session.sitecode);
  const list = (await validateModel.getReferenceValues(domain, org[0]._id)) || [];
  return {
    options: list
      .map((r) => ({ value: String(r.uid), code: r.code || '', text: r.valuedescription || r.locallanguagedesc || r.code || String(r.uid) }))
      .sort((a, b) => a.text.localeCompare(b.text))
  };
});

const db = () => mongoose.connection.db;
const lookup = {
  patient: (hn) => db().collection('patients').findOne({ mrn: { $eq: hn } }, { projection: { _id: 1 }, maxTimeMS: 10000 }),
  visit: (vn) => db().collection('patientvisits').findOne({ visitid: { $eq: vn } }, { projection: { _id: 1, patientuid: 1 }, maxTimeMS: 10000 }),
  // As the inventory pages find an item (getItemMasterUID): an active item master with that code.
  item: (code) => db().collection('itemmasters').findOne({ statusflag: 'A', code: { $eq: code } }, { projection: { _id: 1 }, maxTimeMS: 10000 })
};

// One query of a template, filled with the values from Query Data: { query, title, template }.
// Nothing runs here; the page puts the query in the editor and runs it as usual (audited).
exports.resolve = handle(async (req) => {
  const tpl = await templates.get(parseInt(req.params.id, 10));
  if (!tpl) throw new QueryError('That template no longer exists. Reload the templates.', null);
  const body = req.body || {};
  const index = parseInt(body.index, 10) || 0;
  let orguid = '';
  try {
    const org = await organisationsModel.getOrgData(req.session && req.session.sitecode);
    orguid = org && org[0] ? String(org[0]._id) : '';
  } catch (err) {
    orguid = '';   // only a template that uses {{orguid}} needs it; resolve() says so
  }
  const query = await helper.resolve(tpl, index, body.values || {}, { orguid, lookup });
  return { query, title: tpl.queries[index].title, template: tpl.name, id: tpl.id, index };
});
