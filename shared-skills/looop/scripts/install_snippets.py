#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CLAUDE_HOOK = ROOT / "claude_hook.py"
CODEX_HOOK = ROOT / "codex_hook.py"


def claude_snippet() -> dict:
    command = f"python3 {CLAUDE_HOOK}"
    hook = {"type": "command", "command": command}
    return {
        "hooks": {
            "UserPromptSubmit": [{"matcher": "", "hooks": [hook]}],
            "PreCompact": [{"matcher": "", "hooks": [hook]}],
            "PreToolUse": [{"matcher": "*", "hooks": [hook]}],
            "PostToolUse": [{"matcher": "*", "hooks": [hook]}],
            "Stop": [{"matcher": "", "hooks": [hook]}],
        }
    }


def codex_snippet() -> dict:
    command = f"python3 {CODEX_HOOK}"
    return {
        "note": "Use this command for Codex hook events when codex_hooks are enabled.",
        "command": command,
        "events": ["UserPromptSubmit", "PreCompact", "PreToolUse", "PostToolUse", "Stop"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Print Looop hook config snippets.")
    parser.add_argument("--host", choices=["claude", "codex", "all"], default="all")
    args = parser.parse_args()

    data = {}
    if args.host in {"claude", "all"}:
        data["claude"] = claude_snippet()
    if args.host in {"codex", "all"}:
        data["codex"] = codex_snippet()
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
