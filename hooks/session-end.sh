#!/bin/bash
# Claude Code Stop hook — auto-capture mindkeeper checkpoint at session end
# Captures git state and writes a final fragment/thread so no work is lost.
set -euo pipefail

resolve_mindkeeper_home() {
  if [ -n "${MINDKEEPER_HOME:-}" ]; then
    echo "$MINDKEEPER_HOME"
    return
  fi
  if [[ "$HOME" == *"/.config/mms/claude-gateway/"* ]]; then
    echo "${HOME%%/.config/mms/claude-gateway/*}/.sce"
  else
    echo "$HOME/.sce"
  fi
}

SCE_HOME="$(resolve_mindkeeper_home)"
THREADS_DIR="$SCE_HOME/threads"
FRAGMENTS_DIR="$SCE_HOME/fragments"

mkdir -p "$THREADS_DIR" "$FRAGMENTS_DIR"

# Read stdin (Claude Code Stop hook payload)
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

# Detect current repo
REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$REPO" ] && exit 0

BRANCH="$(git branch --show-current 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo 'detached')"
STATUS="$(git diff --stat 2>/dev/null | tail -1 || true)"
STAGED_FILES="$(git diff --cached --name-only 2>/dev/null | tr '\n' ' ' || true)"
UNSTAGED_FILES="$(git diff --name-only 2>/dev/null | tr '\n' ' ' || true)"
LAST_COMMIT="$(git log -1 --oneline 2>/dev/null || true)"

# Build summary line
SUMMARY="session end"
[ -n "$BRANCH" ] && SUMMARY="$SUMMARY @ $BRANCH"
[ -n "$LAST_COMMIT" ] && SUMMARY="$SUMMARY | last: $LAST_COMMIT"

# Write fragment if there were changes
if [ -n "$STAGED_FILES" ] || [ -n "$UNSTAGED_FILES" ] || [ -n "$STATUS" ]; then
  TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  FRAG_ID="frg-$(date +%m%d)-$(head -c 6 /dev/urandom | LC_ALL=C tr -dc 'a-z0-9' | head -c 6)"

  # Find most recent thread for this repo to attach fragment
  LATEST_THREAD=""
  if [ -d "$THREADS_DIR" ]; then
    LATEST_THREAD=$(ls -t "$THREADS_DIR"/*.md 2>/dev/null | head -1 | xargs basename 2>/dev/null | sed 's/\.md$//' || true)
  fi

  CHANGES_LIST=""
  [ -n "$STAGED_FILES" ] && CHANGES_LIST="[staged] $STAGED_FILES"
  [ -n "$UNSTAGED_FILES" ] && CHANGES_LIST="${CHANGES_LIST:+$CHANGES_LIST; }[unstaged] $UNSTAGED_FILES"

  # Write JSONL fragment
  cat >> "$FRAGMENTS_DIR/${LATEST_THREAD:-session}.jsonl" <<EOJSON
{"id":"$FRAG_ID","rootId":"${LATEST_THREAD:-session}","threadId":"${LATEST_THREAD:-session}","repo":"$REPO","task":"auto-capture","branch":"$BRANCH","cli":"claude-code","kind":"note","created":"$TIMESTAMP","summary":"$SUMMARY","decisions":[],"changes":[$(echo "$CHANGES_LIST" | jq -R -s 'split("; ") | map(select(length > 0)) | .[0:8]' 2>/dev/null || echo '[]')],"findings":[],"next":[]}
EOJSON
fi

# If there are uncommitted changes, write a lightweight thread checkpoint
if [ -n "$STAGED_FILES" ] || [ -n "$UNSTAGED_FILES" ]; then
  THREAD_ID="dst-$(date +%m%d)-$(head -c 6 /dev/urandom | LC_ALL=C tr -dc 'a-z0-9' | head -c 6)"
  TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  CHANGES_MD=""
  if [ -n "$STAGED_FILES" ]; then
    CHANGES_MD="**已暂存**: $STAGED_FILES\n"
  fi
  if [ -n "$UNSTAGED_FILES" ]; then
    CHANGES_MD="${CHANGES_MD}**未暂存**: $UNSTAGED_FILES"
  fi

  cat > "$THREADS_DIR/$THREAD_ID.md" <<EOTHREAD
---
id: $THREAD_ID
root: $THREAD_ID
repo: $REPO
task: session-end checkpoint
branch: $BRANCH
cli: claude-code
created: $TIMESTAMP
ttl: 3d
---

## 变更

$(printf "%b" "$CHANGES_MD")

## 当前状态

会话结束时有未提交的变更。恢复后请先检查 git status。

EOTHREAD
fi

exit 0
