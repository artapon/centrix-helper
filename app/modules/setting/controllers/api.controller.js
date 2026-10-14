const axios = require('axios');
const settingsModel = require("../models/setting.model");
const logModel = require("../../logs/models/log.model");
const numberHelpers = require("../../../core/helpers/number");

/**
 * Fetches version data from the specified URL.
 * @param {string} url - The base URL to fetch version data from.
 * @returns {Promise<Object|null>} - The version data object or null if an error occurs.
 */
async function fetchVersionData(url) {
  try {
    const response = await axios.get(`${url}/version`, { timeout: 5000 });
    return response.data;
  } catch (error) {
    console.error('Error fetching version data:', error.message);
    return null;
  }
}

/**
 * Retrieves and formats database statistics.
 * @returns {Promise<Object>} - Formatted database statistics.
 */
async function getDatabaseStats() {
  const stats = await settingsModel.getDBStats();
  return {
    ...stats,
    db_version: await settingsModel.getDBVersion(),
    avgObjSize: numberHelpers.formatBytes(stats.avgObjSize),
    dataSize: numberHelpers.formatBytes(stats.dataSize),
    storageSize: numberHelpers.formatBytes(stats.storageSize),
    indexSize: numberHelpers.formatBytes(stats.indexSize),
    totalSize: numberHelpers.formatBytes(stats.totalSize),
    fsUsedSize: numberHelpers.formatBytes(stats.fsUsedSize),
    fsTotalSize: numberHelpers.formatBytes(stats.fsTotalSize),
  };
}

/**
 * Retrieves and formats connection status.
 * @returns {Promise<Object|null>} - Formatted connection status or null if no status is available.
 */
async function getConnectionStatus() {
  const status = await settingsModel.getConnectionsStatus();
  if (!status) return null;

  return {
    ...status,
    remaining: status.current && status.available ? (parseInt(status.available) - parseInt(status.current)) : "",
    remainingF: status.current && status.available ? (parseInt(status.available) - parseInt(status.current)).toLocaleString() : "",
    current: status.current ? status.current.toLocaleString() : "",
    available: status.available ? status.available.toLocaleString() : "",
  };
}

/**
 * Retrieves replica status members.
 * @returns {Promise<Array|null>} - An array of replica status members or null if no status is available.
 */
async function getReplicaStatusMembers() {
  const replicaStatus = await settingsModel.getReplicaStatus();
  return replicaStatus ? replicaStatus.members : null;
}

/**
 * Get database statistics and related data.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 */
exports.getStats = async function (req, res) {
  const site_index = req.session.site_index;

  if (!site_index) {
    return res.status(400).json({
      error: 'Site index is required.',
    });
  }

  const url = req.session.centrixURL || 'http://127.0.0.1:8080';

  try {
    const [versionData, stats, connectionStatus, connectionApps, replicaStatusMembers, slowQueries, activeLoginSessions] = await Promise.all([
      fetchVersionData(url),
      getDatabaseStats(),
      getConnectionStatus(),
      settingsModel.getDBConnections(),
      getReplicaStatusMembers(),
      settingsModel.getSlowQuery(),
      logModel.getTodayActiveSession(),
    ]);

    res.json({
      title: 'DB Info',
      stats,
      activeLoginSessions,
      countLoginSessions: activeLoginSessions ? activeLoginSessions.length : 0,
      replicaStatusMembers: replicaStatusMembers || [],
      connectionApps,
      slowQueries,
      connectionStatus: connectionStatus || {},
      versionData,
    });
  } catch (error) {
    console.error('Error in getStats function:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Exports all active login sessions to an Excel file.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 */
exports.exportAllActiveSessions = async function (req, res) {
  try {
    const allLoginSessions = await logModel.exportAllActiveSessions();
    res.xls('all_login_sessions.xlsx', allLoginSessions);
  } catch (error) {
    console.error('Error exporting active sessions:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};