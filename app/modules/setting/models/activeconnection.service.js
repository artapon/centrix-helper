const mongoose = require('mongoose');
const { run, get } = require('../../../core/config/sqlite');
const model = require('./dbconnections.model');
const mongoUri = require('./mongouri.helper');

// The app has one Mongo connection, shared by every session. It is chosen on DB Connections
// (/settings/connections); when nothing is connected (e.g. after a restart) the app reconnects
// on its own to the last connection used, or the first one listed.

const LAST_KEY = 'last_connection_id';
let pending = null; // one auto-connect at a time; concurrent requests wait for it

const shared = () => global.sessionData || (global.sessionData = {});

function isConnected() {
  const s = shared();
  return mongoose.connection.readyState === 1 && s.site_index !== undefined && s.site_index !== null && s.site_index !== '';
}

/** Makes the connection at SITE_INDEX the app's active connection. Throws if it cannot be reached. */
async function connect(siteIndex) {
  const connection = await model.getByIndex(siteIndex);
  if (!connection) throw new Error('Connection not found');
  const settings = await model.getSettings(connection.ID);

  // Close the active connection and wait until it is fully closed
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    await mongoose.connection.close();
  }
  while (mongoose.connection.readyState !== 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await mongoose.connect(mongoUri.build(settings), mongoUri.clientOptions(settings));
  console.log(`${connection.NAME} mongodb connected successfully.`);

  Object.assign(shared(), {
    site_name: connection.NAME,
    site_index: siteIndex,
    site_color: connection.COLOR,
    sitecode: connection.DEFAULT_SITE_CODE,
    centrixURL: connection.CENTRIX_BASE_URL
  });
  await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [LAST_KEY, String(connection.ID)])
    .catch((err) => console.error('Could not remember the last connection:', err.message));
  return connection;
}

/** Selects the shared connection for this session. */
function joinSession(req) {
  const s = shared();
  Object.assign(req.session, {
    site_index: s.site_index,
    site_name: s.site_name,
    site_color: s.site_color,
    sitecode: s.sitecode,
    centrixURL: s.centrixURL,
    dbconnected: true
  });
}

function clearSession(req) {
  req.session.site_index = null;
  req.session.site_name = null;
  req.session.site_color = null;
  req.session.dbconnected = false;
  req.session.sitecode = null;
}

/** Connects to the last connection used, or the first one on DB Connections. */
function autoConnect() {
  if (pending) return pending;
  pending = (async () => {
    const list = await model.list();
    if (!list.length) throw new Error('No DB connections configured yet');
    const last = await get('SELECT value FROM app_meta WHERE key = ?', [LAST_KEY]).catch(() => null);
    const target = (last && list.find((c) => String(c.ID) === String(last.value))) || list[0];
    try {
      await connect(target.SITE_INDEX);
    } catch (err) {
      throw new Error(`${target.NAME}: ${err.message}`);
    }
  })().finally(() => { pending = null; });
  return pending;
}

/** Makes sure this session has a connection: joins the shared one, or auto-connects. Throws on failure. */
async function ensure(req) {
  if (!isConnected()) await autoConnect();
  joinSession(req);
}

module.exports = { connect, joinSession, clearSession, autoConnect, ensure, isConnected };
