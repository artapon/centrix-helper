#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# pm2-agent/install.sh  -  Install the agent on a Linux server that pm2-admin polls.
#                         Copy the whole pm2-agent folder to the target machine
#                         and run this file there.
#
# The Windows counterpart is install.bat; the two do the same steps in the same
# order, so an operator who knows one can follow the other.
# -----------------------------------------------------------------------------
set -euo pipefail

AGENT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colours only when stdout is a terminal — otherwise the escape codes end up in
# whatever log the installer was piped into.
if [ -t 1 ]; then
    CY=$'\033[36m'; GN=$'\033[32m'; YW=$'\033[33m'; RD=$'\033[31m'; BD=$'\033[1m'; RS=$'\033[0m'
else
    CY=''; GN=''; YW=''; RD=''; BD=''; RS=''
fi

ok()   { echo "${GN}[ OK ]${RS}  $*"; }
info() { echo "${CY}[INFO]${RS}  $*"; }
warn() { echo "${YW}[WARN]${RS}  $*"; }
die()  { echo "${RD}[ERROR]${RS} $*" >&2; exit 1; }

echo
echo "${BD}${CY}pm2-agent — Install${RS}"
echo

# -- 1. Node.js ---------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js not found. Install v16+ (https://nodejs.org or your distro's nodesource package)."

NODE_MAJOR="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 16 ] || die "Node.js v16+ required. Found: $(node -v)"
ok "Node.js $(node -v)"

# -- 2. PM2 -------------------------------------------------------------------
# The agent reads PM2 through its module or CLI, so PM2 must be present even before
# the agent is registered as a PM2 process itself.
if ! command -v pm2 >/dev/null 2>&1; then
    warn "PM2 not found. Installing globally..."
    # A root-owned global prefix is the usual reason `npm i -g` fails for a normal
    # user; say so rather than letting npm's EACCES stack trace speak for itself.
    npm install -g pm2 || die "PM2 install failed. If this was a permissions error, run it under sudo or point npm at a user-writable prefix (npm config set prefix ~/.npm-global)."
fi
ok "PM2 $(pm2 -v 2>/dev/null | tail -1)"

# The config comes first: a failed npm install must not leave the agent without a .env,
# or start.sh refuses to run and the fix is not obvious.
# -- 3. Environment file + agent token ----------------------------------------
echo
echo "${CY}Configuring environment...${RS}"
cd "$AGENT"
node "$AGENT/scripts/setup-env.js" || die "Could not create .env."

# .env holds the shared secret. Anything wider than owner-only is a mistake on a
# multi-user box, and there is no Windows equivalent of this step.
chmod 600 "$AGENT/.env" 2>/dev/null || true

# -- 4. Dependencies ----------------------------------------------------------
echo
echo "${CY}Installing dependencies...${RS}"
# --omit=dev on npm 8+, --production on npm 6/7: the agent has no dev dependencies
# either way, but this keeps a stray one from landing on a production server.
npm install --omit=dev 2>/dev/null || npm install --production || die "npm install failed."
ok "Dependencies installed."

# -- 5. Read back the port for the hints below --------------------------------
AGENT_PORT="$(sed -n 's/^PORT=//p' "$AGENT/.env" | tr -d '\r' | head -1)"
AGENT_PORT="${AGENT_PORT:-7003}"

# -- 6. Register with PM2 -----------------------------------------------------
echo
read -r -p "Start the agent under PM2 now? [Y/n]: " START_NOW || START_NOW=""
case "${START_NOW,,}" in
    n|no) ;;
    *)
        bash "$AGENT/start.sh" || die "Agent failed to start. See the output above."
        echo
        # `pm2 startup` prints a command that must be run as root to install the boot
        # unit. Printing it rather than running it keeps the installer from needing
        # sudo for everything else.
        info "To bring the agent back after a reboot, run the command ${BD}pm2 startup${RS}${CY} prints,${RS}"
        info "then ${BD}pm2 save${RS}${CY} once more.${RS}"
        ;;
esac

echo
echo "${GN}Installation complete!${RS}"
echo
echo "  Next steps:"
echo "  1. Allow the port through the firewall:"
echo "     ${BD}sudo ufw allow ${AGENT_PORT}/tcp${RS}                      # Debian/Ubuntu"
echo "     ${BD}sudo firewall-cmd --permanent --add-port=${AGENT_PORT}/tcp && sudo firewall-cmd --reload${RS}   # RHEL/Rocky"
echo "  2. Restrict who may call it — set ${BD}AGENT_ALLOWED_IPS${RS} in ${BD}.env${RS} to the pm2-admin server IP."
echo "  3. In pm2-admin, add this server with its address, port and the AGENT_TOKEN above."
echo
echo "  Verify from the pm2-admin machine:"
echo "    ${BD}curl http://<this-server>:${AGENT_PORT}/health${RS}"
echo
