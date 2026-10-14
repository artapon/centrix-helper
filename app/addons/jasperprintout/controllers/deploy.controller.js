// Reports > Publish Report, deploy workflow: 1. deploy a saved design to the UAT JasperServers,
// 2. run the report on UAT and approve (or reject) it, 3. deploy the approved JRXML to the
// Production JasperServers, optionally saving it to Centrix HIS. Servers are put in the UAT and
// Production zones in Reports > Settings.
const settingsModel = require('../models/settings.model');
const designs = require('../models/designs.model');
const deploys = require('../models/deploys.model');
const jasper = require('../models/jasper.service');
const datasetQuery = require('../models/datasetQuery');
const JD = require('../public/jrxml-design');
const pub = require('../models/publish.service');
const { usedImages, refuseLoops } = require('./designer.controller');

const reportId = require('../models/reportId');

const { bad } = pub;
const yes = (v) => v === true || v === 'true' || v === '1' || v === 1;
const json = (handler) => pub.json('Report Deploy', handler);
const FORMATS = { pdf: 'application/pdf', html: 'text/html; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function deployOf(req) {
  const d = await deploys.get(parseInt(req.params.id, 10));
  if (!d) throw bad('That deploy no longer exists.', 404);
  return d;
}

// What a saved design publishes now: { row, design, jrxml, images, hash }.
async function current(designId) {
  const row = await designs.get(designId);
  if (!row || !row.design) throw bad('That design no longer exists.', 404);
  const design = JD.sanitize(row.design);
  const { resources, missing } = usedImages(design, row.images);
  const jrxml = JD.toJrxml(design, { server: true });
  // The saved design, not the JRXML: JRXML gets fresh UUIDs where the design has none. A design
  // without a query also counts the one-record query it is published with, so the ones deployed
  // before that query was added show as changed and can go to UAT again.
  const oneRow = JD.hasQuery(design) ? '' : '|one-row-query';
  return { row, design, jrxml, images: resources, missing, hash: deploys.hash(JSON.stringify(row.design) + oneRow, resources) };
}

// The design's latest deploy, and whether the design changed since it went to UAT.
exports.status = json(async (req, res) => {
  const designId = parseInt(req.params.id, 10);
  const [{ hash }, latest] = await Promise.all([current(designId), deploys.latest()]);
  const deploy = latest[designId] || null;
  res.json({ deploy, designHash: hash, changed: !!deploy && deploy.designHash !== hash });
});

// Step 1: { id, folder, dataSource } -> publishes the design to every UAT server.
exports.uat = json(async (req, res) => {
  const b = req.body || {};
  const designId = parseInt(b.id, 10);
  const { row, design, jrxml, images, missing, hash } = await current(designId);
  refuseLoops(design);
  if (missing.length) throw bad(`The design uses image${missing.length > 1 ? 's' : ''} ${missing.join(', ')} that ${missing.length > 1 ? 'are' : 'is'} not uploaded. Open it in the Jasper Designer and add ${missing.length > 1 ? 'them' : 'it'} first.`);
  const settings = await settingsModel.get('designer');
  const servers = settingsModel.zoneServers(settings, 'uat');
  const { folder, dataSource } = pub.target({
    folder: String(b.folder || '').trim() || design.folder,
    dataSource: String(b.dataSource || '').trim() || design.dataSource
  }, settings);

  // "Report ID in the page footer": the deploy time, bottom right of every page (kept on Production).
  const stamped = yes(b.reportId) ? reportId.stamp(jrxml, reportId.make()) : { jrxml, id: '' };

  const r = await pub.publish({ settings, servers, folder, dataSource, reportName: design.name, jrxml: stamped.jrxml, images, designId: row.id, username: req.user.username, label: `UAT deploy of design #${row.id} "${design.name}"${stamped.id ? ` (Report ID ${stamped.id})` : ''}` });
  const deploy = await deploys.createUat({
    designId: row.id, name: design.name, folder, dataSource, routepath: r.routepath, jrxml: stamped.jrxml, images, designHash: hash,
    servers: r.servers, username: req.user.username, reportId: stamped.id
  });
  res.json({ ok: true, deploy, problems: JD.problems(design) });
});

