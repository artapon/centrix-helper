const mongoose = require("mongoose");
let moment = require("moment-timezone");
exports.getDBStats = async function () {
  let stats = await mongoose.connection.db
  .stats()
  .then(function (res) {
    return res;
  })
  .catch(function (err) {
    console.log(err);
  });

  return stats;
}

exports.getDBVersion = async function () {
  let version = await mongoose.connection.db
  .command({ buildInfo: 1 })
  .then(function (res) {
    return res;
  })
  .catch(function (err) {
    console.log(err);
  });

  return version.version;
}

exports.getDBConnections = async function () {
  let projectedOps = [];
  try {
  const adminDb = mongoose.connection.db.admin();
  const currentOps = await adminDb.command({ currentOp: 1 });

  // Filter the operations
  const ops = currentOps.inprog.filter(op => {
    return op.active && op.secs_running > 5;
  });

  ops.sort((a, b) => {
    if (a.client < b.client) return -1;
    if (a.client > b.client) return 1;
    return 0;
  });

  projectedOps = ops.map(op => ({
    host: op.host || '',
    desc: op.desc || '',
    client: op.client || '',
    secs_running: op.secs_running || 0,
    appName: op.appName || '',
    app_driver_name: op.clientMetadata && op.clientMetadata.driver ? op.clientMetadata.driver.name || '' : '',
    app_driver_version: op.clientMetadata && op.clientMetadata.driver ? op.clientMetadata.driver.version || '' : '',
    app_driver_os_name: op.clientMetadata && op.clientMetadata.os ? op.clientMetadata.os.name || '' : '',
    app_platform_name: op.clientMetadata && op.clientMetadata.platform || '',
    app_platform_version: op.clientMetadata && op.clientMetadata.version || '',
    app_current_op_time: moment(op.currentOpTime).tz("Asia/Bangkok").format("DD/MM/YYYY HH:mm:ss")
  }));

  } catch (error) {
    console.error('Not authorized on admin to execute command');
    return null;
  }
  return projectedOps;
}

exports.getReplicaStatus = async function () {
  let status = [];
  try {
    const adminDb = mongoose.connection.db.admin();
    status = await adminDb.command({ replSetGetStatus: 1 });
  } catch (error) {
    console.error('Not authorized on admin to execute command');
    return null;
  }
  return status;
}

exports.getSlowQuery = async function () {
  let slowQueries = [];
  try {
    const adminDb = await mongoose.connection.db.admin().command({ getLog: 'global' });
    const logLines = adminDb.log; // Get the last 100 log lines

    // Regular expression to parse log lines
    const logRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.*)$/;

    // Parse the log entries
    const logEntries = logLines.map(line => {
      const match = line.match(logRegex);
      if (match) {
        return {
          timestamp: new Date(match[1]),
          message: match[2]
        };
      } else {
        return {
          timestamp: new Date(0), // Invalid date
          message: line
        };
      }
    });

    // Filter log entries to find slow queries and parse message to JSON
    const filter = it => it.message.includes('COMMAND') && /command.*aggregate/.test(it.message) && it.message.includes('duration') && parseInt(it.message.match(/duration.*?(\d+)/)[1]) >= 5000;
    const currentOps = await mongoose.connection.db.admin().command({ currentOp: 1, $all: true });


    
    let messageObj = null;



    slowQueries = logEntries.filter(filter).map(entry => {
  try {
    messageObj = JSON.parse(entry.message);
    if(messageObj.ctx == 'conn279228'){
      console.log(messageObj)
    }
    const connMatch = messageObj.ctx; // e.g. "conn266823"

    let connIpMap = null;

    if (currentOps.inprog) {
      connIpMap = currentOps.inprog.find(op => {
        return (
          op.conn === connMatch ||
          op.desc === connMatch ||
          op.connectionId === connMatch ||
          op.threadId === connMatch
        );
      });
    }

    return {
      timestamp: moment(messageObj.t.$date)
        .tz("Asia/Bangkok")
        .format("DD/MM/YYYY HH:mm:ss"),
      clientIP: connIpMap?.client || "",
      dbUser: connIpMap?.user || "",
      message: messageObj
    };
  } catch (error) {
    console.error("Failed to parse message to JSON:", error);
    return null;
  }
}).filter(entry => entry !== null);

    slowQueries.sort((a, b) => {
      const dateA = new Date(a.timestamp.split('/').reverse().join('-'));
      const dateB = new Date(b.timestamp.split('/').reverse().join('-'));
      return dateB - dateA;
    });

  } catch (error) {
    console.error('Not authorized on admin to execute command');
    return [];
  }

  return slowQueries;
}

exports.getConnectionsStatus = async function () {
  let connectionsStatus = {};
  try {
      const adminDb = mongoose.connection.db.admin();
      const serverStatus = await adminDb.command({ serverStatus: 1 });
      connectionsStatus = serverStatus.connections; // Extract connections data
  } catch (error) {
      console.error('Not authorized on admin to execute command', error);
      return [];
  }
  return connectionsStatus;
};

exports.getServerStatus = async function () {
  let serverStatus = {};
  try {
      const adminDb = mongoose.connection.db.admin();
      // Fetch the serverStatus information
      serverStatus = await adminDb.command({ serverStatus: 1 });
  } catch (error) {
      console.error('Not authorized on admin to execute command', error);
      return [];
  }
  return serverStatus;
};

exports.getRSConfig = async function () {
  let rsConfig = {};
  try {
      const adminDb = mongoose.connection.db.admin();
      const result = await adminDb.command({ replSetGetConfig: 1 });
      rsConfig = result.config; // Extract connections data
  } catch (error) {
      console.error('Not authorized on admin to execute command', error);
      return [];
  }
  return rsConfig;
};

exports.getServerInfo = async function () {
  let info = {};
  try {
    const adminDb = mongoose.connection.db.admin(); // Access the admin database
    info = await adminDb.command({ hostInfo: 1 }); // Execute the buildInfo command
  } catch (error) {
    console.error('Error fetching server information:', error.message);
    return []; // Return null in case of an error
  }
  return info; // Return the server information
};

