// Reports > Publish Report, deploy workflow: a saved design goes to the UAT JasperServers first, is
// checked there (run the report, approve or reject), and only then to the Production ones.
// Each UAT deploy is a row of jasper_deploys holding the exact JRXML and images sent to UAT, so
// Production gets what was verified even if the design is edited afterwards.
//   status: 'uat' (deployed, waiting for review) -> 'approved' | 'rejected'; 'approved' -> 'production'.
// A new UAT deploy of a design replaces the open ones ('uat' / 'approved' become 'superseded').
const crypto = require('crypto');
const { run, get, all } = require('../../../core/config/sqlite');

let ready = null;
function schema() {
  if (!ready) {
    ready = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS jasper_deploys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          design_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          folder TEXT NOT NULL,
          data_source TEXT NOT NULL,
          routepath TEXT NOT NULL,
          jrxml TEXT NOT NULL,
          images TEXT NOT NULL DEFAULT '[]',
          design_hash TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'uat',
          uat_servers TEXT NOT NULL DEFAULT '[]',
          uat_by TEXT NOT NULL DEFAULT '',
          uat_at TEXT DEFAULT (datetime('now')),
          review_by TEXT NOT NULL DEFAULT '',
          review_at TEXT,
          review_note TEXT NOT NULL DEFAULT '',
          prod_servers TEXT NOT NULL DEFAULT '[]',
          prod_by TEXT NOT NULL DEFAULT '',
          prod_at TEXT,
          his_code TEXT NOT NULL DEFAULT ''
        )
      `);
      await run('CREATE INDEX IF NOT EXISTS idx_jasper_deploys_design ON jasper_deploys (design_id, id)');
      // The Report ID printed in the page footer (models/reportId.js), '' when none.
      const cols = await all('PRAGMA table_info(jasper_deploys)');
      if (!cols.some((c) => c.name === 'report_id')) await run("ALTER TABLE jasper_deploys ADD COLUMN report_id TEXT NOT NULL DEFAULT ''");
      // The one Production printed (its deploy time when stamped there, else the UAT one).
      if (!cols.some((c) => c.name === 'prod_report_id')) await run("ALTER TABLE jasper_deploys ADD COLUMN prod_report_id TEXT NOT NULL DEFAULT ''");
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const parse = (s, fallback) => { try { return JSON.parse(s); } catch (e) { return fallback; } };

// The row as the page sees it (no JRXML or images).
const view = (r) => r && ({
  id: r.id, designId: r.design_id, name: r.name, folder: r.folder, dataSource: r.data_source, routepath: r.routepath,
  designHash: r.design_hash, status: r.status, reportId: r.report_id || '',
  uat: { servers: parse(r.uat_servers, []), by: r.uat_by, at: r.uat_at },
  review: r.review_at ? { by: r.review_by, at: r.review_at, note: r.review_note } : null,
  prod: r.prod_at ? { servers: parse(r.prod_servers, []), by: r.prod_by, at: r.prod_at, hisCode: r.his_code, reportId: r.prod_report_id || '' } : null
});

/** A fingerprint of a saved design (its JSON) and the images it uses. */
exports.hash = function (designJson, images) {
  const h = crypto.createHash('sha1').update(designJson, 'utf8');
  (images || []).forEach((img) => h.update(img.name).update(img.buffer));
  return h.digest('hex');
};

/** Records a UAT deploy (images: [{ name, buffer }]) and supersedes the design's open ones. */
exports.createUat = async function ({ designId, name, folder, dataSource, routepath, jrxml, images, designHash, servers, username, reportId }) {
  await schema();
  await run("UPDATE jasper_deploys SET status = 'superseded' WHERE design_id = ? AND status IN ('uat', 'approved')", [designId]);
  const r = await run(`INSERT INTO jasper_deploys (design_id, name, folder, data_source, routepath, jrxml, images, design_hash, uat_servers, uat_by, report_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [designId, name, folder, dataSource, routepath, jrxml,
    JSON.stringify((images || []).map((img) => ({ name: img.name, data: img.buffer.toString('base64') }))),
    designHash, JSON.stringify(servers), username, reportId || '']);
  return exports.get(r.lastID);
};

exports.get = async function (id) {
  await schema();
  return view(await get(`SELECT id, design_id, name, folder, data_source, routepath, design_hash, status, uat_servers, uat_by, uat_at,
                                review_by, review_at, review_note, prod_servers, prod_by, prod_at, his_code, report_id, prod_report_id
                           FROM jasper_deploys WHERE id = ?`, [id]));
};

/** The JRXML and images ([{ name, buffer }]) verified on UAT, to send to Production. */
exports.artifact = async function (id) {
  await schema();
  const r = await get('SELECT jrxml, images FROM jasper_deploys WHERE id = ?', [id]);
  if (!r) return null;
  return { jrxml: r.jrxml, images: parse(r.images, []).map((img) => ({ name: img.name, buffer: Buffer.from(img.data, 'base64') })) };
};

/** Approves or rejects a UAT deploy that waits for review. Returns false when it no longer does. */
exports.review = async function (id, { approved, note, username }) {
  await schema();
  const r = await run(`UPDATE jasper_deploys SET status = ?, review_by = ?, review_at = datetime('now'), review_note = ?
                       WHERE id = ? AND status = 'uat'`, [approved ? 'approved' : 'rejected', username, note || '', id]);
  return r.changes > 0;
};

/** Marks an approved deploy as on Production. Returns false when it is not approved (any more). */
exports.markProduction = async function (id, { servers, hisCode, username, reportId }) {
  await schema();
  // reportId: the Report ID printed on Production ('' when none).
  const r = await run(`UPDATE jasper_deploys SET status = 'production', prod_servers = ?, prod_by = ?, prod_at = datetime('now'), his_code = ?,
                              prod_report_id = ?
                       WHERE id = ? AND status = 'approved'`, [JSON.stringify(servers), username, hisCode || '', reportId || '', id]);
  return r.changes > 0;
};

/** The latest deploy of each design: { [designId]: deploy }. */
exports.latest = async function () {
  await schema();
  const rows = await all(`SELECT d.id, d.design_id, d.name, d.folder, d.data_source, d.routepath, d.design_hash, d.status,
                                 d.uat_servers, d.uat_by, d.uat_at, d.review_by, d.review_at, d.review_note,
                                 d.prod_servers, d.prod_by, d.prod_at, d.his_code, d.report_id, d.prod_report_id
                            FROM jasper_deploys d
                            JOIN (SELECT MAX(id) AS id FROM jasper_deploys GROUP BY design_id) m ON m.id = d.id`);
  const out = {};
  rows.forEach((r) => { out[r.design_id] = view(r); });
  return out;
};
