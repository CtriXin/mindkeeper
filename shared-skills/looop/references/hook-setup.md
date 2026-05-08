# Hook Setup

Looop ships separate adapters for Codex and Claude. Both read JSON on stdin and return structured JSON on stdout.

## Codex

Use:

```bash
python3 /Users/xin/auto-skills/shared-skills/looop/scripts/codex_hook.py
```

Supported events:

- `UserPromptSubmit`: injects Looop context.
- `Stop`: blocks premature stop while an active loop has a contract-covered next action.
- `PreCompact`: records a compact checkpoint event.
- `PreToolUse` / `PostToolUse`: records tool/file activity for traceability and ownership hints.

Print a config/helper snippet:

```bash
python3 /Users/xin/auto-skills/shared-skills/looop/scripts/install_snippets.py --host codex
```

## Claude Code

Use:

```bash
python3 /Users/xin/auto-skills/shared-skills/looop/scripts/claude_hook.py
```

Claude settings example:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /Users/xin/auto-skills/shared-skills/looop/scripts/claude_hook.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /Users/xin/auto-skills/shared-skills/looop/scripts/claude_hook.py"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /Users/xin/auto-skills/shared-skills/looop/scripts/claude_hook.py"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /Users/xin/auto-skills/shared-skills/looop/scripts/claude_hook.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /Users/xin/auto-skills/shared-skills/looop/scripts/claude_hook.py"
          }
        ]
      }
    ]
  }
}
```

Print the same snippet:

```bash
python3 /Users/xin/auto-skills/shared-skills/looop/scripts/install_snippets.py --host claude
```

Claude hook notes:

- `UserPromptSubmit` supports `hookSpecificOutput.additionalContext`.
- `Stop` supports top-level `decision: "block"` with `reason`.
- Plain stdout may also be injected for prompt hooks, but Looop uses structured JSON for predictability.
- Reference checked on 2026-05-08: https://code.claude.com/docs/en/hooks

Do not enable both old LLR and Looop stop guards for the same session unless you intentionally want both gates.

Maintenance note: `web agent` (`Role: coordinator`) switched the local Codex hook entry from legacy `long-long-run` to `looop` on 2026-05-08. The legacy implementation directory and historical sessions were intentionally preserved; only the old Codex skill symlink should be removed during migration.
