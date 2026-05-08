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
    if request.get("hook_event_name") != "Stop":
        print(json.dumps({"continue": True}))
        return 0

    session_id = str(request.get("session_id", "")).strip()
    if not session_id:
        print(json.dumps({"continue": True}))
        return 0

    runtime = current_runtime(session_id=session_id)
    decision = runtime.stop_decision(
        last_assistant_message=str(request.get("last_assistant_message", ""))
    )
    if decision.get("decision") == "block":
        print(
            json.dumps(
                {"decision": "block", "reason": str(decision.get("reason", ""))},
                ensure_ascii=True,
            )
        )
        return 0

    print(json.dumps({"continue": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
