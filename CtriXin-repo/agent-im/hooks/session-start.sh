#!/bin/bash
# Claude Code SessionStart hook — register CLI session with agent-im daemon
# Stdin: JSON with session_id, cwd, etc.
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
[ ! -S "$SOCK" ] && exit 0  # daemon not running, skip silently

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && CWD="$PWD"

# Use PPID (Claude Code process) not $$ (this hook script, which exits immediately)
PID=$PPID
echo "[session-start] SESSION_ID=$SESSION_ID PID=$PID CWD=$CWD" >> "$HOME/.agent-im/logs/hooks.log" 2>/dev/null || true
BRANCH=$(cd "$CWD" 2>/dev/null && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "none")
PROJECT=$(basename "$CWD")

# Fire-and-forget registration — compact JSON on single line
printf '{"type":"register","sessionId":"%s","cwd":"%s","pid":%d,"project":"%s","branch":"%s","agent":"claude"}\n' \
  "$SESSION_ID" "$CWD" "$PID" "$PROJECT" "$BRANCH" \
  | nc -U "$SOCK" -w 1 2>/dev/null || true

exit 0
