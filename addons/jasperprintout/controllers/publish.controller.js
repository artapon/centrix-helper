// Reports > Publish Report: pick designs saved in the Jasper Designer and publish them to
// JasperServer, optionally saving each to the connected Centrix site as a report template (Visit
// Slip), through the shared publish service.
const view = require('../../../app/core/view').addon('jasperprintout');
const settingsModel = require('../models/settings.model');
const designs = require('../models/designs.model');
const deploys = require('../models/deploys.model');
const JD = require('../public/jrxml-design');
const pub = require('../models/publish.service');
const { usedImages, refuseLoops } = require('./designer.controller');

const { bad } = pub;
const json = (handler) => pub.json('Report Publish', handler);

exports.index = async function (req, res) {
  // Basic Data (Query Studio's widget, core/addons.js): shown when its add-on is active and the role has it.
  return res.renderPage(view('publish'), Object.assign({ title: 'Publish Report', widgets: ['querystudio.basic-data'] }, await pub.pageContext(req, 'designer')));
};

// Saved designs with their folder, size, last publish and latest UAT/Production deploy.
exports.list = json(async (req, res) => {
  const [{ designs: rows, folders }, published, deployed] = await Promise.all([designs.list(), designs.lastPublishes(), deploys.latest()]);
  res.json({
    designs: rows.map((d) => Object.assign({}, d, { published: published[d.id] || null, deploy: deployed[d.id] || null })),
    folders: folders.map((f) => f.path)
  });
});

// The design's report settings for the form: where it publishes and whether the JRXML has problems.
exports.get = json(async (req, res) => {
  const row = await designs.get(parseInt(req.params.id, 10));
  if (!row || !row.design) throw bad('That design no longer exists.', 404);
  const design = JD.sanitize(row.design);
  const { missing } = usedImages(design, row.images);
  res.json({
    id: row.id, name: design.name, path: row.path, updatedBy: row.updatedBy, updatedAt: row.updatedAt,
    folder: design.folder, dataSource: design.dataSource,
    page: design.page, params: design.params.map((p) => p.name),
    // The JRXML's default values, to run the report on UAT with ({ name: value }; computed defaults are left out).
    paramDefaults: design.params.reduce((o, p) => { const v = JD.defaultValue(p.def); if (v != null && v !== '') o[p.name] = v; return o; }, {}),
    // Prompted parameters without a usable default (none, null or ""): left empty, the report fails or comes out empty.
    paramRequired: design.params.filter((p) => p.prompt && ['', 'null', '""'].includes(String(p.def || '').trim())).map((p) => p.name),
    fields: design.fields.length,
    query: JD.hasQuery(design), problems: JD.problems(design), loops: JD.loops(design), missingImages: missing
  });
});

exports.history = json(async (req, res) => {
  res.json({ history: await designs.publishHistory(parseInt(req.params.id, 10)) });
});

exports.checkCode = pub.checkCode;

// Before publishing or deploying: which reports are already on the JasperServers they go to.
// { checks: [{ key, kind: 'publish' | 'uat' | 'prod', id, folder, servers }] } (id: a design, or a
// deploy for 'prod'), resolved the way the publish or deploy itself does.
// -> { results: [{ key, uri, servers: [{ id, name, updated }] }] }, servers empty when nothing is there.
exports.existing = json(async (req, res) => {
  const checks = (Array.isArray((req.body || {}).checks) ? req.body.checks : []).slice(0, 50);
  const settings = await settingsModel.get('designer');
  const results = await Promise.all(checks.map(async (c) => {
    const out = { key: String(c.key || ''), uri: '', servers: [] };
    try {
      let folder, reportName, servers;
      if (c.kind === 'prod') {
        const d = await deploys.get(parseInt(c.id, 10));
        if (!d) return out;
        folder = d.folder; reportName = d.name; servers = settingsModel.zoneServers(settings, 'prod');
      } else {
        const row = await designs.get(parseInt(c.id, 10));
        if (!row || !row.design) return out;
        const design = JD.sanitize(row.design);
        ({ folder } = pub.target({ folder: String(c.folder || '').trim() || design.folder, dataSource: design.dataSource }, settings));
        reportName = design.name;
        servers = c.kind === 'uat' ? settingsModel.zoneServers(settings, 'uat') : pub.servers(c, settings);
      }
      out.uri = `/${folder}/${reportName}`;
      out.servers = await pub.existing({ settings, servers, folder, reportName });
    } catch (err) { /* a bad folder or server list: the publish itself says what is wrong */ }
    return out;
  }));
  res.json({ results });
});

// Publishes one saved design: { id, servers, folder, dataSource, toHis, hisCode, hisName, locale }.
// The form may publish somewhere else than the design says, without changing the saved design.
exports.publish = json(async (req, res) => {
  const b = req.body || {};
  const row = await designs.get(parseInt(b.id, 10));
  if (!row || !row.design) throw bad('That design no longer exists.', 404);
  const design = JD.sanitize(row.design);
  const settings = await settingsModel.get('designer');
  settingsModel.requireDirectPublish(settings);
  const { folder, dataSource } = pub.target({
    folder: String(b.folder || '').trim() || design.folder,
    dataSource: String(b.dataSource || '').trim() || design.dataSource
  }, settings);
  const servers = pub.servers(b, settings);
  const reg = await pub.hisRequest(b, settings, req.session);

  refuseLoops(design);
  const { resources, missing } = usedImages(design, row.images);
  if (missing.length) throw bad(`The design uses image${missing.length > 1 ? 's' : ''} ${missing.join(', ')} that ${missing.length > 1 ? 'are' : 'is'} not uploaded. Open it in the Jasper Designer and add ${missing.length > 1 ? 'them' : 'it'} first.`);

  const r = await pub.publish({ settings, servers, folder, dataSource, reportName: design.name, jrxml: JD.toJrxml(design, { server: true }), images: resources, reg, designId: row.id, username: req.user.username, label: `Jasper design #${row.id} "${design.name}"` });
  res.json(Object.assign({ ok: true, problems: JD.problems(design) }, r));
});
