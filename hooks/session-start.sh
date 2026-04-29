#!/bin/bash
# Claude Code SessionStart hook — auto-inject brainkeeper bootstrap context
# Prints a lightweight bootstrap summary to the session startup message.
set -euo pipefail

resolve_brainkeeper_home() {
  if [ -n "${BRAINKEEPER_HOME:-}" ]; then
    echo "$BRAINKEEPER_HOME"
    return
  fi
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

SCE_HOME="$(resolve_brainkeeper_home)"
THREADS_DIR="$SCE_HOME/threads"

# Detect current repo
REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$REPO" ] && exit 0

BRANCH="$(git branch --show-current 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo 'detached')"

# Find most recent thread for this repo
LATEST_THREAD=""
LATEST_TASK=""
if [ -d "$THREADS_DIR" ]; then
  for f in $(ls -t "$THREADS_DIR"/*.md 2>/dev/null); do
    TASK=$(grep '^task:' "$f" 2>/dev/null | head -1 | sed 's/^task: *//')
    REPO_LINE=$(grep '^repo:' "$f" 2>/dev/null | head -1 | sed 's/^repo: *//')
    if [ "$REPO_LINE" = "$REPO" ] && [ -n "$TASK" ]; then
      LATEST_THREAD=$(basename "$f" .md)
      LATEST_TASK="$TASK"
      break
    fi
  done
fi

# Build startup hint
HINT=""
if [ -n "$LATEST_THREAD" ]; then
  HINT="[brainkeeper] 上次任务: $LATEST_TASK (thread: $LATEST_THREAD)"
  HINT="$HINT\n[brainkeeper] 恢复: /cr $LATEST_THREAD"
fi

if [ -n "$BRANCH" ]; then
  HINT="${HINT:+$HINT\n}[brainkeeper] 当前分支: $BRANCH"
fi

# Print to stderr so it shows in startup banner, not as user message
[ -n "$HINT" ] && echo -e "$HINT" >&2

exit 0
