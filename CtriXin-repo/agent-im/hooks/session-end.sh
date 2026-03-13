#!/bin/bash
# Claude Code Stop hook — unregister CLI session from agent-im daemon
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
[ ! -S "$SOCK" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

printf '{"type":"unregister","sessionId":"%s"}\n' "$SESSION_ID" \
  | nc -U "$SOCK" -w 1 2>/dev/null || true

exit 0
