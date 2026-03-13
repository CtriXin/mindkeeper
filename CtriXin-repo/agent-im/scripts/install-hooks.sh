#!/bin/bash
# Install agent-im hooks into Claude Code settings
# Merges with existing hooks — does not overwrite
set -euo pipefail

SETTINGS_FILE="$HOME/.claude/settings.json"
HOOKS_DIR="$(cd "$(dirname "$0")/../hooks" && pwd)"

echo "agent-im hook installer"
echo "======================"
echo "Hooks directory: $HOOKS_DIR"
echo "Settings file: $SETTINGS_FILE"
echo ""

# Ensure settings file exists
if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Read current settings
CURRENT=$(cat "$SETTINGS_FILE")

# Define hooks to add
# Using jq to merge hooks without overwriting existing ones
UPDATED=$(echo "$CURRENT" | jq --arg hooks_dir "$HOOKS_DIR" '
  # Ensure hooks object exists
  .hooks //= {} |

  # SessionStart hook
  .hooks.SessionStart //= [] |
  (if (.hooks.SessionStart | map(select(.hooks[]?.command | test("agent-im"))) | length) == 0
   then .hooks.SessionStart += [{
     "matcher": "",
     "hooks": [{"type": "command", "command": ("bash " + $hooks_dir + "/session-start.sh")}]
   }]
   else . end) |

  # Stop hook (session end)
  .hooks.Stop //= [] |
  (if (.hooks.Stop | map(select(.hooks[]?.command | test("agent-im"))) | length) == 0
   then .hooks.Stop += [{
     "matcher": "",
     "hooks": [{"type": "command", "command": ("bash " + $hooks_dir + "/session-end.sh")}]
   }]
   else . end) |

  # Notification hook
  .hooks.Notification //= [] |
  (if (.hooks.Notification | map(select(.hooks[]?.command | test("agent-im"))) | length) == 0
   then .hooks.Notification += [{
     "matcher": "",
     "hooks": [{"type": "command", "command": ("bash " + $hooks_dir + "/notification.sh")}]
   }]
   else . end) |

  # PostToolUse hook (content sync)
  .hooks.PostToolUse //= [] |
  (if (.hooks.PostToolUse | map(select(.hooks[]?.command | test("agent-im"))) | length) == 0
   then .hooks.PostToolUse += [{
     "matcher": "",
     "hooks": [{"type": "command", "command": ("bash " + $hooks_dir + "/post-tool-use.sh")}]
   }]
   else . end) |

  # UserPromptSubmit hook (user messages)
  .hooks.UserPromptSubmit //= [] |
  (if (.hooks.UserPromptSubmit | map(select(.hooks[]?.command | test("agent-im"))) | length) == 0
   then .hooks.UserPromptSubmit += [{
     "matcher": "",
     "hooks": [{"type": "command", "command": ("bash " + $hooks_dir + "/user-prompt.sh")}]
   }]
   else . end)
')

# Write back
echo "$UPDATED" | jq '.' > "$SETTINGS_FILE"

echo "Hooks installed:"
echo "  ✓ SessionStart → session-start.sh"
echo "  ✓ Stop → session-end.sh"
echo "  ✓ Notification → notification.sh"
echo "  ✓ PostToolUse → post-tool-use.sh (content sync)"
echo "  ✓ UserPromptSubmit → user-prompt.sh (user messages)"
echo ""
echo "Note: PreToolUse hook for permission forwarding is optional."
echo "To enable: add manually or run with --with-permissions flag"
echo ""
echo "Restart any running Claude Code sessions for hooks to take effect."

# Optional: install PreToolUse hook for permission forwarding
if [ "${1:-}" = "--with-permissions" ]; then
  UPDATED2=$(echo "$UPDATED" | jq --arg hooks_dir "$HOOKS_DIR" '
    .hooks.PreToolUse //= [] |
    (if (.hooks.PreToolUse | map(select(.hooks[]?.command | test("agent-im"))) | length) == 0
     then .hooks.PreToolUse += [{
       "matcher": "Bash|Write|Edit",
       "hooks": [{"type": "command", "command": ("bash " + $hooks_dir + "/pre-tool-use.sh")}]
     }]
     else . end)
  ')
  echo "$UPDATED2" | jq '.' > "$SETTINGS_FILE"
  echo "  ✓ PreToolUse → pre-tool-use.sh (permission forwarding enabled)"
fi
