#!/bin/bash
# Claude Code UserPromptSubmit hook — forward user messages to agent-im daemon
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
[ ! -S "$SOCK" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

USER_PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' | head -c 1000)
[ -z "$USER_PROMPT" ] && exit 0

# Compact single-line JSON
EVENT=$(jq -c -n \
  --arg sid "$SESSION_ID" \
  --arg prompt "$USER_PROMPT" \
  '{type:"event",sessionId:$sid,event:"user_prompt",data:{prompt:$prompt}}')

printf '%s\n' "$EVENT" | nc -U "$SOCK" -w 1 2>/dev/null || true

exit 0
