#!/bin/bash
# Install agent-im as a macOS launchd agent (auto-start on login)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_NAME="com.agent-im.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
AGENT_IM_HOME="${AGENT_IM_HOME:-$HOME/.agent-im}"
LOG_DIR="$AGENT_IM_HOME/logs"
NODE_BIN=$(which node)

# Ensure built
if [ ! -f "$SCRIPT_DIR/dist/main.js" ]; then
  echo "Error: dist/main.js not found. Run 'npm run build' first."
  exit 1
fi

mkdir -p "$AGENT_IM_HOME/logs" "$HOME/Library/LaunchAgents"

# Unload existing if present
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT_DIR}/dist/main.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/daemon.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_IM_HOME</key>
    <string>${AGENT_IM_HOME}</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:$(dirname "$NODE_BIN")</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
EOF

# Load the agent
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo "agent-im daemon installed as launchd agent"
echo "  Plist: $PLIST_PATH"
echo "  Logs:  $LOG_DIR/daemon.log"
echo ""
echo "Commands:"
echo "  launchctl kickstart gui/$(id -u)/${PLIST_NAME}  # force restart"
echo "  launchctl bootout gui/$(id -u)/${PLIST_NAME}    # stop + remove"
echo "  tail -f $LOG_DIR/daemon.log                      # view logs"
echo ""
echo "The daemon will auto-start on login and restart on crash."
