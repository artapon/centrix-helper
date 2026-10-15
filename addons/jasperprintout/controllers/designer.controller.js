// Jasper Designer: a drag-and-drop report designer that writes JRXML, keeps designs, publishes
// them to JasperServer (optionally saving them to Centrix HIS) and runs them as PDF for preview.
// Defaults and the JasperServer connection come from Reports > Settings (publish.service).
const view = require('../../../app/core/view').addon('jasperprintout');
const settingsModel = require('../models/settings.model');
const designs = require('../models/designs.model');
const jasper = require('../models/jasper.service');
const JD = require('../public/jrxml-design');
const datasetQuery = require('../models/datasetquery.service');
const pub = require('../models/publish.service');
const queryAudit = require('../../../app/core/models/queryaudit.model');

const IMAGE_RE = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/;
const IMAGE_NAME_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 20 * 1024 * 1024;

const { bad } = pub;
const json = (handler) => pub.json('Jasper Designer', handler);

// The design and its images arrive as one JSON form field ("payload"), so large images don't
// meet the app-wide JSON body limit.
function payload(req) {
  let p;
  try { p = JSON.parse((req.body && req.body.payload) || '{}'); } catch (e) { throw bad('The design could not be read.'); }
  const design = JD.sanitize(p.design);
  const images = {};
  let total = 0;
  Object.entries(p.images && typeof p.images === 'object' ? p.images : {}).forEach(([name, url]) => {
    if (!IMAGE_NAME_RE.test(name)) throw bad(`Image name "${name}" may only contain letters, numbers, _ . and -.`);
    const m = IMAGE_RE.exec(String(url || ''));
    if (!m) throw bad(`Image "${name}" must be a PNG, JPEG or GIF.`);
    const size = Math.floor(m[2].length * 3 / 4);
    if (size > MAX_IMAGE) throw bad(`Image "${name}" is larger than 5 MB.`);
    total += size;
    images[name] = String(url);
  });
  if (total > MAX_IMAGES) throw bad('The images together are larger than 20 MB.');
  return { design, images, raw: p };
}

// Images the design uses, as report-unit resources.
function usedImages(design, images) {
  const names = new Set();
  JD.bandList(design).forEach(([key]) => design.bands[key].elements.forEach((el) => {
    if (el.type === 'image' && el.source === 'resource' && el.resource) names.add(el.resource);
  }));
  if (JD.hasWatermark(design)) names.add(JD.WATERMARK_IMAGE);      // drawn by the designer, printed on every page
  const missing = [...names].filter((n) => !images[n])
    .map((n) => (n === JD.WATERMARK_IMAGE ? `${n} (the watermark: open the design in the Jasper Designer and save it again)` : n));
  return {
    resources: [...names].filter((n) => images[n]).map((n) => ({ name: n, buffer: Buffer.from(IMAGE_RE.exec(images[n])[2], 'base64') })),
    missing
  };
}

// Shared with Reports > Publish.
exports.usedImages = usedImages;

// A design JasperServer would loop on (new pages forever, or a subreport running the report itself) is
// never sent there: it can tie the server up until it runs out of memory. Other problems only warn.
function refuseLoops(design) {
  const loops = JD.loops(design);
  if (!loops.length) return;
  const e = bad(`"${design.name}" would make JasperServer loop, so it was not sent. Fix ${loops.length > 1 ? 'these' : 'this'} in the Jasper Designer first:\n• ${loops.join('\n• ')}`, 422);
  e.loops = loops;
  throw e;
}
exports.refuseLoops = refuseLoops;

exports.index = async function (req, res) {
  // Widgets of other add-ons this page can show (core/addons.js); each appears only when its add-on is active
  // and the role has it.
  return res.renderPage(view('designer'), Object.assign({ title: 'Jasper Designer', widgets: ['querystudio.basic-data', 'querystudio.jasper-queries'] },
    await pub.pageContext(req, 'designer')));
};

exports.checkCode = pub.checkCode;

// Publish history of a saved design (the publish dialog fills its HIS fields from the last one).
exports.publishes = json(async (req, res) => {
  res.json({ history: await designs.publishHistory(parseInt(req.params.id, 10), 20) });
});

