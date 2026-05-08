#!/usr/bin/env python3
import json
import sys

from runtime import current_runtime


def load_request() -> dict:
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def main() -> int:
    request = load_request()
    event_name = str(request.get("hook_event_name", "")).strip()
    session_id = str(request.get("session_id", "")).strip()
    if event_name != "UserPromptSubmit" or not session_id:
        print(json.dumps({"continue": True}))
        return 0

    runtime = current_runtime(session_id=session_id)
    context = runtime.context_for_user_prompt()
    if context.get("action") in {"inject_context", "repair_required"} and context.get(
        "message"
    ):
        print(
            json.dumps(
                {
                    "continue": True,
                    "hookSpecificOutput": {
                        "hookEventName": event_name,
                        "additionalContext": str(context["message"]),
                    },
                },
                ensure_ascii=True,
            )
        )
        return 0

    print(json.dumps({"continue": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
