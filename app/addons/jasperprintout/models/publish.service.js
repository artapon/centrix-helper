// Publishing shared by the Print-Out Builder, Jasper Designer and Publish Report: where a report
// goes (Reports > Settings defaults, checked), the JasperServers it is uploaded to (one or more),
// the optional Centrix HIS registration and the publish history of saved designs.
const settingsModel = require('./settings.model');
const jasper = require('./jasper.service');
const his = require('./his.model');
const designs = require('./designs.model');
const permissions = require('../../../core/permissions');

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const FOLDER_RE = /^[A-Za-z0-9_\-/ ]+$/;

const bad = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
exports.bad = bad;

/** An express handler that answers JSON errors ({ error }) and logs unexpected ones under `label`. */
exports.json = (label, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (!err.expose) console.error(label + ':', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. The details are in the server log.' });
  }
};

/**
 * What a page needs to know about Reports > Settings for one tool ('builder' or 'designer'):
 * the defaults it publishes with, whether JasperServer and Centrix HIS are ready, and who is asking.
 */
exports.pageContext = async function (req, tool) {
  const [settings, org] = await Promise.all([settingsModel.forPage(tool), his.siteOrg(req.session)]);
  const isAdmin = !!req.user && req.user.role === permissions.ADMIN_ROLE;
  return {
    defaults: { folder: settings.defaultFolder, dataSource: settings.defaultDataSource },
    // false: Reports > Settings turned direct publishing off (Publish Report's deploy workflow only).
    directPublish: settings.allowDirectPublish !== false,
    // What the user's role may do on each page (addon.json "actions"; administrators: everything).
    can: {
      builder: permissions.actionsFor(req.user, '/reports/print-out-builder'),
      designer: permissions.actionsFor(req.user, '/reports/jasper-designer'),
      publish: permissions.actionsFor(req.user, '/reports/publish')
    },
    jasper: {
      configured: settings.configured,
      servers: settings.servers.map((sv) => ({ id: sv.id, name: sv.name, url: sv.url, configured: sv.configured, publishByDefault: sv.publishByDefault, zone: sv.zone || '' }))
    },
    his: {
      connected: !!org,
      site: (req.session && req.session.site_name) || '',
      org,
      ready: !!org && OBJECT_ID.test(settings.interfaceUserUid),
      userSet: OBJECT_ID.test(settings.interfaceUserUid)
    },
    isAdmin
  };
};

/** { folder, dataSource } with the tool's defaults filled in, checked. */
exports.target = function ({ folder, dataSource }, settings) {
  folder = String(folder || '').trim().replace(/^\/+|\/+$/g, '') || settings.defaultFolder;
  dataSource = String(dataSource || '').trim() || settings.defaultDataSource;
  if (!folder || !FOLDER_RE.test(folder) || folder.includes('..')) throw bad('Folder may contain English letters, numbers, spaces, _ - and /.');
  if (!settingsModel.REPO_PATH.test(dataSource) || dataSource.includes('..')) throw bad('Data source must be a repository path such as /Centrixreports/ArcusDB.');
  return { folder, dataSource };
};

/**
 * The HIS registration asked for (or null): { toHis, hisCode, hisName, locale } from a request,
 * checked against the settings and the connected site.
 */
exports.hisRequest = async function (input, settings, session) {
  const on = input && (input.toHis === true || input.toHis === '1' || input.toHis === 'true');
  if (!on) return null;
  const reg = {
    code: String(input.hisCode || '').trim().slice(0, 60),
    name: String(input.hisName || '').trim().slice(0, 200),
    locale: input.locale === 'en' ? 'en' : 'th'
  };
  if (!reg.code) throw bad('Report code for HIS is required.');
  if (!reg.name) throw bad('Report name for HIS is required.');
  if (!OBJECT_ID.test(settings.interfaceUserUid)) throw bad('Saving to HIS needs the interface user UID. An administrator can set it in Reports > Settings.', 409);
  const org = await his.siteOrg(session);
  if (!org) throw bad('Connect to a Centrix site before saving the report to HIS.', 409);
  reg.orguid = org._id;
  reg.site = (session && session.site_name) || org.name || org.code;
  return reg;
};

/** Whether a report code is already used by a report template in the connected site. */
exports.checkCode = exports.json('Report code check', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) throw bad('Report code is required.');
  if (!his.connected()) throw bad('Not connected to a Centrix site.', 409);
  res.json(await his.codeExists(code));
});

/** The JasperServers a request asks for (servers: ids, or none for the default ones), checked. */
exports.servers = (input, settings) => settingsModel.pickServers(settings, input && input.servers);

/** settings with one server's connection, as jasper.service expects. */
exports.on = (settings, sv) => Object.assign({}, settings, settingsModel.connection(sv));

/**
 * The servers that already have something at /<folder>/<reportName> (publishing replaces it):
 * [{ id, name, updated }]. A server that can't be asked is left out; the publish reports it.
 */
exports.existing = async function ({ settings, servers, folder, reportName }) {
  const found = await Promise.all(servers.map(async (sv) => {
    try {
      const r = await jasper.exists(exports.on(settings, sv), { folder, reportName });
      return r.exists ? { id: sv.id, name: sv.name, updated: r.updated || '' } : null;
    } catch (err) {
      return null;
    }
  }));
  return found.filter(Boolean);
};

/**
 * Publishes a report unit to each server (one after another; a failure doesn't stop the rest),
 * then registers it in HIS when `reg` is given and at least one server has it. designId (a saved
 * Jasper Designer design) adds each successful publish to its history.
 * Returns { routepath, servers: [{ id, name, ok, error }], registered }; throws when all failed.
 */
exports.publish = async function ({ settings, servers, folder, dataSource, reportName, jrxml, images, reg, designId, username, label }) {
  const routepath = `/${folder}/${reportName}`;
  const results = [];
  for (const sv of servers) {
    try {
      await jasper.publish(exports.on(settings, sv), { folder, reportName, dataSource, jrxml, images: images || [] });
      results.push({ id: sv.id, name: sv.name, ok: true });
      console.log(`${label || 'Report'} published to ${sv.name} by ${username}: ${routepath}`);
    } catch (err) {
      if (!err.expose) console.error(`${label || 'Report'}: publishing to ${sv.name} failed:`, err);
      results.push({ id: sv.id, name: sv.name, ok: false, error: err.expose ? err.message : 'Unexpected error (see the server log).' });
    }
  }
  const done = results.filter((r) => r.ok);
  if (!done.length) {
    throw bad(results.map((r) => `${r.name}: ${r.error}`).join(' · '), 502);
  }

  const record = (r) => designId
    ? Promise.all(done.map((sv) => designs.recordPublish(Object.assign({ designId, uri: routepath, dataSource, server: sv.name, username }, r))))
      .catch((err) => console.warn('Could not record the publish:', err.message))
    : Promise.resolve();

  let registered = null;
  if (reg) {
    try {
      const r = await his.register({ code: reg.code, name: reg.name, locale: reg.locale, orguid: reg.orguid, routepath, useruid: settings.interfaceUserUid });
      registered = { code: reg.code, created: r.created };
      console.log(`${routepath} saved to HIS as ${reg.code} by ${username}`);
    } catch (err) {
      console.error(`${label || 'Report'}: HIS registration failed:`, err);
      await record({});
      throw bad(`The report was published to ${done.map((r) => r.name).join(', ')} (${routepath}), but saving it to HIS failed: ${err.message}`, 502);
    }
  }
  await record(registered ? { hisCode: reg.code, hisName: reg.name, hisLocale: reg.locale, hisSite: reg.site } : {});
  return { routepath, servers: results, registered };
};