// Folder path of the design library: names joined by "/", '' is the top level.
const FOLDER_PART_RE = /^[^/\\<>:"|?*\u0000-\u001f]{1,60}$/;
function folderPath(value) {
  const parts = String(value || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 8) throw bad('Folders can be at most 8 levels deep.');
  parts.forEach((p) => {
    if (!FOLDER_PART_RE.test(p) || p === '.' || p === '..') throw bad(`"${p}" is not a valid folder name (up to 60 characters, without / \\ < > : " | ? *).`);
  });
  return parts.join('/');
}
exports.folderPath = folderPath;     // the Print-Out Builder saves into the same library

function folderBody(req) {
  try { return JSON.parse((req.body && req.body.payload) || '{}'); } catch (e) { throw bad('The request could not be read.'); }
}

exports.list = json(async (req, res) => res.json(await designs.list()));

exports.createFolder = json(async (req, res) => {
  const path = folderPath(folderBody(req).path);
  if (!path) throw bad('Type a folder name.');
  if (!(await designs.createFolder(path, req.user.username))) throw bad('A folder with that name already exists.', 409);
  console.log(`Jasper design folder "${path}" created by ${req.user.username}`);
  res.json({ ok: true, path });
});

exports.removeFolder = json(async (req, res) => {
  const path = folderPath(folderBody(req).path);
  if (!path) throw bad('The top level cannot be deleted.');
  const r = await designs.removeFolder(path);
  if (r === 'not-empty') throw bad('Only an empty folder can be deleted. Move or delete what is inside first.', 409);
  if (r === 'missing') throw bad('That folder no longer exists.', 404);
  console.log(`Jasper design folder "${path}" deleted by ${req.user.username}`);
  res.json({ ok: true });
});

exports.get = json(async (req, res) => {
  const row = await designs.get(parseInt(req.params.id, 10));
  if (!row) throw bad('That design no longer exists.', 404);
  res.json(row);
});

exports.save = json(async (req, res) => {
  const { design, images, raw } = payload(req);
  const id = raw.id ? parseInt(raw.id, 10) : null;
  const path = folderPath(raw.path);
  if (!(await designs.folderExists(path))) throw bad(`The folder "${path}" no longer exists.`, 404);
  const auto = raw.auto === true;
  const saved = await designs.save({ id, name: design.name, path, design, images, username: req.user.username, auto });
  if (!saved) throw bad('That design no longer exists. Use "Save as" to keep a copy.', 404);
  console.log(`Jasper design "${path ? path + '/' : ''}${design.name}" (#${saved}) ${auto ? 'auto-saved' : 'saved'} by ${req.user.username}`);
  res.json({ ok: true, id: saved, name: design.name, path });
});

// Earlier saves of a design (newest first), and one of them to load into the editor.
exports.versions = json(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await designs.get(id))) throw bad('That design no longer exists.', 404);
  res.json({ versions: await designs.versions(id), keep: designs.KEEP_VERSIONS });
});

exports.version = json(async (req, res) => {
  const row = await designs.version(parseInt(req.params.id, 10), parseInt(req.params.vid, 10));
  if (!row) throw bad('That version no longer exists.', 404);
  res.json(row);
});

exports.remove = json(async (req, res) => {
  const ok = await designs.remove(parseInt(req.params.id, 10));
  if (!ok) throw bad('That design no longer exists.', 404);
  console.log(`Jasper design #${req.params.id} deleted by ${req.user.username}`);
  res.json({ ok: true });
});

// The JRXML the server would publish (download, and a check that the design is valid).
exports.jrxml = json(async (req, res) => {
  const { design } = payload(req);
  res.json({ name: design.name, jrxml: JD.toJrxml(design), problems: JD.problems(design) });
});

// Publishes the design as it is in the editor. raw.publish holds the shared publish fields
// (servers, toHis, hisCode, hisName, locale); raw.id, when the design is saved, adds it to the publish history.
exports.publish = json(async (req, res) => {
  const { design, images, raw } = payload(req);
  const settings = await settingsModel.get('designer');
  settingsModel.requireDirectPublish(settings);
  const { folder, dataSource } = pub.target(design, settings);
  const servers = pub.servers(raw.publish || {}, settings);
  const reg = await pub.hisRequest(raw.publish || {}, settings, req.session);
  refuseLoops(design);
  const { resources, missing } = usedImages(design, images);
  if (missing.length) throw bad(`Upload the image${missing.length > 1 ? 's' : ''} ${missing.join(', ')} first.`);
  const id = parseInt(raw.id, 10);
  const designId = id && (await designs.get(id)) ? id : null;
  const r = await pub.publish({ settings, servers, folder, dataSource, reportName: design.name, jrxml: JD.toJrxml(design, { server: true }), images: resources, reg, designId, username: req.user.username, label: `Jasper design "${design.name}"` });
  res.json(Object.assign({ ok: true, problems: JD.problems(design) }, r));
});

