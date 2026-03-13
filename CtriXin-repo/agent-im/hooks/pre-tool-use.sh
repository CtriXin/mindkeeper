#!/bin/bash
# Claude Code PreToolUse hook — forward permission requests to agent-im daemon
# This hook BLOCKS until the user approves/denies from IM
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
[ ! -S "$SOCK" ] && exit 0  # daemon not running, let CLI handle normally

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ -z "$SESSION_ID" ] && exit 0

# Generate a unique permission ID
PERM_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "perm-$(date +%s)-$$")

# Send permission request and WAIT for response (blocking)
# nc will stay connected until daemon writes back a response
RESPONSE=$(printf '{"type":"permission_request","sessionId":"%s","permissionId":"%s","toolName":"%s","toolInput":%s,"waitResponse":true}\n' \
  "$SESSION_ID" "$PERM_ID" "$TOOL_NAME" "$INPUT" \
  | nc -U "$SOCK" 2>/dev/null || echo '{"decision":"allow"}')

DECISION=$(echo "$RESPONSE" | jq -r '.decision // "allow"')

if [ "$DECISION" = "deny" ]; then
  MESSAGE=$(echo "$RESPONSE" | jq -r '.message // "Denied from IM"')
  # Exit code 2 = feed stderr back to Claude as error
  echo "{\"decision\":\"deny\",\"reason\":\"$MESSAGE\"}" >&2
  exit 2
fi

# Allow — continue normally
exit 0
