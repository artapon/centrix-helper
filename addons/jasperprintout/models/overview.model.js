// Reports > Overview: counts for the dashboard, from the Jasper Designer library, its publish history and the
// UAT -> Production deploys (SQLite, so it works without a Centrix connection), plus the connected site's HIS
// report templates when there is one. Read-only.
const mongoose = require('mongoose');
const { all, get } = require('../../../app/core/config/sqlite');
const designs = require('./designs.model');
const deploys = require('./deploys.model');

const MAX_BARS = 8;          // longer lists end with "Other"

// The last `months` months as YYYY-MM, oldest first (server's local time, as the stored times are read below).
function monthKeys(months) {
  const out = [], d = new Date();
  d.setDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}

// { 'YYYY-MM': n } of a column, from the first month on.
async function perMonth(table, column, since, where = '') {
  const rows = await all(`SELECT substr(datetime(${column}, 'localtime'), 1, 7) AS m, COUNT(*) AS n FROM ${table}
                           WHERE ${column} IS NOT NULL AND datetime(${column}, 'localtime') >= ? ${where} GROUP BY m`, [since]);
  const out = {};
  rows.forEach((r) => { out[r.m] = r.n; });
  return out;
}

// [{ label, n }] most first; past MAX_BARS the rest is one "Other" bar.
function topBars(rows, blank) {
  const list = rows.map((r) => ({ label: String(r.label || '').trim() || blank, n: Number(r.n) || 0 })).sort((a, b) => b.n - a.n);
  if (list.length <= MAX_BARS) return list;
  const rest = list.slice(MAX_BARS - 1).reduce((s, r) => s + r.n, 0);
  return list.slice(0, MAX_BARS - 1).concat([{ label: 'Other', n: rest, other: true }]);
}

/**
 * opts: { months: 6 | 12 | 24, orgId }
 * → { tiles, activity: { months, series }, pipeline, byServer, byFolder, byUser, templates, since }
 */
exports.get = async function ({ months, orgId }) {
  // The tables exist once their models have been used.
  const [list, latest] = await Promise.all([designs.list(), deploys.latest()]);
  const keys = monthKeys(months);
  const since = keys[0] + '-01 00:00:00';

  const [created, published, toUat, toProd, pubTotal, pub30, servers, users, folderCount] = await Promise.all([
    perMonth('jasper_designs', 'created_at', since),
    perMonth('jasper_design_publishes', 'published_at', since),
    perMonth('jasper_deploys', 'uat_at', since),
    perMonth('jasper_deploys', 'prod_at', since),
    get('SELECT COUNT(*) AS n FROM jasper_design_publishes'),
    get("SELECT COUNT(*) AS n FROM jasper_design_publishes WHERE datetime(published_at) >= datetime('now', '-30 days')"),
    all(`SELECT server AS label, COUNT(*) AS n FROM jasper_design_publishes WHERE datetime(published_at, 'localtime') >= ? GROUP BY server`, [since]),
    all(`SELECT who AS label, COUNT(*) AS n FROM (
           SELECT published_by AS who, published_at AS at FROM jasper_design_publishes
           UNION ALL SELECT uat_by, uat_at FROM jasper_deploys
           UNION ALL SELECT prod_by, prod_at FROM jasper_deploys WHERE prod_at IS NOT NULL
         ) WHERE who <> '' AND datetime(at, 'localtime') >= ? GROUP BY who`, [since]),
    get(`SELECT COUNT(*) AS n FROM (SELECT path FROM jasper_design_folders UNION SELECT path FROM jasper_designs WHERE path <> '')`)
  ]);

  // Where each saved design is now: its latest deploy, or not deployed yet.
  const rows = list.designs || [];
  const stage = { none: 0, uat: 0, approved: 0, rejected: 0, production: 0 };
  rows.forEach((d) => {
    const dep = latest[d.id];
    const s = !dep ? 'none' : dep.status === 'superseded' ? 'uat' : dep.status;
    stage[s in stage ? s : 'none']++;
  });

  // Designs per top-level folder of the library.
  const folders = {};
  rows.forEach((d) => { const top = String(d.path || '').split('/').filter(Boolean)[0] || ''; folders[top] = (folders[top] || 0) + 1; });

  // HIS report templates of the connected site, per report parameter type.
  let templates = null;
  if (orgId && mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      const r = await mongoose.connection.db.collection('reporttemplates').aggregate([
        { $match: { statusflag: 'A', orguid: new mongoose.Types.ObjectId(orgId) } },
        { $group: { _id: '$paramtype', n: { $sum: 1 } } }
      ], { maxTimeMS: 15000 }).toArray();
      templates = topBars(r.map((x) => ({ label: x._id, n: x.n })), '(no type)');
    } catch (err) {
      templates = null;
    }
  }

  return {
    since: keys[0],
    tiles: {
      designs: rows.length, folders: folderCount ? folderCount.n : 0,
      published: pubTotal ? pubTotal.n : 0, published30: pub30 ? pub30.n : 0,
      waiting: stage.uat, production: stage.production,
      templates: templates ? templates.reduce((s, t) => s + t.n, 0) : null
    },
    activity: {
      months: keys,
      series: [
        { key: 'created', label: 'Designs created', data: keys.map((k) => created[k] || 0) },
        { key: 'published', label: 'Published', data: keys.map((k) => published[k] || 0) },
        { key: 'uat', label: 'Deployed to UAT', data: keys.map((k) => toUat[k] || 0) },
        { key: 'prod', label: 'Deployed to Production', data: keys.map((k) => toProd[k] || 0) }
      ]
    },
    pipeline: [
      { key: 'none', label: 'Not deployed', n: stage.none },
      { key: 'uat', label: 'Waiting for review on UAT', n: stage.uat },
      { key: 'approved', label: 'Approved, not in Production yet', n: stage.approved },
      { key: 'rejected', label: 'Rejected on UAT', n: stage.rejected },
      { key: 'production', label: 'In Production', n: stage.production }
    ],
    byServer: topBars(servers, '(server not recorded)'),
    byFolder: topBars(Object.keys(folders).map((k) => ({ label: k, n: folders[k] })), '(top level)'),
    byUser: topBars(users, '(unknown)'),
    templates
  };
};

exports._test = { monthKeys, topBars };
