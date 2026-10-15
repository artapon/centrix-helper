// Reports > Settings, shared by the Print-Out Builder, Jasper Designer and Publish Report: the
// JasperServers they publish to, Centrix HIS registration and each tool's report defaults.
// One JSON row in SQLite app_meta; JasperServer passwords are stored encrypted.
// servers: [{ id, name, url, user, password, allowSelfSigned, publishByDefault, zone, browseDesigner, browseViewer }].
// browseDesigner / browseViewer: its folders are shown in Jasper Designer > Open a design / in the Jasper
// Viewer (on unless turned off; servers saved before these settings show everywhere). browseFolders: the
// folders those lists may show ([] = all), e.g. ['/Centrixreports/Lab']: each with everything in it; the
// folders above them only as the way down to them (see listFolder). A report can be
// published to several at once; those marked publishByDefault are ticked first. zone ('uat', 'prod'
// or '') puts a server in a stage of the UAT -> Production deploy workflow on Publish Report. Settings saved
// before there were several servers (jasperUrl, jasperUser, …) become the server "Main".
// The Jasper Designer (and Publish Report) defaults are optional: empty means "same as the
// Print-Out Builder", so get('designer') resolves them before use.
const { run, get } = require('../../../app/core/config/sqlite');
const { medintEncrypt: encrypt, medintDecrypt: decrypt } = require('../../../app/core/helpers/encryption');
const JD = require('../public/jrxml-design');      // the watermark's settings, as a design keeps them

const KEY = 'jasperprintout.settings';
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const REPO_PATH = /^\/[A-Za-z0-9_\-./]*$/;

const MAX_SERVERS = 10;
const SERVER_ID = /^[a-z0-9]{1,16}$/;
const ZONES = Object.freeze({ uat: 'UAT', prod: 'Production' });

const DEFAULTS = Object.freeze({
  servers: [],
  defaultFolder: 'PrintOut',
  defaultDataSource: '/Centrixreports/ArcusDB',
  inputControls: ['/PrintOut/InputControls/patientvisituid', '/PrintOut/InputControls/organisationuid'],
  headerSubreport: '/Centrixreports/SubReports/LayoutHeader.jrxml',
  // false: reports reach JasperServer only through Publish Report's deploy workflow (UAT, then
  // Production); the Print-Out Builder, Jasper Designer and Publish Report hide direct publishing.
  allowDirectPublish: true,
  // Print & download (on unless turned off): Jasper Designer's Save PDF / Print (Live Preview), and the
  // Jasper Viewer's Download, Print and Save to Google Drive (the browser's PDF toolbar).
  allowDesignerPrint: true,
  allowViewerDownload: true,
  allowViewerPrint: true,
  allowViewerDrive: true,
  // Jasper Designer and Publish Report ('' / 'same' = the Print-Out Builder's value)
  designerFolder: '',
  designerDataSource: '',
  // The watermark new Jasper Designer reports start with ({ text, angle, size, color, opacity, bold, font,
  // tiled, gap }, as a design keeps it), or null: none.
  designerWatermark: null,
  designerInputControlsMode: 'same',   // 'same' | 'custom' (custom with no paths = none)
  designerInputControls: [],
  interfaceUserUid: '',          // Centrix user written as createdby/modifiedby when registering in HIS
  // Only used by Jaspersoft Studio when the JRXML is opened there
  dataAdapter: '',
  reportUnit: '',
  defaultVisitUid: '',
  defaultOrgUid: ''
});

let cache = null;

const yes = (v) => v === true || v === 'true' || v === 'on' || v === '1';
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const newId = () => Math.random().toString(36).slice(2, 10);

// The servers list from the form. A blank password keeps the stored one (matched by id);
// clearPassword removes it.
// The folders a server's lists may show: repository paths such as /Centrixreports/Lab (no duplicates,
// none inside another one of the list).
const MAX_FOLDERS = 50;
const folderPath = (f) => '/' + String(f || '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
function cleanFolders(list, label, errors) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, MAX_FOLDERS + 1).forEach((f) => {
    const p = folderPath(f);
    if (p === '/') return;
    if (!REPO_PATH.test(p) || p.includes('..') || p.length > 300) { errors.push(`${label}: "${String(f).slice(0, 80)}" is not a folder path such as /Centrixreports/Lab.`); return; }
    if (!out.includes(p)) out.push(p);
  });
  if (out.length > MAX_FOLDERS) errors.push(`${label}: at most ${MAX_FOLDERS} folders can be listed.`);
  // A folder inside another listed one adds nothing.
  return out.slice(0, MAX_FOLDERS).filter((p) => !out.some((q) => q !== p && p.startsWith(q + '/')));
}

