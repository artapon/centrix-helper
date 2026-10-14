// Reports > Jasper Viewer: open a report from a JasperServer in Reports > Settings (browse, search, an HIS
// report template) or from a JasperServer URL, fill in its parameters and view it. Everything runs on the
// server with the JasperServer login saved in Settings, so the browser never sees a password, and only
// JasperServers listed there can be reached (a pasted URL of another server is refused).
const organisationsModel = require('../../../core/models/organisations.model');
const reportTemplateModel = require('../models/reporttemplate.model');
const view = require('../../../core/view')('reports');
const { ADMIN_ROLE } = require('../../../core/permissions');

// The Jasper add-on (Reports > Settings and its JasperServer client); the viewer needs it to run reports.
const ADDON = '../../../addons/jasperprintout/models/';
function addon() {
  try {
    return {
      settingsModel: require(ADDON + 'settings.model'),
      pub: require(ADDON + 'publish.service'),
      jasper: require(ADDON + 'jasper.service'),
      datasetQuery: require(ADDON + 'datasetQuery')
    };
  } catch (e) {
    throw bad('The Jasper Print-Out Builder add-on (Reports > Settings) is not installed, so reports cannot be opened.', 501);
  }
}

const bad = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const json = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (!err.expose) console.error('Jasper Viewer:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. The details are in the server log.' });
  }
};

const FORMATS = {
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv; charset=utf-8'
};
const NAME_RE = /^[A-Za-z_$][\w$.\-]*$/;
const LOCALE_RE = /^[a-z]{2}(_[A-Z]{2})?$/;
// URL query keys that are JasperServer's own, not report parameters.
const NOT_PARAMS = new Set(['_flowid', 'reportunit', 'output', 'j_username', 'j_password', 'j_password_pseudo', 'decorate', 'decoration',
  'standalone', 'userlocale', 'parentfolderuri', 'viewasdashboardframe', 'theme', 'page', 'pages', 'ignorepagination', 'interactive', 'freshdata', 'savedataSnapshot'.toLowerCase()]);

// A repository path from the request: "/" or "/A/B c", without "..".
function repoUri(value, what) {
  const uri = '/' + String(value || '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
  if (uri.length > 500 || /(^|\/)\.\.(\/|$)|[\u0000-\u001f]/.test(uri)) throw bad(`That ${what} path is not valid.`);
  return uri;
}

// The JasperServer with this id from Reports > Settings, as the JasperServer client expects it.
// browse: refused when Settings does not show its folders in the viewer ("Show its folders in Jasper Viewer").
async function serverOn(id, browse) {
  const { settingsModel, pub } = addon();
  const settings = await settingsModel.get('designer');
  const sv = pub.servers({ servers: [String(id || '')] }, settings)[0];
  if (browse && !settingsModel.canBrowse(sv, 'viewer')) throw bad(`${sv.name}: showing its folders in the Jasper Viewer is turned off in Reports > Settings. Open its reports from a link (URL).`, 403);
  return Object.assign(pub.on(settings, sv), { browseFolders: sv.browseFolders || [] });
}

// The report parameters a JRXML declares (not the built-in ones):
// [{ name, cls, def, desc, prompt }] — def: the default value expression as written.
function jrxmlParams(jrxml) {
  const out = [];
  const re = /<parameter\b([^>]*?)(\/>|>([\s\S]*?)<\/parameter>)/g;
  const attr = (a, n) => { const m = new RegExp('\\b' + n + '="([^"]*)"').exec(a); return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null; };
  const inner = (body, tag) => {
    const m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>').exec(body || '');
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  };
  let m;
  // Parameters of the main dataset only: those inside <subDataset> belong to it.
  const main = String(jrxml || '').replace(/<subDataset\b[\s\S]*?<\/subDataset>/g, '');
  while ((m = re.exec(main)) && out.length < 200) {
    const a = m[1], name = attr(a, 'name');
    if (!name || attr(a, 'isSystemDefined') === 'true') continue;
    out.push({
      name, cls: attr(a, 'class') || 'java.lang.String', prompt: attr(a, 'isForPrompting') !== 'false',
      def: inner(m[3], 'defaultValueExpression').slice(0, 2000), desc: inner(m[3], 'parameterDescription').slice(0, 500)
    });
  }
  return out;
}

/** The page: the JasperServers to open reports from and the site's HIS report templates. */
exports.index = async function (req, res) {
  let servers = [], configured = false, setupError = '';
  // Reports > Settings > Print & download (all allowed when the settings can't be read).
  let output = { download: true, print: true, drive: true };
  try {
    const { settingsModel } = addon();
    const settings = await settingsModel.forPage('designer');
    configured = !!settings.configured;
    output = { download: settings.allowViewerDownload !== false, print: settings.allowViewerPrint !== false, drive: settings.allowViewerDrive !== false };
    servers = settings.servers.filter((sv) => sv.configured).map((sv) => ({ id: sv.id, name: sv.name, url: sv.url, zone: sv.zone || '', browse: settingsModel.canBrowse(sv, 'viewer') }));
  } catch (err) {
    setupError = err.expose ? err.message : 'Reports > Settings could not be read.';
    if (!err.expose) console.error('Jasper Viewer settings:', err);
  }

  let org = null, templates = [];
  const orgcode = req.session.sitecode;
  if (orgcode) {
    try {
      const orgData = await organisationsModel.getOrgData(orgcode);
      if (orgData && orgData.length) org = orgData[0];
    } catch (err) {
      console.error('Jasper Viewer org data:', err.message);
    }
    if (org && org._id) {
      try {
        templates = ((await reportTemplateModel.getAllReportTemplate(org._id)) || [])
          .filter((t) => t.routepath)
          .map((t) => ({ name: t.name || '', code: t.code || '', routepath: t.routepath, locale: t.reportlocale || '', paramType: String(t.paramtype || '').trim() }));
      } catch (err) {
        console.error('Jasper Viewer report templates:', err.message);
      }
    }
  }

  return res.renderPage(view('jasperviewer'), {
    title: 'Jasper Report Viewer',
    servers, configured, setupError, templates, output,
    org: org ? { id: String(org._id || ''), name: org.name || '', code: org.code || '' } : null,
    isAdmin: !!req.user && req.user.role === ADMIN_ROLE,
    // Recent remembers who opened each report (this browser keeps the list).
    me: req.user ? { username: req.user.username, name: req.user.name || req.user.username } : null
  });
};

/** Folders and report units in a folder of a JasperServer. */
exports.browse = json(async (req, res) => {
  const folder = repoUri(req.query.folder, 'folder');
  const { jasper, settingsModel } = addon();
  const settings = await serverOn(req.params.sid, true);
  const shown = settingsModel.listFolder(settings, folder, await jasper.browse(settings, folder));
  if (!shown) throw bad(`${settings.name}: that folder is not one Reports > Settings lets the Jasper Viewer show.`, 403);
  res.json({ folder, items: shown });
});

/** Report units whose name or description has q. */
exports.search = json(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ items: [] });
  const { jasper, settingsModel } = addon();
  const settings = await serverOn(req.params.sid, true);
  res.json({ items: (await jasper.search(settings, q)).filter((x) => settingsModel.inFolders(settings, x.uri)) });
});

