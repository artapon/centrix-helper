const os = require('os');
const sysinfo = require('../utils/sysinfo.util');
const { formatBytes } = require('../utils/format.util');
const { listApps, nodeInfo, pm2Available, transport } = require('../providers/pm2/api');
const config = require('../config');

const AGENT_VERSION = require('../../package.json').version;

// Identity of the machine this agent speaks for. A dashboard aggregating several agents
// uses this to label the server without needing anything configured on its own side.
const getAgentInfo = async (req, res) => {
    try {
        const [osInfo, cpuInfo, node, networks] = await Promise.all([
            sysinfo.osInfo(),
            sysinfo.cpuInfo(),
            nodeInfo(),
            sysinfo.networkInterfaces()
        ]);
        const network = networks.filter(n => n.default);

        res.json({
            success: true,
            data: {
                agent: {
                    name: config.AGENT_NAME,
                    version: AGENT_VERSION,
                    env: config.APP_ENV.toUpperCase(),
                    uptime: Math.floor(process.uptime()),
                    root: config.AGENT_ROOT,
                    platform: config.PLATFORM,
                    pm2Transport: transport()
                },
                host: {
                    hostname: osInfo.hostname,
                    platform: osInfo.platform,
                    distro: osInfo.distro,
                    release: osInfo.release,
                    arch: osInfo.arch,
                    isWindows: osInfo.platform.toLowerCase().includes('win'),
                    ip: network[0]?.ip4 || null,
                    cpu: `${cpuInfo.manufacturer} ${cpuInfo.brand}`,
                    cores: cpuInfo.cores,
                    totalMemory: os.totalmem()
                },
                node
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Same shape pm2-admin's own /api/system/info returns, so a caller can render a remote
// server with the code it already has for the local one.
const getServerInfo = async (req, res) => {
    try {
        let serverinfo = {};
        let isWindows = null;
        // nodeInfo joins the same batch rather than being awaited afterwards: it is cached
        // for the life of the process, but on the very first call it is a spawn, and there
        // is no reason to serialise it behind the system probes.
        const [probes, node] = await Promise.all([
            Promise.allSettled([
                sysinfo.currentLoad(),
                sysinfo.cpuInfo(),
                sysinfo.mem(),
                sysinfo.osInfo(),
                sysinfo.fsSize(),
                sysinfo.time(),
                sysinfo.networkInterfaces()
            ]),
            nodeInfo()
        ]);

        // A single failing WMI/sysfs probe must not take the whole endpoint down — report
        // what was collected and let the caller show the rest. allSettled makes that
        // per-probe instead of all-or-nothing, which is what the old try/catch really meant.
        const [cpu, cpuInfo, mem, osData, disk, time, networks] =
            probes.map(p => (p.status === 'fulfilled' ? p.value : null));

        const failed = probes.filter(p => p.status === 'rejected');
        if (failed.length) console.error('[agent] system info: ' + failed.map(p => p.reason.message).join('; '));

        if (osData) isWindows = osData.platform.toLowerCase().includes('win');
        const network = (networks || []).filter(n => n.default);

        serverinfo = {
            cpuInfo: cpuInfo ? `${cpuInfo.manufacturer} ${cpuInfo.brand} ${cpuInfo.speed} GHz ${cpuInfo.cores} cores.` : null,
            currentCPU: cpu ? cpu.currentLoad.toFixed(2) : null,
            memtotal: mem ? formatBytes(mem.total) : null,
            memfree: mem ? formatBytes(mem.free) : null,
            memused: mem ? formatBytes(mem.used) : null,
            memavailable: mem ? formatBytes(mem.available) : null,
            memPercent: mem ? (mem.used * 100 / mem.total).toFixed(2) : null,
            osinfo: osData
                ? `${osData.platform} ${osData.release} | Hostname : ${osData.hostname} | IP : ${network[0]?.ip4 || 'N/A'}`
                : null,
            disks: (disk || []).map(d => ({
                fs: d.fs,
                total: formatBytes(d.size || 0),
                used: formatBytes(d.used || 0),
                available: formatBytes(d.available || 0),
                percent: d.size ? (d.used * 100 / d.size).toFixed(2) : '0',
                mount: d.mount,
                type: d.type
            })),
            timeinfo: time ? new Date(time.current) + ' ' + time.timezoneName : null
        };

        res.json({
            success: true,
            data: { serverinfo, isWindows, agent: config.AGENT_NAME, node }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Cheap, poll-friendly subset of the above — this is the one meant for a timer.
const getSystemMonitor = async (req, res) => {
    try {
        const [cpu, cpuInfo, mem] = await Promise.all([
            sysinfo.currentLoad(),
            sysinfo.cpuInfo(),
            sysinfo.mem()
        ]);

        res.json({
            success: true,
            data: {
                cpu: {
                    usage: parseFloat(cpu.currentLoad.toFixed(2)),
                    cores: cpuInfo.cores,
                    model: `${cpuInfo.manufacturer} ${cpuInfo.brand}`
                },
                memory: {
                    total: mem.total,
                    used: mem.used,
                    free: mem.free,
                    percent: parseFloat((mem.used * 100 / mem.total).toFixed(2))
                },
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('[agent] system monitor error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Well-known ports, so a row without a PM2 app still says something useful.
const WELL_KNOWN_PORTS = {
    '21': 'FTP', '22': 'SSH', '23': 'Telnet', '25': 'SMTP', '53': 'DNS', '80': 'HTTP',
    '110': 'POP3', '135': 'Microsoft DCOM', '143': 'IMAP', '443': 'HTTPS',
    '445': 'SMB/Microsoft-DS', '1433': 'MSSQL', '1521': 'Oracle', '2179': 'Microsoft RDP',
    '2375': 'Docker API', '3306': 'MySQL', '3389': 'RDP', '5432': 'PostgreSQL',
    '6379': 'Redis', '8080': 'HTTP-Proxy/Tomcat', '8443': 'HTTPS-Alt', '27017': 'MongoDB'
};

// Ports declared in the PM2 process name, one or several:
//   'lis-interface-ui:8135'  /  'lis-interface-service:8198,8199'
// Every declared port maps back to the app — matching only the first one hides apps whose
// later port is the one actually bound.
const PORTS_IN_NAME = /:(\d[\d,]*)\s*$/;

const portsDeclaredBy = (apps) => {
    const portToApp = new Map();
    for (const app of apps) {
        const m = app.name.match(PORTS_IN_NAME);
        if (!m) continue;
        for (const port of m[1].split(',')) {
            if (port) portToApp.set(port, app);
        }
    }
    return portToApp;
};

// Mirrors pm2-admin's own /api/system/ports down to the `listPorts` key and row shape, so
// the dashboard renders a remote server with the component it already has for the local one.
const getListeningPorts = async (req, res) => {
    try {
        const [apps, connections, isWindows] = await Promise.all([
            listApps(),
            sysinfo.networkConnections(),
            sysinfo.isWindows()
        ]);

        const portToApp = portsDeclaredBy(apps);
        // Ports are compared as strings throughout: si reports localPort as a string, the
        // names declare them as text, and a Set mixing the two silently duplicates rows.
        const seenPorts = new Set();
        const listPorts = [];

        for (const conn of connections) {
            if (conn.state !== 'LISTEN' || !conn.protocol.startsWith('tcp')) continue;
            const localPort = String(conn.localPort);
            if (seenPorts.has(localPort)) continue;
            seenPorts.add(localPort);

            const app = portToApp.get(localPort);
            const num = parseInt(localPort, 10);
            let appName;
            if (app) appName = app.name;
            else if (isWindows && num >= 49152 && num <= 65535) appName = 'Microsoft Dynamic/Private Port';
            else if (isWindows && (num === 8443 || num === 8080)) appName = 'Mirth Connect / Tomcat Services';
            else appName = WELL_KNOWN_PORTS[localPort] || '-';

            listPorts.push({
                protocol: conn.protocol.toUpperCase(),
                localPort: conn.localPort,
                localAddress: conn.localAddress,
                peerAddress: conn.peerAddress || '*',
                state: conn.state,
                appName,
                isPM2Service: Boolean(app),
                status: app ? app.status : null,
                listening: true
            });
        }

        // A stopped app holds no socket, so it is absent from the connection list entirely.
        // Add a row for every declared port with nothing bound to it — that covers stopped
        // apps and also an online app whose port failed to bind.
        for (const [port, app] of portToApp) {
            if (seenPorts.has(port)) continue;
            seenPorts.add(port);
            listPorts.push({
                protocol: 'TCP',
                localPort: port,
                localAddress: '-',
                peerAddress: '*',
                state: 'NOT LISTENING',
                appName: app.name,
                isPM2Service: true,
                status: app.status,
                listening: false
            });
        }

        listPorts.sort((a, b) => parseInt(a.localPort, 10) - parseInt(b.localPort, 10));

        res.json({ success: true, data: { listPorts, isWindows } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getTopProcesses = async (req, res) => {
    try {
        const { list } = await sysinfo.processes();
        const limit = config.DEFAULTS.TOP_PROCESSES;

        // A full process table is thousands of entries. Sorting it to keep the top hundred
        // throws away almost all of that work, so select the top N with a bounded insertion
        // pass instead: one scan, at most `limit` entries held, no copy of the whole table.
        const top = [];
        for (const proc of list) {
            const cpu = proc.cpu || 0;
            if (top.length === limit && cpu <= top[top.length - 1].cpu) continue;
            let i = top.length;
            while (i > 0 && top[i - 1].cpu < cpu) i--;
            top.splice(i, 0, proc);
            if (top.length > limit) top.pop();
        }

        res.json({
            success: true,
            data: {
                processes: top.map(proc => ({
                    pid: proc.pid,
                    name: proc.name,
                    cpu: parseFloat((proc.cpu || 0).toFixed(2)),
                    memory: (proc.memRss || 0) * 1024,
                    memoryPercent: parseFloat((proc.mem || 0).toFixed(2))
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Unauthenticated liveness probe — deliberately says nothing about the machine beyond
// whether the agent answers and whether PM2 is reachable from it. It must stay cheap:
// this is the one endpoint anyone who can open a socket may call.
const getHealth = async (req, res) => {
    const pm2 = await pm2Available();
    res.json({
        success: true,
        data: {
            status: 'ok',
            agent: config.AGENT_NAME,
            pm2,
            uptime: Math.floor(process.uptime()),
            timestamp: Date.now()
        }
    });
};

module.exports = {
    getAgentInfo,
    getServerInfo,
    getSystemMonitor,
    getListeningPorts,
    getTopProcesses,
    getHealth
};
