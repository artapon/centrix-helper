const settingsModel = require("../../setting/models/setting.model");
const logModel = require("../../logs/models/log.model");
const numberHelpers = require("../../../core/helpers/number");

const SIZE_FIELDS = ['avgObjSize', 'dataSize', 'storageSize', 'indexSize', 'totalSize', 'fsUsedSize', 'fsTotalSize'];

/**
 * Everything the DB Monitor page and /api/database/monitor show. The server commands and
 * queries are independent, so they run in parallel; the page load is the slowest one
 * rather than the sum. Pass { slackBackupLogs: true } to include the Slack backup feed.
 */
exports.collect = async function ({ slackBackupLogs: withSlack = false, loginSessions: withLogins = true } = {}) {
  let [
    stats, connectionStatus, connectionApps, replicaStatus, rsConfig,
    serverInfo, serverStatus, slowQueries, dbVersion, activeLoginSessions, slackLogs
  ] = await Promise.all([
    settingsModel.getDBStats(),
    settingsModel.getConnectionsStatus(),
    settingsModel.getDBConnections(),
    settingsModel.getReplicaStatus(),
    settingsModel.getRSConfig(),
    settingsModel.getServerInfo(),
    settingsModel.getServerStatus(),
    settingsModel.getSlowQuery(),
    settingsModel.getDBVersion(),
    withLogins ? logModel.getTodayActiveSession() : [],
    // The Slack feed is an external call; a Slack outage should not break the page.
    withSlack ? logModel.getSlackBackupLogs().catch((err) => { console.error('Slack backup logs:', err.message); return null; }) : null
  ]);

  stats = stats || {};
  stats.db_version = dbVersion;
  // Raw byte counts for usage bars (the named fields below become display strings).
  stats.raw = {};
  SIZE_FIELDS.forEach((field) => { stats.raw[field] = Number(stats[field]) || 0; });
  SIZE_FIELDS.forEach((field) => { stats[field] = numberHelpers.formatBytes(stats[field]); });

  if (connectionStatus) {
    const remaining = connectionStatus.current && connectionStatus.available
      ? parseInt(connectionStatus.available) - parseInt(connectionStatus.current)
      : "";
    connectionStatus.remaining = remaining;
    connectionStatus.remainingF = remaining === "" ? "" : remaining.toLocaleString();
    connectionStatus.current = connectionStatus.current ? connectionStatus.current.toLocaleString() : "";
    connectionStatus.available = connectionStatus.available ? connectionStatus.available.toLocaleString() : "";
  }

  const result = {
    stats,
    connectionStatus,
    connectionApps,
    replicaStatus: replicaStatus ? replicaStatus : '',
    replicaStatusMembers: (replicaStatus && replicaStatus.members) || [],
    rsConfig,
    serverInfo,
    serverStatus,
    slowQueries,
    activeLoginSessions
  };

  if (withSlack) {
    result.slackBackupLogs = ((slackLogs && slackLogs.messages) || [])
      .filter((item) => item.text && item.text.includes('MongoDB'))
      .map((item) => ({
        ...item,
        formattedDate: new Date(parseFloat(item.ts) * 1000).toLocaleString('en-GB', { hour12: false }) // dd/mm/yyyy, hh:mm:ss
      }));
  }
  return result;
};
