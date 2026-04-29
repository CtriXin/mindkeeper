#!/bin/bash
# BrainKeeper Install Script
# Fully automated — installs, configures MCP, handles edge cases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CtriXin/brainkeeper/main/install.sh | bash
#   bash install.sh --update
#   bash install.sh --ref v2.4.0

set -euo pipefail

# ── Detect real HOME (MMS rewrites HOME to isolated session path) ──
REAL_HOME="$HOME"
if [[ "$HOME" =~ ^(/Users/[^/]+)/\.config/mms/ ]]; then
  REAL_HOME="${BASH_REMATCH[1]}"
  echo "MMS sandbox detected — using real HOME: $REAL_HOME"
fi

INSTALL_DIR="$REAL_HOME/.local/share/brainkeeper"
LEGACY_INSTALL_DIR="$REAL_HOME/.local/share/mindkeeper"
REPO_URL="https://github.com/CtriXin/brainkeeper.git"
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
echo "━━━ BrainKeeper Installer ━━━"
echo ""
if [ -d "$LEGACY_INSTALL_DIR/.git" ] && [ "$LEGACY_INSTALL_DIR" != "$INSTALL_DIR" ]; then
  echo "Legacy MindKeeper install detected at $LEGACY_INSTALL_DIR — leaving data/code in place."
  echo "BrainKeeper will install separately at $INSTALL_DIR and continue using ~/.sce data."
  echo ""
fi

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

  echo "Switching BrainKeeper to ref: $ref"
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
  echo "Cloning BrainKeeper..."
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

  node - "$file" "$SERVER_PATH" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const serverPath = process.argv[3];
const serverConfig = { command: 'node', args: [serverPath] };
let cfg = {};
let migratedLegacy = false;
let updatedExisting = false;

if (fs.existsSync(file)) {
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
    cfg = {};
    console.log(`Backed up invalid MCP config: ${backup}`);
  }
}

if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers)) cfg.mcpServers = {};

const legacy = cfg.mcpServers.mindkeeper;
const legacyText = JSON.stringify(legacy || {});
if (legacy && /mindkeeper|brainkeeper/i.test(legacyText)) {
  delete cfg.mcpServers.mindkeeper;
  migratedLegacy = true;
}
if (cfg.mcpServers.brainkeeper) updatedExisting = true;
cfg.mcpServers.brainkeeper = serverConfig;

fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
if (migratedLegacy) console.log('Migrated legacy MCP key: mindkeeper -> brainkeeper');
else if (updatedExisting) console.log('Updated BrainKeeper MCP config');
else console.log('Added BrainKeeper MCP config');
NODE

  if [ $? -ne 0 ]; then
    echo "Could not auto-configure $file — add manually:"
    echo '  "brainkeeper": { "command": "node", "args": ["'"$SERVER_PATH"'"] }'
    return 1
  fi
}

configure_mcp "$SETTINGS_FILE"

echo ""
echo "━━━ Done ━━━"
echo ""
echo "Installed:  $INSTALL_DIR"
echo "MCP config: $SETTINGS_FILE"
echo ""
echo "Restart your AI client to load BrainKeeper."
echo "Tools: brain_bootstrap, brain_checkpoint, brain_recall, brain_learn,"
echo "       brain_list, brain_check, brain_board, brain_threads"
echo ""
