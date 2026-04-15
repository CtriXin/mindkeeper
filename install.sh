#!/bin/bash
# MindKeeper Install Script
# Fully automated — installs, configures MCP, handles edge cases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CtriXin/mindkeeper/main/install.sh | bash
#   bash install.sh --update
#   bash install.sh --ref v2.3.0

set -euo pipefail

# ── Detect real HOME (MMS rewrites HOME to isolated session path) ──
REAL_HOME="$HOME"
if [[ "$HOME" =~ ^(/Users/[^/]+)/\.config/mms/ ]]; then
  REAL_HOME="${BASH_REMATCH[1]}"
  echo "MMS sandbox detected — using real HOME: $REAL_HOME"
fi

INSTALL_DIR="$REAL_HOME/.local/share/mindkeeper"
REPO_URL="https://github.com/CtriXin/mindkeeper.git"
UPDATE_MODE=false
INSTALL_REF=""

usage() {
  cat <<'EOF'
Usage:
  bash install.sh
  bash install.sh --update
  bash install.sh --ref <tag-or-branch>

Notes:
  --update                Update the current branch checkout in-place
  --ref <tag-or-branch>   Install or switch to a specific tag/branch
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --update)
      UPDATE_MODE=true
      ;;
    --ref)
      shift
      if [[ -z "${1:-}" ]]; then
        echo "ERROR: --ref requires a tag or branch name."
        usage
        exit 1
      fi
      INSTALL_REF="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

echo ""
echo "━━━ MindKeeper Installer ━━━"
echo ""

# ── Prerequisites ──
for cmd in git node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Install Node.js (>=18) and git first."
    exit 1
  fi
done

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VERSION < 18 )); then
  echo "ERROR: Node.js >= 18 required (found: $(node -v))"
  exit 1
fi

checkout_requested_ref() {
  local ref="$1"
  if [[ -z "$ref" ]]; then
    return 0
  fi

  echo "Switching MindKeeper to ref: $ref"
  git fetch --tags --force origin >/dev/null 2>&1 || true

  if git ls-remote --exit-code --heads origin "$ref" >/dev/null 2>&1; then
    git fetch --depth 1 origin "$ref"
    git checkout -B "$ref" FETCH_HEAD
    return 0
  fi

  if git ls-remote --exit-code --tags origin "refs/tags/$ref" >/dev/null 2>&1; then
    git fetch --depth 1 origin "refs/tags/$ref:refs/tags/$ref"
    git checkout -f "$ref"
    return 0
  fi

  if git rev-parse --verify "$ref^{commit}" >/dev/null 2>&1; then
    git checkout -f "$ref"
    return 0
  fi

  echo "ERROR: ref not found: $ref"
  exit 1
}

# ── Clone or update ──
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  if [[ -n "$INSTALL_REF" ]]; then
    checkout_requested_ref "$INSTALL_REF"
  elif $UPDATE_MODE; then
    echo "Updating existing installation..."
    current_branch="$(git symbolic-ref --short -q HEAD || true)"
    if [[ -z "$current_branch" ]]; then
      echo "Pinned or detached checkout detected. Re-run with --ref <tag-or-branch> to move versions."
      exit 1
    fi
    git pull --ff-only
  else
    echo "Already installed at $INSTALL_DIR"
    echo "Use --update to update, or --ref <tag-or-branch> to switch versions."
    exit 0
  fi
else
  echo "Cloning MindKeeper..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -n "$INSTALL_REF" ]]; then
    git clone --depth 1 --branch "$INSTALL_REF" "$REPO_URL" "$INSTALL_DIR"
  else
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi

# ── Install deps (npm avoids pnpm symlink issues in sandboxed envs) ──
echo "Installing dependencies..."
npm install --production --ignore-scripts 2>/dev/null

# ── Handle pnpm symlink fallback ──
if [ -f "$INSTALL_DIR/pnpm-lock.yaml" ] && ! [ -f "$INSTALL_DIR/.npmrc" ]; then
  echo 'node-linker=hoisted' > "$INSTALL_DIR/.npmrc"
fi

# ── Verify build ──
if [ ! -f "$INSTALL_DIR/dist/server.js" ]; then
  echo "dist/ missing — building from source..."
  cd "$INSTALL_DIR"
  npm install --ignore-scripts 2>/dev/null
  npx tsc
fi

# ── Auto-configure MCP (Claude Code) ──
SETTINGS_FILE="$REAL_HOME/.claude/settings.json"
SERVER_PATH="$INSTALL_DIR/dist/server.js"

configure_mcp() {
  local file="$1"
  mkdir -p "$(dirname "$file")"

  if [ ! -f "$file" ]; then
    # Create new settings file
    cat > "$file" <<MCPEOF
{
  "mcpServers": {
    "mindkeeper": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
MCPEOF
    echo "Created $file with MindKeeper MCP config."
    return
  fi

  # Check if mindkeeper is already configured
  if grep -q '"mindkeeper"' "$file" 2>/dev/null; then
    echo "MCP config already exists in $file — skipped."
    return
  fi

  # Insert into existing mcpServers block
  if grep -q '"mcpServers"' "$file" 2>/dev/null; then
    # Use node to merge JSON safely
    node -e "
      const fs = require('fs');
      const f = '$file';
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers.mindkeeper = { command: 'node', args: ['$SERVER_PATH'] };
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
    " 2>/dev/null && echo "Added MindKeeper to $file" && return
  fi

  # No mcpServers key — add it
  node -e "
    const fs = require('fs');
    const f = '$file';
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
    cfg.mcpServers = { mindkeeper: { command: 'node', args: ['$SERVER_PATH'] } };
    fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
  " 2>/dev/null && echo "Added MindKeeper to $file" && return

  echo "Could not auto-configure $file — add manually:"
  echo '  "mindkeeper": { "command": "node", "args": ["'"$SERVER_PATH"'"] }'
}

configure_mcp "$SETTINGS_FILE"

echo ""
echo "━━━ Done ━━━"
echo ""
echo "Installed:  $INSTALL_DIR"
echo "MCP config: $SETTINGS_FILE"
echo ""
echo "Restart your AI client to load MindKeeper."
echo "Tools: brain_bootstrap, brain_checkpoint, brain_recall, brain_learn,"
echo "       brain_list, brain_check, brain_board, brain_threads"
echo ""