function cleanServers(input, stored, errors) {
  const old = new Map((stored || []).map((sv) => [sv.id, sv]));
  const list = Array.isArray(input) ? input.slice(0, MAX_SERVERS + 1) : [];
  if (list.length > MAX_SERVERS) errors.push(`At most ${MAX_SERVERS} JasperServers can be set up.`);
  const names = new Set();
  const ids = new Set();
  return list.slice(0, MAX_SERVERS).map((raw) => {
    raw = raw || {};
    let id = SERVER_ID.test(String(raw.id || '')) && !ids.has(raw.id) ? raw.id : newId();
    ids.add(id);
    const prev = old.get(id) || {};
    const sv = {
      id,
      name: str(raw.name, 60),
      url: str(raw.url, 500).replace(/\/+$/, ''),
      user: str(raw.user, 100),
      password: yes(raw.clearPassword) ? '' : raw.password ? encrypt(String(raw.password)) : (prev.password || ''),
      allowSelfSigned: yes(raw.allowSelfSigned),
      publishByDefault: yes(raw.publishByDefault),
      zone: ZONES[raw.zone] ? raw.zone : '',
      browseDesigner: raw.browseDesigner == null ? true : yes(raw.browseDesigner),
      browseViewer: raw.browseViewer == null ? true : yes(raw.browseViewer),
      browseFolders: cleanFolders(raw.browseFolders, str(raw.name, 60) || 'A JasperServer', errors)
    };
    const label = sv.name || sv.url || 'A JasperServer';
    if (!sv.name) errors.push('Give every JasperServer a name.');
    else if (names.has(sv.name.toLowerCase())) errors.push(`Two JasperServers are named "${sv.name}".`);
    names.add(sv.name.toLowerCase());
    if (!/^https?:\/\/[^\s]+$/i.test(sv.url)) errors.push(`${label}: the URL must start with http:// or https://.`);
    return sv;
  });
}

function clean(input, stored) {
  const s = Object.assign({}, DEFAULTS, stored || {});
  const errors = [];
  const out = {
    servers: cleanServers(input.servers, s.servers, errors),
    defaultFolder: str(input.defaultFolder).replace(/^\/+|\/+$/g, '') || DEFAULTS.defaultFolder,
    defaultDataSource: str(input.defaultDataSource) || DEFAULTS.defaultDataSource,
    inputControls: (Array.isArray(input.inputControls) ? input.inputControls : String(input.inputControls || '').split(/\r?\n|,/))
      .map((v) => str(v)).filter(Boolean),
    headerSubreport: str(input.headerSubreport),
    allowDirectPublish: input.allowDirectPublish === undefined ? s.allowDirectPublish !== false : yes(input.allowDirectPublish),
    allowDesignerPrint: input.allowDesignerPrint === undefined ? s.allowDesignerPrint !== false : yes(input.allowDesignerPrint),
    allowViewerDownload: input.allowViewerDownload === undefined ? s.allowViewerDownload !== false : yes(input.allowViewerDownload),
    allowViewerPrint: input.allowViewerPrint === undefined ? s.allowViewerPrint !== false : yes(input.allowViewerPrint),
    allowViewerDrive: input.allowViewerDrive === undefined ? s.allowViewerDrive !== false : yes(input.allowViewerDrive),
    designerFolder: str(input.designerFolder).replace(/^\/+|\/+$/g, ''),
    designerWatermark: input.designerWatermark && typeof input.designerWatermark === 'object'
      ? Object.assign(JD.sanitizeWatermark(input.designerWatermark), { enabled: true }) : null,
    designerDataSource: str(input.designerDataSource),
    designerInputControlsMode: input.designerInputControlsMode === 'custom' ? 'custom' : 'same',
    designerInputControls: (Array.isArray(input.designerInputControls) ? input.designerInputControls : String(input.designerInputControls || '').split(/\r?\n|,/))
      .map((v) => str(v)).filter(Boolean),
    interfaceUserUid: str(input.interfaceUserUid, 24),
    dataAdapter: str(input.dataAdapter),
    reportUnit: str(input.reportUnit),
    defaultVisitUid: str(input.defaultVisitUid, 24),
    defaultOrgUid: str(input.defaultOrgUid, 24)
  };

  if (!/^[A-Za-z0-9_\-/ ]+$/.test(out.defaultFolder) || out.defaultFolder.includes('..')) errors.push('Default folder may contain letters, numbers, _ - and /.');
  if (!REPO_PATH.test(out.defaultDataSource) || out.defaultDataSource.includes('..')) errors.push('Data source must be a repository path such as /Centrixreports/ArcusDB.');
  out.inputControls.forEach((ic) => { if (!REPO_PATH.test(ic) || ic.includes('..')) errors.push(`Input control "${ic}" must be a repository path.`); });
  if (out.headerSubreport && !REPO_PATH.test(out.headerSubreport)) errors.push('Header subreport must be a repository path, or empty for no header.');
  if (out.designerFolder && (!/^[A-Za-z0-9_\-/ ]+$/.test(out.designerFolder) || out.designerFolder.includes('..'))) errors.push('Jasper Designer folder may contain letters, numbers, _ - and /.');
  if (out.designerWatermark && !out.designerWatermark.text.trim()) errors.push('Type the default watermark text, or turn the default watermark off.');
  if (out.designerDataSource && (!REPO_PATH.test(out.designerDataSource) || out.designerDataSource.includes('..'))) errors.push('Jasper Designer data source must be a repository path such as /Centrixreports/ArcusDB.');
  if (out.designerInputControlsMode === 'custom') out.designerInputControls.forEach((ic) => { if (!REPO_PATH.test(ic) || ic.includes('..')) errors.push(`Jasper Designer input control "${ic}" must be a repository path.`); });
  else out.designerInputControls = [];
  ['interfaceUserUid', 'defaultVisitUid', 'defaultOrgUid'].forEach((k) => {
    if (out[k] && !OBJECT_ID.test(out[k])) errors.push(`${k === 'interfaceUserUid' ? 'Interface user UID' : k === 'defaultVisitUid' ? 'Default visit UID' : 'Default organisation UID'} must be a 24-character ObjectId.`);
  });
  if (out.servers.length && !out.servers.some((sv) => sv.publishByDefault)) out.servers[0].publishByDefault = true;
  return { settings: out, errors };
}

