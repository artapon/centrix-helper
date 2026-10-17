#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# pm2-agent/start.sh  -  Start the agent on Linux.
#              With PM2 available: registers it as a PM2 process and saves the
#              process list, so it comes back after a reboot (pm2 resurrect).
#              Otherwise: runs in the foreground with Node.js.
#
# The Windows counterpart is start.bat.
# -----------------------------------------------------------------------------
set -euo pipefail

AGENT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -t 1 ]; then
    CY=$'\033[36m'; GN=$'\033[32m'; YW=$'\033[33m'; RD=$'\033[31m'; BD=$'\033[1m'; RS=$'\033[0m'
else
    CY=''; GN=''; YW=''; RD=''; BD=''; RS=''
fi

die() { echo "${RD}[ERROR]${RS} $*" >&2; exit 1; }

echo
echo "${BD}${CY}pm2-agent — Start${RS}"
echo

command -v node >/dev/null 2>&1 || die "Node.js not found. Run install.sh first."

cd "$AGENT"
[ -f .env ]        || die ".env not found. Run install.sh first."
[ -d node_modules ] || die "Dependencies not installed. Run install.sh first."

# Read PORT and HOST from .env. `tr -d '\r'` matters: the folder is often copied from
# a Windows machine, and a trailing CR turns the port into an invalid PM2 app name.
AGENT_PORT="$(sed -n 's/^PORT=//p' .env | tr -d '\r' | head -1)"
AGENT_HOST="$(sed -n 's/^HOST=//p' .env | tr -d '\r' | head -1)"
AGENT_PORT="${AGENT_PORT:-7003}"
AGENT_HOST="${AGENT_HOST:-0.0.0.0}"
APP_NAME="pm2-agent:${AGENT_PORT}"

# -- PM2 branch ---------------------------------------------------------------
if command -v pm2 >/dev/null 2>&1; then
    echo "${CY}[INFO]${RS}  PM2 detected — starting as a PM2 process."
    echo

    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
        echo "${YW}[WARN]${RS}  Existing PM2 process '$APP_NAME' found — deleting..."
        pm2 delete "$APP_NAME" >/dev/null
    fi

    # --cwd pins the process to the agent folder so PM2 keeps it there across resurrects,
    # which is what makes the .env next to it load on every restart.
    pm2 start "$AGENT/src/app.js" \
        --name "$APP_NAME" \
        --cwd "$AGENT" \
        --log-date-format "YYYY-MM-DD HH:mm:ss" \
        --restart-delay 3000 \
        --max-restarts 10 || die "PM2 start failed. Check output above."

    pm2 save >/dev/null

    echo
    echo "${GN}[ OK ]${RS}  pm2-agent is running!"
    echo "  Health : ${BD}http://${AGENT_HOST}:${AGENT_PORT}/health${RS}"
    echo "  Logs   : ${BD}pm2 logs ${APP_NAME}${RS}"
    echo "  Status : ${BD}pm2 status${RS}"
    echo "  Stop   : ${BD}pm2 stop ${APP_NAME}${RS}"
    echo
    exit 0
fi

# -- Node fallback ------------------------------------------------------------
echo "${YW}[WARN]${RS}  PM2 not found — starting in foreground with Node.js."
echo "${CY}[INFO]${RS}  Press Ctrl-C to stop."
echo
exec node "$AGENT/src/app.js"