// Step 2: runs the deployed report on a UAT server (or a Production one once it is there).
// Query: server (id, optional), zone ('uat' | 'prod'), format (pdf | html | xlsx), params (JSON { name: value }).
exports.run = async function (req, res) {
  try {
    const deploy = await deployOf(req);
    const zone = req.query.zone === 'prod' ? 'prod' : 'uat';
    if (zone === 'prod' && deploy.status !== 'production') throw bad('This version is not on Production.', 409);
    const format = FORMATS[req.query.format] ? req.query.format : 'pdf';
    const settings = await settingsModel.get('designer');
    const deployedTo = (zone === 'prod' ? deploy.prod.servers : deploy.uat.servers).filter((s) => s.ok).map((s) => s.id);
    const candidates = settingsModel.zoneServers(settings, zone).filter((sv) => deployedTo.includes(sv.id));
    const sv = candidates.find((s) => s.id === req.query.server) || candidates[0];
    if (!sv) throw bad(`None of the ${zone === 'prod' ? 'Production' : 'UAT'} JasperServers this version went to is set up any more. Deploy to UAT again.`, 409);

    let raw = {};
    try { raw = JSON.parse(req.query.params || '{}') || {}; } catch (e) { throw bad('The report parameters could not be read.'); }
    const params = {};
    Object.entries(typeof raw === 'object' ? raw : {}).forEach(([k, v]) => {
      if (JD.NAME_RE.test(k) && v !== '' && v != null) params[k] = String(v).slice(0, 500);
    });

    const file = await jasper.run(pub.on(settings, sv), deploy.routepath, format, params);
    res.set('Content-Type', FORMATS[format]);
    res.set('X-Jasper-Server', encodeURIComponent(sv.name));
    res.set('Content-Disposition', `${format === 'xlsx' ? 'attachment' : 'inline'}; filename="${deploy.name}.${format}"`);
    res.send(file);
  } catch (err) {
    if (!err.expose) console.error('Report Deploy run:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. The details are in the server log.' });
  }
};

// Step 2: { approved: true | false, note } on a deploy that waits for review.
exports.review = json(async (req, res) => {
  const deploy = await deployOf(req);
  const b = req.body || {};
  const approved = b.approved === true || b.approved === 'true';
  const note = String(b.note || '').trim().slice(0, 500);
  if (!approved && !note) throw bad('Say what is wrong with the report on UAT.');
  if (!(await deploys.review(deploy.id, { approved, note, username: req.user.username }))) {
    throw bad(deploy.status === 'superseded' ? 'A newer version was deployed to UAT. Review that one.' : 'This version was already reviewed.', 409);
  }
  console.log(`UAT deploy #${deploy.id} (${deploy.routepath}) ${approved ? 'approved' : 'rejected'} by ${req.user.username}`);
  res.json({ ok: true, deploy: await deploys.get(deploy.id) });
});

// Step 3: { toHis, hisCode, hisName, locale } -> publishes the approved version to every Production server.
exports.production = json(async (req, res) => {
  const deploy = await deployOf(req);
  if (deploy.status !== 'approved') {
    throw bad({
      uat: 'Check the report on UAT and approve it first.',
      rejected: 'This version was rejected on UAT. Fix the design and deploy it to UAT again.',
      superseded: 'A newer version was deployed to UAT. Use that one.',
      production: 'This version is already on Production.'
    }[deploy.status] || 'This version cannot go to Production.', 409);
  }
  const settings = await settingsModel.get('designer');
  const servers = settingsModel.zoneServers(settings, 'prod');
  const reg = await pub.hisRequest(req.body || {}, settings, req.session);
  const { jrxml, images } = await deploys.artifact(deploy.id);
  // Report ID: asked for, the Production deploy time (replacing the UAT one); otherwise the approved
  // JRXML goes as it is, with its UAT ID if it has one.
  const stamped = yes((req.body || {}).reportId) ? reportId.stamp(jrxml, reportId.make()) : { jrxml, id: reportId.of(jrxml) };

  const r = await pub.publish({
    settings, servers, folder: deploy.folder, dataSource: deploy.dataSource, reportName: deploy.name, jrxml: stamped.jrxml, images, reg,
    designId: deploy.designId, username: req.user.username, label: `Production deploy #${deploy.id} "${deploy.name}"${stamped.id ? ` (Report ID ${stamped.id})` : ''}`
  });
  await deploys.markProduction(deploy.id, { servers: r.servers, hisCode: r.registered ? r.registered.code : '', username: req.user.username, reportId: stamped.id });
  res.json(Object.assign({ ok: true, deploy: await deploys.get(deploy.id) }, r));
});

// Values for patientvisituid / loginuid … from the connected site, to run the report on UAT with.
exports.sampleParams = json(async (req, res) => res.json({ values: await datasetQuery.sampleParams() }));
