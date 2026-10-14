const dbConnectionsModel = require('../../setting/models/dbconnections.model');
const monitorModel = require('../models/monitor.model');
const view = require('../../../core/view')('monitor');

exports.index = async function (req, res) {
  const site_index = req.session.site_index;
  const [connections, data] = await Promise.all([
    dbConnectionsModel.listForPicker(),
    // Today's login sessions moved to the Overview, so this page skips that query.
    site_index ? monitorModel.collect({ slackBackupLogs: true, loginSessions: false }) : null
  ]);

  return res.renderPage(view('dbmonitor'), {
    title: 'DB Monitor',
    connections: connections,
    dberror: req.query.dberror || '',
    sitename: req.query.sitename || '',
    site_index: site_index,
    text: "",
    stats: {},
    replicaStatusMembers: [],
    connectionApps: [],
    slowQueries: [],
    connectionStatus: { remaining: 0, remainingF: "", current: 0, available: 0, active: 0, exhaustIsMaster: 0 },
    replicaStatus: '',
    rsConfig: { members: [] },
    serverInfo: null,
    serverStatus: null,
    slackBackupLogs: [],
    ...data
  });
};
