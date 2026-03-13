#!/bin/bash
# Claude Code PostToolUse hook — forward tool results to agent-im daemon
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
[ ! -S "$SOCK" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
# Use jq -c to ensure compact single-line JSON (no newlines that break IPC protocol)
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}' | head -c 500)
TOOL_OUTPUT=$(echo "$INPUT" | jq -c '.tool_response // null' | head -c 2000)

# Ensure valid JSON for --argjson (head -c may truncate mid-JSON)
echo "$TOOL_INPUT" | jq . >/dev/null 2>&1 || TOOL_INPUT='{}'
echo "$TOOL_OUTPUT" | jq . >/dev/null 2>&1 || TOOL_OUTPUT='null'

# Build compact single-line JSON with jq -c (--argjson preserves JSON types)
EVENT=$(jq -c -n \
  --arg sid "$SESSION_ID" \
  --arg tool "$TOOL_NAME" \
  --argjson input "$TOOL_INPUT" \
  --argjson output "$TOOL_OUTPUT" \
  '{type:"event",sessionId:$sid,event:"tool_result",data:{tool:$tool,input:$input,output:$output}}')

printf '%s\n' "$EVENT" | nc -U "$SOCK" -w 1 2>/dev/null || true

exit 0
