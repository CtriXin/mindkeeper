#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# agent-im E2E Smoke Test
# ═══════════════════════════════════════════════════════════════
# Simulates a full Claude Code CLI session by sending raw IPC
# messages to the daemon socket. No Claude Code needed.
#
# Covers: register → tool output → cross-folder → title update
#         → permission approve/deny → done → archive
#
# Usage:  bash scripts/smoke-test.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SOCK="$HOME/.agent-im/agent-im.sock"
SESSION_FILE="$HOME/.agent-im/data/sessions.json"
SID="smoke-$(date +%s)"
CWD="$(pwd)"
PROJECT="agent-im"
BRANCH="feature/smoke-test"

# ── Colors ──
G='\033[0;32m'  Y='\033[1;33m'  C='\033[0;36m'  R='\033[0;31m'  B='\033[1m'  D='\033[2m'  N='\033[0m'

# ── Result tracking ──
declare -a CHECK_NAMES=()
declare -a CHECK_STATUS=()  # pass / fail / skip

check() {
  local name="$1" status="$2"
  CHECK_NAMES+=("$name")
  CHECK_STATUS+=("$status")
  if [ "$status" = "pass" ]; then
    echo -e "  ${G}✓ ${name}${N}"
  elif [ "$status" = "fail" ]; then
    echo -e "  ${R}✗ ${name}${N}"
  else
    echo -e "  ${Y}? ${name}${N}"
  fi
}

send() { printf '%s\n' "$1" | nc -U "$SOCK" -w 1 2>/dev/null || true; }
step() {
  echo ""
  echo -e "${G}═══ Step $1: $2 ═══${N}"
  echo -e "${C}  👀 $3${N}"
}
pause() {
  echo -e "${D}  ⏎ Enter to continue...${N}"
  read -r
}

# Helper: read a field from sessions.json
session_field() { jq -r ".\"$SID\".$1 // empty" "$SESSION_FILE" 2>/dev/null; }

# ── Pre-checks ──
if [ ! -S "$SOCK" ]; then
  echo -e "${R}✗ Daemon not running.${N} Start with: npm run dev"
  exit 1
fi
command -v node >/dev/null || { echo -e "${R}✗ node not found${N}"; exit 1; }
command -v jq >/dev/null   || { echo -e "${R}✗ jq not found${N}"; exit 1; }

echo -e "${G}✓ Daemon socket found${N}"
echo -e "  Session: ${Y}${SID}${N}"
echo -e "  CWD:     ${CWD}"
echo ""
echo -e "${B}This test will create a real Discord thread.${N}"
pause

# ═══════════════════════════════════════════════════════════════
# Step 1: Register session → Discord thread creation
# ═══════════════════════════════════════════════════════════════
step 1 "Register session" "Hub channel: new thread \"${PROJECT} / ${BRANCH}\""
send "{\"type\":\"register\",\"sessionId\":\"$SID\",\"cwd\":\"$CWD\",\"pid\":$$,\"project\":\"$PROJECT\",\"branch\":\"$BRANCH\"}"
echo "  Waiting 4s for thread creation..."
sleep 4

# Verify
THREAD_ID=$(session_field threadId)
SESSION_STATUS=$(session_field status)
if [ -n "$THREAD_ID" ] && [ "$SESSION_STATUS" = "active" ]; then
  check "Session registered + thread created" pass
else
  check "Session registered + thread created (threadId=$THREAD_ID, status=$SESSION_STATUS)" fail
fi
pause

# ═══════════════════════════════════════════════════════════════
# Step 2: Cross-folder tool calls (BEFORE prompt → accumulates
#         paths so first title update includes ↔ indicator)
# ═══════════════════════════════════════════════════════════════
step 2 "Cross-folder tool calls (4x Read in /other-project/)" \
  "Thread: 4 green embeds with file paths"
SEND_OK=true
for i in 1 2 3 4; do
  send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"tool_result\",\"data\":{\"tool\":\"Read\",\"input\":{\"file_path\":\"/Users/xin/other-project/src/component${i}.tsx\"},\"output\":{\"content\":\"import React from 'react';\\nexport function Component${i}() { return <div>...</div>; }\"},\"is_error\":false}}" || SEND_OK=false
  sleep 0.5
done
check "4 cross-folder tool events sent" "$( [ "$SEND_OK" = true ] && echo pass || echo fail )"
pause

# ═══════════════════════════════════════════════════════════════
# Step 3: User prompt → triggers first title update
# ═══════════════════════════════════════════════════════════════
step 3 "User prompt (triggers title update)" \
  "Thread TITLE → \"${PROJECT} ↔ other-project / ${BRANCH} — 修复空输出 bug\""
send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"user_prompt\",\"data\":{\"prompt\":\"修复 Discord 空输出 bug\"}}"
sleep 3
check "User prompt sent (verify title ↔ on Discord)" pass
pause

# ═══════════════════════════════════════════════════════════════
# Step 4: Tool result — success with output
# ═══════════════════════════════════════════════════════════════
step 4 "Tool result: Bash success" \
  "Green embed 🔧 Bash — npm run build | Output: build log"
send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"tool_result\",\"data\":{\"tool\":\"Bash\",\"input\":{\"command\":\"npm run build\"},\"output\":\"\\n> agent-im@0.1.0 build\\n> tsc\\n\\nBuild succeeded. 0 errors, 0 warnings.\",\"is_error\":false}}"
sleep 1
check "Bash success embed (green)" pass
pause