// Settings from before several servers: the one server becomes "Main".
function upgrade(v) {
  if (!Array.isArray(v.servers)) {
    v.servers = v.jasperUrl ? [{
      id: 'main', name: 'Main', url: v.jasperUrl, user: v.jasperUser || '', password: v.jasperPassword || '',
      allowSelfSigned: v.allowSelfSigned !== false, publishByDefault: true
    }] : [];
  }
  ['jasperUrl', 'jasperUser', 'jasperPassword', 'allowSelfSigned'].forEach((k) => delete v[k]);
  return v;
}

async function readStored() {
  const row = await get('SELECT value FROM app_meta WHERE key = ?', [KEY]);
  let v = {};
  if (row) { try { v = JSON.parse(row.value) || {}; } catch (err) { v = {}; } }
  return Object.assign({}, DEFAULTS, upgrade(v));
}

const isSetUp = (sv) => !!(sv.url && sv.user && sv.password);

// Whether a server's repository folders may be shown in 'designer' (Open a design) or 'viewer' (Jasper Viewer).
exports.canBrowse = (sv, where) => !!sv && (where === 'viewer' ? sv.browseViewer : sv.browseDesigner) !== false;

// Whether a report or folder uri is in the folders a server's lists may show (all when it has none).
const inFolders = (sv, uri) => {
  const list = (sv && sv.browseFolders) || [];
  const u = folderPath(uri);
  return !list.length || list.some((p) => u === p || u.startsWith(p + '/'));
};
exports.inFolders = inFolders;

/**
 * What a list of a folder (items from JasperServer: { uri, type }) may show of it: everything in a
 * listed folder (or in any folder when none are listed); above them, only the folders on the way down
 * to them; null when the folder is outside them all.
 */
exports.listFolder = function (sv, folder, items) {
  const list = (sv && sv.browseFolders) || [];
  const f = folderPath(folder);
  if (inFolders(sv, f)) return items;
  const below = list.filter((p) => f === '/' || p.startsWith(f + '/'));
  if (!below.length) return null;
  const next = new Set(below.map((p) => (f === '/' ? '' : f) + '/' + p.slice(f === '/' ? 1 : f.length + 1).split('/')[0]));
  return items.filter((x) => x.type === 'folder' && next.has(folderPath(x.uri)));
};

