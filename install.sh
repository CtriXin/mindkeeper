#!/bin/bash
# MindKeeper Install Script
# Fully automated — installs, configures MCP, handles edge cases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CtriXin/mindkeeper/main/install.sh | bash
#   bash install.sh --update

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
[[ "${1:-}" == "--update" ]] && UPDATE_MODE=true

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

# ── Clone or update ──
if [ -d "$INSTALL_DIR/.git" ]; then
  if $UPDATE_MODE; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only
  else
    echo "Already installed at $INSTALL_DIR"
    echo "Use --update to update."
    exit 0
  fi
else
  echo "Cloning MindKeeper..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
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
