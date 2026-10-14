const mongoose = require("mongoose");

// Almost every page looks up its organisation before running its own queries, and the
// record rarely changes, so results are cached briefly per connected database + site code.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

// Used when the connection's site code matches no organisation.
const FALLBACK_SITE_CODE = '00057';

const cacheKey = (sitecode) => {
  const conn = mongoose.connection;
  return `${conn.host}|${conn.port}|${conn.name}|${sitecode}`;
};

function findOrganisations(sitecode) {
  let initfilter = {};
  initfilter.statusflag = 'A';
  if(sitecode) {
    initfilter.code = sitecode;
  }

  return mongoose.connection.db
    .collection("organisations")
    .aggregate(
      [
        {
            $match : initfilter
        }],
      { allowDiskUse: true }
    )
    .toArray()
    .catch(function (err) {
      console.log(err);
      return [];
    });
}

exports.getOrgData = async function (sitecode = '') {
  const key = cacheKey(sitecode);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.organisations.slice();

  let organisations = await findOrganisations(sitecode);

  if (!organisations.length && sitecode && sitecode !== FALLBACK_SITE_CODE) {
    console.warn(`Site code "${sitecode}" matches no active organisation; using ${FALLBACK_SITE_CODE}.`);
    organisations = await findOrganisations(FALLBACK_SITE_CODE);
  }

  if (!organisations.length) {
    // Every data page needs its organisation; say what is wrong instead of failing on org[0]._id.
    const err = new Error(sitecode
      ? `No active organisation with site code "${sitecode}" (or ${FALLBACK_SITE_CODE}) in this database. Check "Default site code" for this connection in Manage Connections.`
      : 'No active organisation found in this database.');
    err.status = 409;
    err.expose = true;
    throw err;
  }
  cache.set(key, { at: Date.now(), organisations });
  return organisations.slice();
};
