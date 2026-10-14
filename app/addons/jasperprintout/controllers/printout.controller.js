// Jasper Print-Out Builder: the builder page and publishing its pages as a report unit (optionally
// saved to Centrix HIS) through the shared publish service. Its settings are on Reports > Settings.
// The pages can also be saved as a design in the Jasper Designer library (the same folders and files).
const view = require('../../../core/view').addon('jasperprintout');
const settingsModel = require('../models/settings.model');
const designs = require('../models/designs.model');
const jrxml = require('../models/jrxml');
const images = require('../models/image.service');
const pub = require('../models/publish.service');
const { folderPath } = require('./designer.controller');
const JD = require('../public/jrxml-design');

const { bad } = pub;

// "FM DEN 001!" -> "FM_DEN_001" (English letters, numbers and _ only, as in the original)
const reportNameOf = (raw) => String(raw || '').replace(/[^a-zA-Z0-9_\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 100);

exports.index = async function (req, res) {
  return res.renderPage(view('builder'), Object.assign({ title: 'Jasper Print-Out Builder' }, await pub.pageContext(req, 'builder')));
};

exports.checkCode = pub.checkCode;

// Multipart: the page images plus reportName, version and the shared publish fields
// (servers: comma-separated ids, folder, dataSource, toHis, hisCode, hisName, locale).
exports.publish = pub.json('Print-Out Builder', async (req, res) => {
  const files = req.files || [];
  const b = req.body || {};
  if (!files.length) throw bad('Add at least one page image.');

  const settings = await settingsModel.get('builder');
  settingsModel.requireDirectPublish(settings);
  const reportName = reportNameOf(b.reportName);
  if (!reportName) throw bad('Report name must contain English letters or numbers.');
  const { folder, dataSource } = pub.target(b, settings);
  const servers = pub.servers(b, settings);
  const reg = await pub.hisRequest(b, settings, req.session);
  const version = String(b.version || '').trim().slice(0, 100);

  const pages = await images.toA4Pages(files);
  // Jaspersoft Studio properties in the JRXML name the first server it is published to.
  const xml = jrxml.generate(pages.map((p) => p.name), { reportName, version, settings: pub.on(settings, servers[0]) });
  const r = await pub.publish({ settings, servers, folder, dataSource, reportName, jrxml: xml, images: pages, reg, username: req.user.username, label: `Print-out (${pages.length} page${pages.length > 1 ? 's' : ''})` });
  res.json(Object.assign({ ok: true, pages: pages.length }, r));
});

// The print-out as a Jasper Designer design: the report jrxml.generate writes (Centrix header
// subreport, one A4 page per image, page footer), with each page in its own Detail band.
function printoutDesign(pageNames, { reportName, version, folder, dataSource, settings }) {
  const s = settings || {};
  const d = JD.newDesign(reportName);
  d.page.margins = { top: 20, right: 20, bottom: 12, left: 20 };
  d.folder = folder;
  d.dataSource = dataSource;
  d.query = `{
    runCommand: {
        aggregate : 'patientvisits',
        pipeline : [
            { $match: { statusflag: 'A', _id : {"$oid":  $P{patientvisituid} } } },
            { $project: { "_id":"$_id" } }
        ]
    }
}`;
  d.params = [
    { name: 'patientvisituid', cls: 'java.lang.String', def: JSON.stringify(s.defaultVisitUid || ''), prompt: true },
    { name: 'organisationuid', cls: 'java.lang.String', def: JSON.stringify(s.defaultOrgUid || ''), prompt: true }
  ];
  d.fields = [{ name: '_id', cls: 'org.bson.types.ObjectId' }];
  ['title', 'columnHeader', 'columnFooter', 'lastPageFooter', 'summary'].forEach((k) => { d.bands[k] = { height: 0, elements: [], hidden: true }; });

  // The Centrix layout header (settings checks it is a repository path).
  d.bands.pageHeader = s.headerSubreport ? {
    height: 105,
    elements: [JD.newElement('subreport', {
      x: 0, y: 0, width: 575, height: 105, expression: JSON.stringify(s.headerSubreport),
      params: ['organisationuid', 'patientvisituid'].map((n) => ({ name: n, expression: `$P{${n}}` }))
    })]
  } : { height: 0, elements: [], hidden: true };

  pageNames.forEach((name, i) => {
    d.bands[i ? `detail${i + 1}` : 'detail'] = {
      height: 680,
      elements: [JD.newElement('image', { x: 0, y: 0, width: 560, height: 679, positionType: 'FixRelativeToBottom', source: 'resource', resource: name, scale: 'FillFrame' })]
    };
  });

  const font = () => ({ fontName: 'TH SarabunPSK', fontSize: 12, box: JD.emptyBox() });
  const footer = [
    JD.newElement('textField', Object.assign(font(), { x: 271, y: 2, width: 100, height: 20, expression: '" of " + $V{PAGE_NUMBER}', evaluationTime: 'Report', hAlign: 'Left', vAlign: 'Middle' })),
    JD.newElement('textField', Object.assign(font(), { x: 219, y: 2, width: 50, height: 20, expression: '"Page " + $V{PAGE_NUMBER}', hAlign: 'Right', vAlign: 'Middle' }))
  ];
  if (version) footer.push(JD.newElement('staticText', Object.assign(font(), { x: 0, y: 0, width: 220, height: 25, text: version, hAlign: 'Left', vAlign: 'Middle' })));
  d.bands.pageFooter = { height: 25, elements: footer };
  return JD.sanitize(d);
}

// The limits of a design saved in Jasper Designer, so it can be opened and saved there again.
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 20 * 1024 * 1024;

// Multipart: the page images plus reportName, version, folder and dataSource (where it publishes to),
// and its place in the design library: path (folder, '' is the top level) and id (the design it
// replaces; empty for a new one).
exports.save = pub.json('Print-Out Builder', async (req, res) => {
  const files = req.files || [];
  const b = req.body || {};
  if (!files.length) throw bad('Add at least one page image.');
  const reportName = reportNameOf(b.reportName);
  if (!reportName) throw bad('Report name must contain English letters or numbers.');
  const path = folderPath(b.path);
  if (!(await designs.folderExists(path))) throw bad(`The folder "${path}" no longer exists.`, 404);
  const settings = await settingsModel.get('builder');
  const { folder, dataSource } = pub.target(b, settings);
  const version = String(b.version || '').trim().slice(0, 100);

  const pages = await images.toA4Pages(files, { jpeg: true });
  const imgs = {};
  let total = 0;
  pages.forEach((p, i) => {
    if (p.buffer.length > MAX_IMAGE) throw bad(`Page ${i + 1} is larger than 5 MB.`);
    total += p.buffer.length;
    imgs[p.name] = `data:image/jpeg;base64,${p.buffer.toString('base64')}`;
  });
  if (total > MAX_IMAGES) throw bad('The pages together are larger than 20 MB. Save fewer pages in one design.');

  const design = printoutDesign(pages.map((p) => p.name), { reportName, version, folder, dataSource, settings });
  const id = b.id ? parseInt(b.id, 10) : null;
  const saved = await designs.save({ id, name: design.name, path, design, images: imgs, username: req.user.username });
  if (!saved) throw bad('That design no longer exists. Save it again as a new one.', 404);
  console.log(`Print-out "${path ? path + '/' : ''}${design.name}" (#${saved}, ${pages.length} page${pages.length > 1 ? 's' : ''}) saved as a Jasper design by ${req.user.username}`);
  res.json({ ok: true, id: saved, name: design.name, path, pages: pages.length });
});
