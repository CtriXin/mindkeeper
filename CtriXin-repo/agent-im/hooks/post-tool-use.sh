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
echo "$TOOL_INPUT" | jq . >/dev/null 2>&1 || TOOL_INPUT='{}'

# Extract readable output text from tool response.
# Uses jq -r to get raw text FIRST, then truncates safely (no broken JSON).
# Handles: Bash {stdout}, Read {content}, content-block arrays, plain strings.
TOOL_OUTPUT_RAW=$(echo "$INPUT" | jq -r '
  .tool_response // null |
  if type == "null" then ""
  elif type == "string" then .
  elif type == "object" then (.stdout // .content // .output // .text // tojson)
  elif type == "array" then ([.[] | select(.type == "text") | .text] | join("\n"))
  else tostring
  end' 2>/dev/null | head -c 2000) || true

# Re-encode as JSON string for --argjson (safe: raw text was truncated, not JSON)
if [ -n "$TOOL_OUTPUT_RAW" ]; then
  TOOL_OUTPUT=$(printf '%s' "$TOOL_OUTPUT_RAW" | jq -Rsc '.') || TOOL_OUTPUT='null'
else
  TOOL_OUTPUT='null'
fi

# Build compact single-line JSON with jq -c (--argjson preserves JSON types)
EVENT=$(jq -c -n \
  --arg sid "$SESSION_ID" \
  --arg tool "$TOOL_NAME" \
  --argjson input "$TOOL_INPUT" \
  --argjson output "$TOOL_OUTPUT" \
  '{type:"event",sessionId:$sid,event:"tool_result",data:{tool:$tool,input:$input,output:$output}}')

printf '%s\n' "$EVENT" | nc -U "$SOCK" -w 1 2>/dev/null || true

exit 0
