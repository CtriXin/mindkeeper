#!/bin/bash
# Install brainkeeper hooks into ~/.claude/hooks/ and register them in settings.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAINKEEPER_HOME="$SCRIPT_DIR/.."
HOOKS_DIR="$BRAINKEEPER_HOME/hooks"
CLAUDE_HOOKS_DIR="$HOME/.claude/hooks"

# Copy hook files
mkdir -p "$CLAUDE_HOOKS_DIR"
cp -f "$HOOKS_DIR"/*.sh "$CLAUDE_HOOKS_DIR/"
chmod +x "$CLAUDE_HOOKS_DIR"/*.sh

echo "BrainKeeper hooks copied to $CLAUDE_HOOKS_DIR/"
echo ""
echo "To register them in ~/.claude/settings.json, add these entries:"
echo ""
echo '  "hooks": {'
echo '    "SessionStart": ['
echo '      {'
echo '        "matcher": "",'
echo '        "hooks": ['
echo '          { "type": "command", "command": "bash ~/.claude/hooks/session-start.sh" }'
echo '        ]'
echo '      }'
echo '    ],'
echo '    "Stop": ['
echo '      {'
echo '        "matcher": "",'
echo '        "hooks": ['
echo '          { "type": "command", "command": "bash ~/.claude/hooks/session-end.sh" }'
echo '        ]'
echo '      }'
echo '    ]'
echo '  }'
echo ""
echo "Or run: node $BRAINKEEPER_HOME/dist/cli.js register-hooks (if available)"
