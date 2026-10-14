// Registers a published print-out in the connected Centrix site: a reporttemplates row (Visit
// Slip) keyed by code, and an auditlogs row like the Centrix "REPORT TEMPLATE" audit.
const mongoose = require('mongoose');

const ObjectId = mongoose.Types.ObjectId;
const db = () => mongoose.connection.db;

exports.connected = () => mongoose.connection.readyState === 1 && !!mongoose.connection.db;

// The connected site's organisation (the registration's orguid), or null when not connected.
exports.siteOrg = async function (session) {
  if (!exports.connected() || !(session && session.dbconnected)) return null;
  try {
    const orgs = await require('../../../core/models/organisations.model').getOrgData(session.sitecode);
    return orgs && orgs[0] ? { _id: String(orgs[0]._id), code: orgs[0].code || '', name: orgs[0].name || '' } : null;
  } catch (err) {
    return null;
  }
};

exports.codeExists = async function (code) {
  const hit = await db().collection('reporttemplates').findOne({ code: String(code) }, { projection: { _id: 1, name: 1, orguid: 1 } });
  return hit ? { exists: true, name: hit.name || '' } : { exists: false };
};

/**
 * @param {object} p  { code, name, locale, routepath, orguid, useruid }
 * @returns {Promise<{ _id, created }>}
 */
exports.register = async function (p) {
  const now = new Date();
  const user = new ObjectId(p.useruid);
  const org = new ObjectId(p.orguid);
  const fields = {
    code: p.code,
    orguid: org,
    statusflag: 'A',
    modifiedby: user,
    modifiedat: now,
    name: p.name,
    description: p.name,
    activefrom: now,
    activeto: null,
    reportgroupuid: null,
    routepath: p.routepath,
    paramtype: 'VISITSLIP',
    reportid: '001',
    statecode: '',
    issecuredreport: true,
    papersize: 'A4',
    orientation: 'PORTRAIT',
    isautoprint: false,
    displayorder: 99,
    reportlocale: p.locale,
    isreportstat: false,
    additionalparameter: [],
    nocopy: 0,
    disablereprint: false,
    isreportexport: false
  };
  const r = await db().collection('reporttemplates').findOneAndUpdate(
    { code: p.code },
    { $set: fields, $setOnInsert: { createdby: user, createdat: now } },
    { upsert: true, returnDocument: 'after' }
  );
  const doc = r && (r.value || r);
  const created = !!(r && r.lastErrorObject && r.lastErrorObject.upserted);

  await db().collection('auditlogs').insertOne({
    useruid: user,
    auditdate: now,
    patientuid: null,
    dataset: 'REPORT TEMPLATE',
    datasetuid: doc && doc._id,
    postaudit: JSON.stringify(Object.assign({}, fields, { createdby: user, createdat: now })),
    createdby: user,
    createdat: now,
    modifiedby: user,
    modifiedat: now,
    statusflag: 'A',
    orguid: org
  });
  return { _id: doc && doc._id, created };
};
