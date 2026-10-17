# pm2-agent

A small Express service that exposes one server's **PM2 processes and system metrics** as
JSON web services, so pm2-admin (or anything else) can pull data from a machine it is not
running on.

Reads are the point; the PM2 actions the dashboard offers for its own machine
(reload/restart/stop/reset/delete/flush and `.env` editing) are also available here, and can
be switched off entirely with `AGENT_ALLOW_ACTIONS=false`.

**Runs on Windows Server and on Linux**, from the same source. Only the installer differs.

## How it fits together

```
  pm2-admin  ──HTTP(S) + token──▶  pm2-agent (server B)  ──RPC socket──▶  PM2 daemon
  (server A)                                             ──systeminformation──▶  OS
```

The agent talks to PM2 over the daemon's own RPC socket rather than spawning `pm2 jlist` per
request — the difference between a few milliseconds and a full Node start-up on every poll.
If the pm2 module cannot be found it falls back to the CLI automatically; see
`AGENT_PM2_MODE` below.

One agent per monitored server. It is self-contained — copy the `pm2-agent` folder to the
target machine and run the installer there; it does not need the rest of the pm2-admin repo.

## Install (Windows)

```bat
:: on the server you want to monitor
cd pm2-agent
install.bat
```

`install.bat` checks Node.js v16+, installs PM2 globally if missing, creates `.env` from
`.env.example` with a freshly generated `AGENT_TOKEN`, runs `npm install`, and offers to
register the agent with PM2 (`pm2 start` + `pm2 save`, so it survives a reboot via
`pm2 resurrect`). It prints the token — that is the value pm2-admin needs.

Re-running it is safe: an existing `.env` is kept and an existing token is never rotated.

Then, on the target machine:

```bat
:: open the port (run as Administrator)
netsh advfirewall firewall add rule name="pm2-agent" dir=in action=allow protocol=TCP localport=7003
```

`start.bat` restarts the agent later (PM2 process if PM2 is present, foreground Node.js
otherwise).

## Install (Linux)

```bash
# on the server you want to monitor
cd pm2-agent
chmod +x install.sh start.sh
./install.sh
```

`install.sh` does the same steps in the same order as `install.bat`, plus `chmod 600 .env`
(the file holds the shared secret, and a Linux box is more likely to have other users on
it). It installs production dependencies only.

Then open the port:

```bash
sudo ufw allow 7003/tcp                                     # Debian / Ubuntu
sudo firewall-cmd --permanent --add-port=7003/tcp && sudo firewall-cmd --reload   # RHEL / Rocky
```

To survive a reboot, run the command `pm2 startup` prints (it needs root, so the installer
shows it rather than running it), then `pm2 save`.

`start.sh` restarts the agent later, exactly like `start.bat` on Windows.

## Adding the agent to pm2-admin

In the dashboard, open **Environments** in the sidebar and press **Add Environment**. Enter a
name, the agent URL (`http://<server>:7003`), and the `AGENT_TOKEN` the installer printed;
**Test Connection** verifies both the address and the token before you save. Managing
environments is root-only — the entry holds a credential — but every signed-in user can then
open a server and read its apps, logs, ports and system metrics.

The token is stored encrypted in the dashboard's SQLite database and is never sent back to
the browser: to change it, type a new one; leave the field blank to keep the stored one.

## Configuration (`.env`)

| Key | Default | Meaning |
| --- | --- | --- |
| `AGENT_NAME` | machine hostname | Label reported to the dashboard |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `7003` | HTTP port |
| `AGENT_TOKEN` | *(generated)* | Shared secret required on every `/api` call |
| `AGENT_ALLOWED_IPS` | *(empty)* | Comma-separated caller allowlist; empty = any IP |
| `AGENT_ALLOW_ACTIONS` | `true` | `false` makes the agent strictly read-only |
| `APP_ENV` | `Production` | Environment label reported with each app |
| `APP_HTTP_MODE` | `HTTP` | `HTTPS` serves TLS using `CERT_KEY` / `CERT_PATH` |

The agent **refuses to start** without an `AGENT_TOKEN` of at least 16 characters — an open
agent would hand every app name, log line and system metric to anyone who can reach the port.

### Performance settings

All optional — the defaults are tuned for a dashboard polling every few seconds.

