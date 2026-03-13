#!/bin/bash
# Claude Code Notification hook — forward events to agent-im daemon
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
[ ! -S "$SOCK" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

# Forward the full notification payload as an event
printf '{"type":"event","sessionId":"%s","event":"notification","data":%s}\n' \
  "$SESSION_ID" "$INPUT" \
  | nc -U "$SOCK" -w 1 2>/dev/null || true

exit 0