// The defaults one tool works with: 'designer' (Jasper Designer, Publish Report) falls back to the
// Print-Out Builder's folder, data source and input controls where it has none of its own.
function forTool(s, tool) {
  if (tool !== 'designer') return s;
  return Object.assign(s, {
    defaultFolder: s.designerFolder || s.defaultFolder,
    defaultDataSource: s.designerDataSource || s.defaultDataSource,
    inputControls: s.designerInputControlsMode === 'custom' ? s.designerInputControls.slice() : s.inputControls
  });
}

/** Settings with the passwords decrypted (server use only), resolved for a tool when one is given. */
exports.get = async function (tool) {
  if (!cache) cache = await readStored();
  const s = Object.assign({}, cache);
  s.servers = (cache.servers || []).map((sv) => {
    let password = '';
    try { password = sv.password ? decrypt(sv.password) : ''; } catch (err) { password = ''; }
    return Object.assign({}, sv, { password });
  });
  return forTool(s, tool);
};

/** Settings safe to send to the browser: no passwords, only whether each server has one. */
exports.forPage = async function (tool) {
  const s = await exports.get(tool);
  s.servers = s.servers.map(({ password, ...sv }) => Object.assign(sv, { hasPassword: !!password, configured: isSetUp(Object.assign({ password }, sv)) }));
  return Object.assign(s, { configured: s.servers.some((sv) => sv.configured) });
};

/**
 * The servers to publish to: the ids asked for (in Settings order), or those published to by
 * default. Throws when one is unknown or not set up.
 */
exports.pickServers = function (settings, ids) {
  const all = settings.servers || [];
  const wanted = Array.isArray(ids) ? ids.map(String) : ids ? String(ids).split(',') : [];
  const picked = wanted.length ? all.filter((sv) => wanted.includes(sv.id)) : all.filter((sv) => sv.publishByDefault && isSetUp(sv));
  const unknown = wanted.filter((id) => !all.some((sv) => sv.id === id));
  const fail = (message) => Object.assign(new Error(message), { status: 400, expose: true });
  if (unknown.length) throw fail('A chosen JasperServer is no longer in Reports > Settings. Reload the page.');
  if (!all.length) throw Object.assign(fail('JasperServer is not set up yet. An administrator can add one in Reports > Settings.'), { status: 409 });
  if (!picked.length) throw fail('Choose at least one JasperServer.');
  const notReady = picked.filter((sv) => !isSetUp(sv));
  if (notReady.length) throw fail(`${notReady.map((sv) => sv.name).join(', ')} ${notReady.length > 1 ? 'are' : 'is'} missing its URL, user or password in Reports > Settings.`);
  return picked;
};

/**
 * The set-up servers of a deploy workflow zone ('uat' or 'prod'), in Settings order. Throws when
 * there is none.
 */
exports.zoneServers = function (settings, zone) {
  const list = (settings.servers || []).filter((sv) => sv.zone === zone);
  const ready = list.filter(isSetUp);
  if (!ready.length) {
    const err = new Error(list.length
      ? `The ${ZONES[zone]} JasperServer${list.length > 1 ? 's are' : ' is'} missing the URL, user or password in Reports > Settings.`
      : `No JasperServer is in the ${ZONES[zone]} zone yet. An administrator can set it in Reports > Settings.`);
    err.status = 409;
    err.expose = true;
    throw err;
  }
  return ready;
};

/** The connection settings jasper.service works with, for one server. */
exports.connection = (sv) => ({ jasperUrl: sv.url, jasperUser: sv.user, jasperPassword: sv.password, allowSelfSigned: sv.allowSelfSigned, name: sv.name });

/** Throws when direct publishing is turned off in Reports > Settings (the deploy workflow is the way then). */
exports.requireDirectPublish = function (settings) {
  if (settings.allowDirectPublish !== false) return;
  const err = new Error('Direct publishing is turned off in Reports > Settings. Use Publish Report > Deploy workflow: UAT first, then Production.');
  err.status = 403;
  err.expose = true;
  throw err;
};

exports.save = async function (input) {
  const stored = await readStored();
  const { settings, errors } = clean(input || {}, stored);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    err.expose = true;
    throw err;
  }
  await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [KEY, JSON.stringify(settings)]);
  cache = settings;
  return exports.forPage();
};

exports.DEFAULTS = DEFAULTS;
exports.MAX_SERVERS = MAX_SERVERS;
exports.REPO_PATH = REPO_PATH;
exports.ZONES = ZONES;
