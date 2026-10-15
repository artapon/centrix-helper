const mongoose = require('mongoose');
const activeConnection = require('../models/activeconnection.service');
const model = require('../models/dbconnections.model');
const mongoUri = require('../models/mongouri.helper');
const view = require('../../../core/view')('setting');
const permissions = require('../../../core/permissions');

const back = (res, kind, message) => res.redirect(`/database/connections?${kind}=${encodeURIComponent(message)}`);

// Connects the app to SITE_INDEX and selects it for this session. Throws if the server cannot be reached.
async function connectTo(req, siteIndex) {
  await activeConnection.connect(siteIndex);
  activeConnection.joinSession(req);
}

exports.index = async function (req, res) {
  const connections = await model.list();
  return res.renderPage(view('dbconnections'), {
    title: 'DB Connections',
    connections: connections.map((c) => ({
      ID: c.ID,
      SITE_INDEX: c.SITE_INDEX,
      NAME: c.NAME,
      CONN_TYPE: c.CONN_TYPE,
      USE_SRV: c.USE_SRV,
      TLS: c.TLS,
      COLOR: c.COLOR,
      MONGODB_HOST: c.MONGODB_HOST,
      MONGODB_PORT: c.MONGODB_PORT,
      MONGODB_REPLICA_SET: c.MONGODB_REPLICA_SET,
      MONGODB_DB: c.MONGODB_DB,
      DEFAULT_SITE_CODE: c.DEFAULT_SITE_CODE,
      CENTRIX_BASE_URL: c.CENTRIX_BASE_URL
    })),
    activeSiteIndex: req.session.dbconnected ? req.session.site_index : null,
    // The row Connect buttons post to /db/connection, which needs the "DB Info" permission.
    canConnect: permissions.canAccessPath(req.user, '/database/connect'),
    success: req.query.success || '',
    error: req.query.error || '',
  });
};

exports.getOne = async function (req, res) {
  try {
    const conn = await model.getRawById(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Not found' });
    return res.json(conn);
  } catch (err) {
    console.error('Error fetching db connection:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Save, then optionally connect ("Save & Connect").
async function saveAndMaybeConnect(req, res, id, verb) {
  if (!String(req.body.name || '').trim()) return back(res, 'error', 'Connection name is required');
  if (!String(req.body.default_site_code || '').trim()) return back(res, 'error', 'Default site code is required');
  if (!String(req.body.mongodb_host || '').trim()) return back(res, 'error', 'Server is required');

  let savedId;
  try {
    savedId = id ? await model.update(id, req.body) : await model.create(req.body);
  } catch (err) {
    console.error(`Error saving db connection:`, err.message);
    return back(res, 'error', `Failed to ${verb} connection`);
  }

  if (req.body.connect !== '1') return back(res, 'success', `Connection ${verb}d successfully`);
  try {
    await connectTo(req, await model.indexOfId(savedId));
    return res.redirect('/overview');
  } catch (err) {
    activeConnection.clearSession(req);
    return back(res, 'error', `Connection ${verb}d, but connecting failed: ${err.message}`);
  }
}

exports.create = (req, res) => saveAndMaybeConnect(req, res, null, 'create');
exports.update = (req, res) => saveAndMaybeConnect(req, res, req.params.id, 'update');

exports.remove = async function (req, res) {
  try {
    await model.remove(req.params.id);
    return back(res, 'success', 'Connection deleted');
  } catch (err) {
    console.error('Error deleting db connection:', err.message);
    return back(res, 'error', 'Failed to delete connection');
  }
};

/**
 * "Test Connection": connects with the editor's current values (a blank password on an
 * existing connection uses the stored one) on a separate client, so the app's active
 * connection is not touched. Responds with server details or the driver's error.
 */
exports.test = async function (req, res) {
  const settings = await model.resolveSettings(req.body, req.body.id);
  if (!settings.mongodb_host) return res.status(400).json({ ok: false, error: 'Server is required.' });

  const started = Date.now();
  let client;
  try {
    client = await mongoose.mongo.MongoClient.connect(mongoUri.build(settings), {
      ...mongoUri.clientOptions(settings),
      poolSize: 1
    });
    const admin = client.db('admin');
    const [ping, buildInfo, hello] = await Promise.all([
      admin.command({ ping: 1 }),
      admin.command({ buildInfo: 1 }),
      admin.command({ isMaster: 1 })
    ]);
    let collections = null;
    if (settings.mongodb_db) {
      collections = (await client.db(settings.mongodb_db).listCollections({}, { nameOnly: true }).toArray()).length;
    }
    return res.json({
      ok: ping.ok === 1,
      latencyMs: Date.now() - started,
      version: buildInfo.version,
      replicaSet: hello.setName || '',
      primary: hello.primary || '',
      hosts: hello.hosts || [],
      database: settings.mongodb_db,
      collections
    });
  } catch (err) {
    return res.json({ ok: false, latencyMs: Date.now() - started, error: err.message });
  } finally {
    if (client) client.close().catch(() => {});
  }
};

// "From URI" (action: parse) and "To URI" (action: build; a stored password shows as <password>).
exports.uri = async function (req, res) {
  try {
    if (req.body.action === 'parse') return res.json({ ok: true, settings: mongoUri.parse(req.body.uri) });

    const settings = await model.resolveSettings(req.body, req.body.id);
    const typedPassword = !!req.body.mongodb_password;
    return res.json({ ok: true, uri: mongoUri.build(settings, { maskPassword: !typedPassword }) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
};

// Switches the active Mongo connection to the site of a DB Connections row.
// Top bar "Connect DB" / "Reconnect DB": the last connection used (or the first one listed), then
// back to the page it was pressed on (next: a path of this app only).
exports.reconnect = async function (req, res) {
  const raw = String((req.body && req.body.next) || '');
  const next = /^\/(?!\/)[^\s\\]*$/.test(raw) ? raw : '/overview';
  try {
    await activeConnection.ensure(req);
    return res.redirect(next);
  } catch (err) {
    console.error('Reconnect failed:', err.message);
    activeConnection.clearSession(req);
    return back(res, 'error', `Connecting failed: ${err.message}`);
  }
};

exports.connect = async function (req, res) {
  try {
    await connectTo(req, req.body.site_index);
    return res.redirect('/overview');
  } catch (err) {
    console.error('Connect failed:', err.message);
    activeConnection.clearSession(req);
    return back(res, 'error', `Connecting failed: ${err.message}`);
  }
};