// ─── Open a design > a JasperServer tab: browse its repository and open a report unit ──────────
// Uses the connection in Reports > Settings, so the browser never sees the JasperServer login.

// The JasperServer with this id, as jasper.service expects it. browse: refused when Reports > Settings
// does not show its folders in Open a design ("Show its folders in Jasper Designer").
async function remoteServer(id, browse) {
  const settings = await settingsModel.get('designer');
  const sv = pub.servers({ servers: [String(id || '')] }, settings)[0];
  if (browse && !settingsModel.canBrowse(sv, 'designer')) throw bad(`${sv.name}: showing its folders in Open a design is turned off in Reports > Settings.`, 403);
  return Object.assign(pub.on(settings, sv), { browseFolders: sv.browseFolders || [] });
}
const outsideFolders = (settings) => bad(`${settings.name}: that folder is not one Reports > Settings lets Open a design show.`, 403);
// A repository path from the request: "/" or "/A/B c", without "..".
function repoUri(value, what) {
  const uri = '/' + String(value || '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
  if (uri.length > 500 || /(^|\/)\.\.(\/|$)|[\u0000-\u001f]/.test(uri)) throw bad(`That ${what} path is not valid.`);
  return uri;
}

// folders=1: folders only, for picking where to publish (the Publish dialog / JasperServer popup); allowed
// whatever Open a design may show. Otherwise folders and report units, for Open a design.
exports.remoteBrowse = json(async (req, res) => {
  const folder = repoUri(req.query.folder, 'folder');
  const foldersOnly = req.query.folders === '1';
  const settings = await remoteServer(req.params.sid, !foldersOnly);
  const items = await jasper.browse(settings, folder);
  if (foldersOnly) return res.json({ folder, items: items.filter((x) => x.type === 'folder') });
  const shown = settingsModel.listFolder(settings, folder, items);
  if (!shown) throw outsideFolders(settings);
  res.json({ folder, items: shown });
});

exports.remoteSearch = json(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) throw bad('Type at least 2 letters to search.');
  const settings = await remoteServer(req.params.sid, true);
  res.json({ q, items: (await jasper.search(settings, q)).filter((x) => settingsModel.inFolders(settings, x.uri)) });
});

