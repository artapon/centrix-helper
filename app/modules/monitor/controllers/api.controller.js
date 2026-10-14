const dbConnectionsModel = require('../../setting/models/dbconnections.model');
const monitorModel = require('../models/monitor.model');

exports.index = async function (req, res) {
  try {
    const site_index = req.session.site_index;
    const [connections, data] = await Promise.all([
      dbConnectionsModel.listForPicker(),
      site_index ? monitorModel.collect() : null
    ]);
    const activeLoginSessions = data ? data.activeLoginSessions : [];

    return res.json({
      title: 'DB Monitor',
      loginUser: req.auth.user,
      connections,
      dberror: req.query.dberror || '',
      sitename: req.query.sitename || '',
      site_index,
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
      ...data,
      activeLoginSessions,
      activeLoginSessionsStr: JSON.stringify(activeLoginSessions),
      countLoginSessions: activeLoginSessions ? activeLoginSessions.length : 0
    });
  } catch (error) {
    console.error('Error in index API:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
