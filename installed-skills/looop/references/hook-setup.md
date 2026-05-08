# Hook Setup

Looop ships separate adapters for Codex and Claude. Both read JSON on stdin and return structured JSON on stdout.

## Codex

Use:

```bash
python3 /Users/xin/auto-skills/installed-skills/looop/scripts/codex_hook.py
```

Supported events:

- `UserPromptSubmit`: injects Looop context.
- `Stop`: blocks premature stop while an active loop has a contract-covered next action.
- `PreCompact`: records a compact checkpoint event.

## Claude Code

Use:

```bash
python3 /Users/xin/auto-skills/installed-skills/looop/scripts/claude_hook.py
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
            "command": "python3 /Users/xin/auto-skills/installed-skills/looop/scripts/claude_hook.py"
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
            "command": "python3 /Users/xin/auto-skills/installed-skills/looop/scripts/claude_hook.py"
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
            "command": "python3 /Users/xin/auto-skills/installed-skills/looop/scripts/claude_hook.py"
          }
        ]
      }
    ]
  }
}
```

Claude hook notes:

- `UserPromptSubmit` supports `hookSpecificOutput.additionalContext`.
- `Stop` supports top-level `decision: "block"` with `reason`.
- Plain stdout may also be injected for prompt hooks, but Looop uses structured JSON for predictability.
- Reference checked on 2026-05-08: https://code.claude.com/docs/en/hooks

Do not enable both old LLR and Looop stop guards for the same session unless you intentionally want both gates.