// Image kind from the first bytes (resources often have no file extension).
const imageType = (buf) => (buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpeg' : buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 ? 'gif' : '');

// One report unit: its JRXML (text) and its images as data URLs, so the designer imports it as a new,
// unsaved design. Files the designer can't keep (subreports, bundles, big images) are listed in `skipped`.
exports.remoteUnit = json(async (req, res) => {
  const uri = repoUri(req.query.uri, 'report');
  const settings = await remoteServer(req.params.sid, true);
  if (!settingsModel.inFolders(settings, uri)) throw outsideFolders(settings);
  const unit = await jasper.reportUnit(settings, uri);
  if (!unit.jrxmlUri) throw bad('That report unit has no JRXML.', 422);
  const jrxml = (await jasper.file(settings, unit.jrxmlUri)).toString('utf8');
  const images = {}, skipped = [];
  let total = 0;
  for (const r of unit.resources.slice(0, 50)) {
    if (!IMAGE_NAME_RE.test(r.name)) { skipped.push(`${r.name} (name not supported)`); continue; }
    let buf;
    try { buf = await jasper.file(settings, r.uri); } catch (e) { skipped.push(`${r.name} (${e.message})`); continue; }
    const kind = imageType(buf);
    if (!kind) { skipped.push(`${r.name} (not an image: kept on JasperServer only)`); continue; }
    if (buf.length > MAX_IMAGE || total + buf.length > MAX_IMAGES) { skipped.push(`${r.name} (image too large)`); continue; }
    total += buf.length;
    images[r.name] = `data:image/${kind};base64,${buf.toString('base64')}`;
  }
  if (unit.resources.length > 50) skipped.push(`${unit.resources.length - 50} more files`);
  const parts = unit.uri.split('/').filter(Boolean);
  console.log(`Jasper Designer: ${req.user.username} opened ${unit.uri} from ${settings.name}`);
  res.json({ uri: unit.uri, label: unit.label, name: parts[parts.length - 1], folder: parts.slice(0, -1).join('/'), dataSource: unit.dataSource, server: settings.name, jrxml, images, skipped });
});

// Preview: publish to a temporary report unit next to the real one, run it as PDF, delete it.
// It runs on raw.server, or the first JasperServer published to by default.
exports.preview = async function (req, res) {
  let settings, unit;
  const cleanUp = async () => {
    if (!unit || !settings) return;
    const u = unit;
    unit = null;
    await jasper.remove(settings, u).catch((e) => console.warn('Jasper Designer: could not delete preview unit', u, e.message));
  };
  try {
    const { design, images, raw } = payload(req);
    settings = await settingsModel.get('designer');
    const { folder, dataSource } = pub.target(design, settings);
    refuseLoops(design);
    const { resources, missing } = usedImages(design, images);
    if (missing.length) throw bad(`Upload the image${missing.length > 1 ? 's' : ''} ${missing.join(', ')} first.`);
    const tempName = `${design.name}_preview_${Date.now().toString(36)}`.slice(0, 100);
    settings = pub.on(settings, pub.servers({ servers: raw.server ? [raw.server] : [] }, settings)[0]);
    const published = await jasper.publish(settings, { folder, reportName: tempName, dataSource, jrxml: JD.toJrxml(design, { server: true }), images: resources });
    unit = published.uri || `/${folder}/${tempName}`;
    const params = {};
    Object.entries(raw.params && typeof raw.params === 'object' ? raw.params : {}).forEach(([k, v]) => {
      if (JD.NAME_RE.test(k) && v !== '' && v != null) params[k] = String(v).slice(0, 500);
    });
    const pdf = await jasper.run(settings, unit, 'pdf', params);
    await cleanUp();
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${design.name}.pdf"`);
    res.send(pdf);
  } catch (err) {
    await cleanUp();
    if (!err.expose) console.error('Jasper Designer preview:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. The details are in the server log.' });
  }
};

// Dataset and Query dialog: Read Fields / Data preview run the report query on the connected
// site (read-only, limited). Each run is written to the query audit log (core/models/queryaudit.model).
exports.query = json(async (req, res) => {
  let p;
  try { p = JSON.parse((req.body && req.body.payload) || '{}'); } catch (e) { throw bad('The query could not be read.'); }
  const startedAt = Date.now();
  let result = null, error = null;
  try {
    result = await datasetQuery.run({
      query: p.query, language: p.language, mode: ['preview', 'fill'].includes(p.mode) ? p.mode : 'fields',
      params: Array.isArray(p.params) ? p.params : [], values: p.values && typeof p.values === 'object' ? p.values : {},
      fields: p.fields, limit: p.limit, ws: p.ws && typeof p.ws === 'object' ? p.ws : null
    });
    return res.json(result);
  } catch (err) {
    error = err;
    throw err;
  } finally {
    try {
      await queryAudit.record({
        req: { user: req.user, ip: req.ip, socket: req.socket, get: req.get && req.get.bind(req), body: { query: '// Jasper Designer: ' + ({ preview: 'Data preview', fill: 'Report preview' }[p.mode] || 'Read Fields') + '\n' +
          (p.language === 'json' && p.ws ? '// Web service: ' + String(p.ws.method || 'GET') + ' ' + String(p.ws.url || '') + '\n// Records: ' : '') + String(p.query || '') } },
        action: 'run', startedAt, ms: Date.now() - startedAt,
        result: result ? { method: p.language === 'json' ? 'webservice' : 'aggregate', collection: result.collection, docs: new Array(result.docs || 0) } : null,
        error: error && !error.expose ? error : (error ? { message: error.message } : null)
      });
    } catch (e) { console.error('Jasper Designer: the query audit entry was not written:', e.message); }
  }
});

// Preview: values for patientvisitsuid / loginuid from the first record of the connected site.
exports.sampleParams = json(async (req, res) => res.json({ values: await datasetQuery.sampleParams() }));