| Key | Default | Meaning |
| --- | --- | --- |
| `AGENT_PM2_MODE` | `auto` | `api` (PM2 RPC socket), `cli` (`pm2 jlist` per read), or `auto` |
| `PM2_MODULE_PATH` | *(auto-detected)* | Where the pm2 package lives, for unusual install layouts |
| `AGENT_COMPRESSION` | `true` | gzip responses over the threshold below |
| `AGENT_COMPRESS_MIN_BYTES` | `1024` | Bodies smaller than this are sent uncompressed |
| `AGENT_CACHE_PM2_MS` | `1000` | How long a PM2 listing stays fresh |
| `AGENT_CACHE_PM2_STALE_MS` | `8000` | How long a stale listing may be served while it refreshes |
| `AGENT_CACHE_PM2_PATHS_MS` | `30000` | Lifetime of the app log-path index |
| `AGENT_CACHE_LOAD_MS` | `2000` | CPU load sample |
| `AGENT_CACHE_PORTS_MS` | `5000` | Listening socket table |
| `AGENT_CACHE_PROCESSES_MS` | `5000` | Full process table — the most expensive probe |
| `AGENT_CACHE_DESCRIBE_MS` | `3000` | `pm2 describe` output |
| `AGENT_TOP_PROCESSES` | `100` | Rows returned by `/api/system/processes` |

`AGENT_PM2_MODE=auto` finds the pm2 package via a local dependency, `PM2_MODULE_PATH`,
`npm_config_prefix`, the usual global prefixes, and finally by resolving the `pm2` on `PATH`
— which covers nvm, fnm, Volta and a plain `npm i -g` on either platform. Loading it costs
about 7 MB of RSS and removes a ~40 MB child process from every single read; `cli` opts out
on a memory-tight box.

## Authentication

Every `/api/*` request needs the token, in either header:

```
Authorization: Bearer <AGENT_TOKEN>
X-Agent-Token: <AGENT_TOKEN>
```

The token is compared in constant time. `AGENT_ALLOWED_IPS`, when set, is checked first and
answers `403` before the token is even looked at.

The token travels in a header, so on any untrusted network run the agent with
`APP_HTTP_MODE=HTTPS` or put it behind a TLS-terminating proxy. The agent deliberately does
**not** trust `X-Forwarded-For` (that would let a caller spoof its way past the IP
allowlist), so a proxy in front of it must enforce the IP restriction itself.

There is no CORS header: the agent is meant to be called server-to-server by pm2-admin, not
from a browser, where the token would be exposed to anyone loading the page.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | Liveness — no token needed, no machine details. Says whether PM2 answers. |
| GET | `/api/info` | Agent + host identity: name, version, OS, CPU, IP, Node version |
| GET | `/api/apps` | All PM2 apps, plus online/stopped/errored counts |
| GET | `/api/apps/:appName` | One app's detail (status, cpu, memory, paths, node version) |
| GET | `/api/apps/:appName/describe` | `pm2 describe` output as text, ANSI stripped |
| GET | `/api/apps/:appName/logs/:logType` | `stdout` or `stderr` tail; page back with `?nextKey=` |
| GET | `/api/apps/:appName/env` | The app's `.env` — resolved path, contents and `.env.backup` |
| POST | `/api/apps/:appName/env` | Replaces that `.env` with `env_content`, backing up the old one first |
| POST | `/api/apps/:appName/reload` | `pm2 reload` |
| POST | `/api/apps/:appName/restart` | `pm2 restart` |
| POST | `/api/apps/:appName/stop` | `pm2 stop` |
| POST | `/api/apps/:appName/reset` | `pm2 reset` — zeroes restart count and uptime |
| POST | `/api/apps/:appName/flush` | `pm2 flush` — truncates the app's log files |
| DELETE | `/api/apps/:appName` | `pm2 delete` — removes the process |
| GET | `/api/system/info` | Full system snapshot (CPU, memory, disks, OS, time) |
| GET | `/api/system/monitor` | Cheap CPU/memory sample — the one meant for polling |
| GET | `/api/system/ports` | Listening TCP ports, mapped to the PM2 app that declares them |
| GET | `/api/system/processes` | Top 100 processes by CPU |

The mutating endpoints are gated by `AGENT_ALLOW_ACTIONS` (default `true`). Set it to
`false` for a strictly read-only agent — every one of them then answers `403` without
touching PM2.

The `.env` endpoints deserve their own note: the file usually holds database passwords and
API keys, so the read is as sensitive as a write (pm2-admin restricts both to `root` users).
The write takes the whole file as `env_content` (max 64 KB, JSON body) and stores it
verbatim — comments, blank lines and key order survive — after copying the previous contents
to `<file>.backup`. The running process keeps its old values until it is restarted.