/** A report unit and the parameters its JRXML declares. */
exports.report = json(async (req, res) => {
  const { jasper } = addon();
  const uri = repoUri(req.query.uri, 'report');
  const settings = await serverOn(req.params.sid);
  const unit = await jasper.reportUnit(settings, uri);
  let params = [], note = '';
  if (unit.jrxmlUri) {
    try { params = jrxmlParams((await jasper.file(settings, unit.jrxmlUri)).toString('utf8')); } catch (err) { note = 'Its parameters could not be read (' + err.message + ').'; }
  } else note = 'The report unit has no JRXML, so its parameters are not known.';
  res.json({ uri: unit.uri, label: unit.label, server: settings.name, params, note });
});

/**
 * A pasted JasperServer URL: which server of Reports > Settings it is on, the report, the output and
 * the parameters in it. flow.html?_flowId=viewReportFlow&reportUnit=/A/B&output=pdf&x=1, or
 * rest_v2/reports/A/B.pdf?x=1. j_username / j_password are dropped: the Settings login is used.
 */
exports.resolve = json(async (req, res) => {
  const { settingsModel } = addon();
  let url;
  try { url = new URL(String(req.query.url || '').trim()); } catch (e) { throw bad('That is not a URL. Paste the whole JasperServer link, starting with http:// or https://.'); }
  if (!/^https?:$/.test(url.protocol)) throw bad('The URL must start with http:// or https://.');
  const settings = await settingsModel.get('designer');
  const norm = (u) => { try { const x = new URL(u); return (x.protocol + '//' + x.host.toLowerCase() + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch (e) { return ''; } };
  const here = (url.protocol + '//' + url.host.toLowerCase() + url.pathname).toLowerCase();
  const candidates = (settings.servers || []).filter((sv) => sv.url && here.indexOf(norm(sv.url) + '/') === 0)
    .sort((a, b) => norm(b.url).length - norm(a.url).length);
  const sv = candidates[0];
  if (!sv) {
    throw bad(`${url.host} is not a JasperServer in Reports > Settings, so the viewer cannot open it. ` +
      'The viewer only uses the JasperServers set up there (with their saved login).', 404);
  }
  const base = new URL(sv.url).pathname.replace(/\/+$/, '');
  const rest = url.pathname.slice(base.length);
  let uri = '', format = '';
  const restMatch = /^\/rest_v2\/reports(\/.+?)(?:\.(\w+))?$/i.exec(rest);
  if (restMatch) { uri = decodeURIComponent(restMatch[1]); format = (restMatch[2] || '').toLowerCase(); }
  else if (url.searchParams.get('reportUnit')) uri = url.searchParams.get('reportUnit');
  if (!uri) throw bad('The URL does not name a report: it needs reportUnit=… (flow.html) or /rest_v2/reports/….');
  uri = repoUri(uri, 'report');
  if (!format) format = String(url.searchParams.get('output') || 'pdf').toLowerCase();
  const params = {};
  let credentials = false;
  url.searchParams.forEach((v, k) => {
    if (/^j_(username|password)/i.test(k)) { credentials = true; return; }
    if (NOT_PARAMS.has(k.toLowerCase()) || !NAME_RE.test(k)) return;
    params[k] = String(v).slice(0, 2000);
  });
  const locale = url.searchParams.get('userLocale') || '';
  res.json({ sid: sv.id, server: sv.name, uri, format: FORMATS[format] ? format : 'pdf', params, locale: LOCALE_RE.test(locale) ? locale : '', credentials });
});

/** Values for the well-known ID parameters from the connected Centrix site, and the site's organisation. */
exports.sampleParams = json(async (req, res) => {
  let values = {};
  try { values = await addon().datasetQuery.sampleParams(); } catch (e) { values = {}; }
  res.json({ values });
});

/** Runs a report unit on a JasperServer of Reports > Settings and sends the file. */
exports.run = async function (req, res) {
  try {
    const { jasper } = addon();
    const uri = repoUri(req.query.uri, 'report');
    if (uri === '/') throw bad('Choose a report first.');
    const format = FORMATS[req.query.format] ? req.query.format : 'pdf';
    const { settingsModel } = addon();
    const allowDownload = (await settingsModel.get('designer')).allowViewerDownload !== false;
    if (!allowDownload && !['pdf', 'html'].includes(format)) throw bad('Downloading reports is turned off in Reports > Settings, so only PDF and HTML can be viewed.', 403);
    const settings = await serverOn(req.query.sid);
    let raw = {};
    try { raw = JSON.parse(req.query.params || '{}') || {}; } catch (e) { throw bad('The report parameters could not be read.'); }
    const params = {};
    Object.entries(typeof raw === 'object' ? raw : {}).forEach(([k, v]) => {
      if (NAME_RE.test(k) && !/^j_/i.test(k) && v !== '' && v != null) params[k] = String(v).slice(0, 2000);
    });
    const locale = String(req.query.locale || '');
    if (LOCALE_RE.test(locale)) params.userLocale = locale;
    // Stop (or a closed page): the browser drops the request, the response closes before it is sent,
    // and the wait for JasperServer is cancelled.
    const stop = new AbortController();
    res.on('close', () => { if (!res.writableFinished) stop.abort(); });
    const file = await jasper.run(settings, uri, format, params, { signal: stop.signal });
    const name = (uri.split('/').pop() || 'report').replace(/[^\w.\-]+/g, '_');
    console.log(`Jasper Viewer: ${req.user ? req.user.username : '?'} ran ${uri} (${format}) on ${settings.name}`);
    res.set('Content-Type', FORMATS[format]);
    res.set('X-Jasper-Server', encodeURIComponent(settings.name));
    res.set('Content-Disposition', `${['pdf', 'html'].includes(format) ? 'inline' : 'attachment'}; filename="${name}.${format}"`);
    if (!allowDownload) res.set('Cache-Control', 'no-store');
    res.send(file);
  } catch (err) {
    if (err.stopped) { console.log(`Jasper Viewer: ${req.user ? req.user.username : '?'} stopped ${req.query.uri}`); if (!res.headersSent && !res.writableEnded) res.status(499).end(); return; }
    if (!err.expose) console.error('Jasper Viewer run:', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. The details are in the server log.' });
  }
};

// Basic Data popup (Query Studio's component and data: organisation, date, visit and encounter-type ids to
// type into the parameters), under the viewer's own permission.
const BASIC_DATA_JS = require('path').join(__dirname, '../../../addons/querystudio/public/basic-data.js');
exports.basicDataScript = (req, res) => res.type('application/javascript').sendFile(BASIC_DATA_JS, (err) => {
  if (err && !res.headersSent) res.status(404).type('application/javascript').send('/* Basic Data needs the Query Studio add-on. */');
});
exports.basicData = (name) => (req, res, next) => {
  let qs;
  try { qs = require('../../../addons/querystudio/controllers/querydata.controller'); } catch (e) {
    return res.status(501).json({ error: 'Basic Data needs the Query Studio add-on.' });
  }
  return qs[name](req, res, next);
};

exports._test = { jrxmlParams };
