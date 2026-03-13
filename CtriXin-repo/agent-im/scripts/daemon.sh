#!/bin/bash
# agent-im daemon manager: start | stop | status | logs
set -euo pipefail

AGENT_IM_HOME="${AGENT_IM_HOME:-$HOME/.agent-im}"
PID_FILE="$AGENT_IM_HOME/daemon.pid"
LOG_FILE="$AGENT_IM_HOME/logs/daemon.log"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cmd="${1:-status}"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "$cmd" in
  init)
    # Create directory structure and copy example config
    mkdir -p "$AGENT_IM_HOME"/{data,logs,runtime}
    if [ ! -f "$AGENT_IM_HOME/config.env" ]; then
      cp "$SCRIPT_DIR/config.env.example" "$AGENT_IM_HOME/config.env"
      chmod 600 "$AGENT_IM_HOME/config.env"
      echo "Created $AGENT_IM_HOME/config.env — edit it with your Discord bot token and hub channel ID"
    else
      echo "Config already exists at $AGENT_IM_HOME/config.env"
    fi
    echo "Directory structure ready at $AGENT_IM_HOME"
    ;;
  start)
    if is_running; then
      echo "agent-im daemon already running (PID: $(cat "$PID_FILE"))"
      exit 0
    fi
    # Ensure directories exist
    mkdir -p "$AGENT_IM_HOME"/{data,logs,runtime}
    echo "Starting agent-im daemon..."
    nohup node "$SCRIPT_DIR/dist/main.js" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if is_running; then
      echo "agent-im daemon started (PID: $(cat "$PID_FILE"))"
    else
      echo "Failed to start. Check logs: $LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;
  stop)
    if ! is_running; then
      echo "agent-im daemon not running"
      rm -f "$PID_FILE"
      exit 0
    fi
    PID=$(cat "$PID_FILE")
    echo "Stopping agent-im daemon (PID: $PID)..."
    kill "$PID" 2>/dev/null || true
    # Wait up to 5 seconds for graceful shutdown
    for i in $(seq 1 10); do
      if ! kill -0 "$PID" 2>/dev/null; then break; fi
      sleep 0.5
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "Force killing..."
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "Stopped."
    ;;
  status)
    if is_running; then
      PID=$(cat "$PID_FILE")
      echo "agent-im daemon running (PID: $PID)"
      # Show socket status
      SOCK="$AGENT_IM_HOME/agent-im.sock"
      [ -S "$SOCK" ] && echo "IPC socket: $SOCK ✓" || echo "IPC socket: missing ✗"
    else
      echo "agent-im daemon not running"
      [ -f "$PID_FILE" ] && echo "(stale PID file exists)" && rm -f "$PID_FILE"
    fi
    ;;
  logs)
    N="${2:-50}"
    if [ -f "$LOG_FILE" ]; then
      tail -n "$N" "$LOG_FILE"
    else
      echo "No log file found at $LOG_FILE"
    fi
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  *)
    echo "Usage: $0 {init|start|stop|status|logs [N]|restart}"
    exit 1
    ;;
esac