`:appName` accepts a PM2 name or a `pm_id`, and is validated against the same pattern
pm2-admin uses (`A-Z a-z 0-9 _ . , : -`, max 128) before it reaches the CLI.

Every response is `{ "success": true, "data": { … } }`, or
`{ "success": false, "error": "…" }` with a `400` / `401` / `403` / `404` / `429` / `500`
status. The app and system payloads use the same field names as pm2-admin's own API, so a
caller can render a remote server with the code it already has for the local one.

### Example

```bash
curl -H "X-Agent-Token: $AGENT_TOKEN" http://server-b:7003/api/apps
```

```json
{
  "success": true,
  "data": {
    "apps": [
      { "name": "lis-interface-ui:8135", "status": "online", "cpu": 0,
        "memory": "84mb ", "uptime": "20 hrs", "pm_id": 4, "restarts": 0,
        "node_args": ["--no-deprecation"], "env": "PRODUCTION" }
    ],
    "node": { "node": "v18.20.0" },
    "counts": { "stopped": 0, "online": 6, "errored": 0, "total": 6 }
  }
}
```

## Rate limits

Reads are capped at 240/min per IP, actions at 30/min, and `/api/system/processes` (a full
process-table walk) at 60/min. The limits bound how much *work* a caller can cause, not how
many responses it can read: every expensive result is cached, so a burst inside one cache
window costs JSON serialisation and nothing else.

## What the agent does to stay cheap

The machine being monitored is somebody's production server, so the agent is built to cost
as little of it as possible.

- **PM2 over its RPC socket, not the CLI.** A `pm2 jlist` spawn is a whole Node start-up:
  measured here at 244-289 ms and ~40 MB per call. The same listing over the daemon's socket
  takes 4 ms and spawns nothing.
- **One PM2 read shared by everything.** Concurrent callers join one in-flight read; within
  the stale window a poll gets the last value immediately and the refresh happens behind it,
  so a request never waits on PM2.
- **A log tail costs no PM2 read at all.** Log paths cannot change while a process lives, so
  they are indexed separately from the (deliberately short-lived) process listing. A live
  tail polling every 3 s makes zero PM2 calls — measured: 0 over a 10-poll tail, against 10
  when the same tail goes through a full describe.
- **Listings are projected before they are cached.** PM2 returns each app's entire
  environment; the agent keeps only the ~15 fields any endpoint reads, so the cache holds
  hundreds of bytes per app rather than tens of kilobytes.
- **Every system probe is cached** with a TTL matched to how fast the value can really
  change. This is where the Windows win comes from — `si.processes()` costs 1.2 s and
  `si.currentLoad()` 0.5 s per call there.
- **Responses are gzipped** above 1 KB. Port and process listings compress about 10x
  (7 252 B → 670 B, 8 712 B → 2 194 B measured), which is what matters when pm2-admin polls
  across a WAN. Small bodies — `/health`, the monitor poll — skip it.
- **Connections are reused.** Keep-alive is held for 65 s and TLS sessions for 5 minutes, so
  a dashboard polling every few seconds reuses one socket instead of re-handshaking.
- **Nothing blocks the event loop.** Log tails, `.env` reads and writes all use async I/O,
  and a response large enough to be worth compressing is compressed on the threadpool.

Steady state on a 7-app box: `/api/apps` 2.3 ms/request, a log tail 5.1 ms/request, ~75 MB
RSS.

## Platform notes

The same source runs on both platforms; `install.bat`/`start.bat` and `install.sh`/`start.sh`
are the only files that differ.

- **PM2 discovery** handles a `.cmd` shim on Windows and a `bin/pm2` symlink on Linux.
- **Command fallbacks** go through `cmd.exe /c` on Windows (a `.cmd` shim cannot be
  `execFile`d directly) and exec the binary directly on Linux — no shell either way, so
  there is nothing to escape.
- **`si.powerShellStart()` is deliberately not used.** Piping WMI queries through one
  long-lived PowerShell child is the obvious Windows optimisation, but measured on
  systeminformation 5.33 it saves nothing (currentLoad 517 ms with it vs 511 ms without) and
  `si.processes()` never returns under it.
- **Signals**: `SIGINT`/`SIGTERM`/`SIGHUP` all trigger a graceful shutdown that stops
  accepting connections, lets in-flight requests finish and closes the PM2 socket. Windows
  only delivers `SIGINT`, which is what PM2 sends there.