# ═══════════════════════════════════════════════════════════════
# Step 5: Tool result — error
# ═══════════════════════════════════════════════════════════════
step 5 "Tool result: Bash error" \
  "RED embed ❌ Bash — npm test | Output: TypeError"
send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"tool_result\",\"data\":{\"tool\":\"Bash\",\"input\":{\"command\":\"npm test\"},\"output\":\"FAIL src/content-router.test.ts\\n  TypeError: Cannot read properties of undefined (reading 'embed')\\n    at Object.<anonymous> (content-router.test.ts:42:15)\",\"is_error\":true}}"
sleep 1
check "Bash error embed (red)" pass
pause

# ═══════════════════════════════════════════════════════════════
# Step 6: Tool result — empty output (regression test for Bug 1)
# ═══════════════════════════════════════════════════════════════
step 6 "Tool result: Edit (empty output)" \
  "Green embed 🔧 Edit — file path only, NO output section"
send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"tool_result\",\"data\":{\"tool\":\"Edit\",\"input\":{\"file_path\":\"/Users/xin/agent-im/src/main.ts\",\"old_string\":\"foo\",\"new_string\":\"bar\"},\"output\":null,\"is_error\":false}}"
sleep 1
check "Edit empty output (no empty code block)" pass
pause

# ═══════════════════════════════════════════════════════════════
# Step 7: Tool result — Glob with pattern input
# ═══════════════════════════════════════════════════════════════
step 7 "Tool result: Glob" \
  "Green embed 🔧 Glob — **/*.ts | Output: file listing"
send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"tool_result\",\"data\":{\"tool\":\"Glob\",\"input\":{\"pattern\":\"**/*.ts\"},\"output\":\"src/main.ts\\nsrc/config.ts\\nsrc/store.ts\\nsrc/ipc-server.ts\\nsrc/session-registry.ts\\nsrc/content-router.ts\\nsrc/discord/adapter.ts\\nsrc/discord/thread-ops.ts\",\"is_error\":false}}"
sleep 1
check "Glob embed with file listing" pass
pause

# ═══════════════════════════════════════════════════════════════
# Step 8: Permission request → Discord buttons
# ═══════════════════════════════════════════════════════════════
step 8 "Permission request" \
  "Orange embed ⚠️ with Allow / Deny buttons. CLICK ONE!"
PERM_ID="perm-$(date +%s)"
echo -e "  ${Y}⏳ Waiting for your decision on Discord (60s timeout)...${N}"

PERM_RESULT=$(node -e "
  const net = require('net');
  const sock = net.connect(process.argv[1]);
  const msg = {
    type: 'permission_request',
    sessionId: process.argv[2],
    permissionId: process.argv[3],
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /tmp/test-data' },
    waitResponse: true
  };
  sock.write(JSON.stringify(msg) + '\n');
  sock.on('data', d => { process.stdout.write(d.toString()); sock.end(); });
  setTimeout(() => { process.stdout.write('{\"decision\":\"timeout\"}'); sock.end(); }, 60000);
" "$SOCK" "$SID" "$PERM_ID" 2>/dev/null || echo '{"decision":"error"}')

if echo "$PERM_RESULT" | grep -q '"allow"'; then
  check "Permission: Allow received" pass
elif echo "$PERM_RESULT" | grep -q '"deny"'; then
  check "Permission: Deny received" pass
else
  check "Permission: no response (timeout/error)" fail
fi
pause

# ═══════════════════════════════════════════════════════════════
# Step 9: Result (Done) — session complete
# ═══════════════════════════════════════════════════════════════
step 9 "Result: Done" \
  "Green embed ✅ Done | Footer: Cost \$0.0342 | In: 15000 | Out: 3000"
send "{\"type\":\"event\",\"sessionId\":\"$SID\",\"event\":\"result\",\"data\":{\"usage\":{\"cost_usd\":0.0342,\"input_tokens\":15000,\"output_tokens\":3000}}}"
sleep 1
check "Done embed sent" pass
pause

# ═══════════════════════════════════════════════════════════════
# Step 10: Unregister → thread archived
# ═══════════════════════════════════════════════════════════════
step 10 "Unregister (session ends)" \
  "Thread: archive message → auto-archived. Hub: card turns red (Ended)"
send "{\"type\":\"unregister\",\"sessionId\":\"$SID\"}"
sleep 2

# Verify session is dead
FINAL_STATUS=$(session_field status)
if [ "$FINAL_STATUS" = "dead" ]; then
  check "Session marked dead after unregister" pass
else
  check "Session status: $FINAL_STATUS (expected: dead)" fail
fi

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${B}═══════════════════════════════════════════${N}"
echo -e "${B}  Results${N}"
echo -e "${B}═══════════════════════════════════════════${N}"
echo ""

PASS=0 FAIL=0 SKIP=0
for i in "${!CHECK_NAMES[@]}"; do
  s="${CHECK_STATUS[$i]}"
  n="${CHECK_NAMES[$i]}"
  if [ "$s" = "pass" ]; then
    echo -e "  ${G}✓${N} $n"
    ((PASS++))
  elif [ "$s" = "fail" ]; then
    echo -e "  ${R}✗${N} $n"
    ((FAIL++))
  else
    echo -e "  ${Y}?${N} $n"
    ((SKIP++))
  fi
done

echo ""
echo -e "  ${G}${PASS} passed${N}  ${R}${FAIL} failed${N}  ${Y}${SKIP} skipped${N}"
echo -e "  Session: ${D}${SID}${N}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
