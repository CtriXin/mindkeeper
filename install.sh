#!/bin/bash
# MindKeeper Install Script
# Works in standard and MMS isolated environments
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CtriXin/mindkeeper/main/install.sh | bash
#   bash install.sh              # fresh install
#   bash install.sh --update     # update existing installation

set -euo pipefail

# ── Detect real HOME (MMS rewrites HOME to isolated session path) ──
REAL_HOME="$HOME"
if [[ "$HOME" =~ ^(/Users/[^/]+)/\.config/mms/ ]]; then
  REAL_HOME="${BASH_REMATCH[1]}"
  echo "🔍 MMS isolated environment detected"
  echo "   Isolated HOME: $HOME"
  echo "   Real HOME:     $REAL_HOME"
fi

INSTALL_DIR="$REAL_HOME/.local/share/mindkeeper"
REPO_URL="https://github.com/CtriXin/mindkeeper.git"
UPDATE_MODE=false

if [[ "${1:-}" == "--update" ]]; then
  UPDATE_MODE=true
fi

echo ""
echo "━━━ MindKeeper Installer ━━━"
echo ""

# ── Prerequisites check ──
for cmd in git node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required command not found: $cmd"
    echo "   Please install Node.js (>=18) and git first."
    exit 1
  fi
done

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VERSION < 18 )); then
  echo "❌ Node.js >= 18 required (found: $(node -v))"
  exit 1
fi

# ── Clone or update ──
if [ -d "$INSTALL_DIR/.git" ]; then
  if $UPDATE_MODE; then
    echo "📦 Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only
  else
    echo "📦 Installation already exists at $INSTALL_DIR"
    echo "   Run with --update to update, or remove and re-run."
    echo ""
    echo "   To update:  bash install.sh --update"
    echo "   To remove:  rm -rf $INSTALL_DIR"
    exit 0
  fi
else
  echo "📦 Cloning MindKeeper..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Install dependencies ──
# Use npm (not pnpm) to avoid symlink issues in MMS environments
echo "📦 Installing dependencies..."
npm install --production --ignore-scripts 2>/dev/null

# ── Verify ──
if [ ! -f "$INSTALL_DIR/dist/server.js" ]; then
  echo "❌ dist/server.js not found. Build may be required."
  echo "   Run: cd $INSTALL_DIR && npm install && npx tsc"
  exit 1
fi

echo ""
echo "✅ MindKeeper installed to: $INSTALL_DIR"
echo ""

# ── Output MCP configuration ──
cat <<EOF
━━━ MCP Configuration ━━━

Add the following to your MCP config file:

  Claude Code:  ~/.claude/settings.json
  Cursor:       .cursor/mcp.json
  Windsurf:     .windsurfrules/mcp.json

{
  "mcpServers": {
    "mindkeeper": {
      "command": "node",
      "args": ["$INSTALL_DIR/dist/server.js"]
    }
  }
}

━━━ Verify ━━━

  node $INSTALL_DIR/dist/server.js

The server communicates via stdio (MCP protocol).
If no errors appear, the installation is working.

━━━ Symlink Note (MMS users) ━━━

If you use pnpm and encounter symlink errors, set:

  echo 'node-linker=hoisted' >> $INSTALL_DIR/.npmrc
  cd $INSTALL_DIR && pnpm install

Or simply use npm (this script already does).

EOF
