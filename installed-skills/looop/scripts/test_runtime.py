#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from runtime import current_runtime  # noqa: E402
from hook_adapter import handle_request  # noqa: E402


def check(name: str, condition: bool, detail: str = "") -> None:
    status = "PASS" if condition else "FAIL"
    suffix = f": {detail}" if detail else ""
    print(f"[{status}] {name}{suffix}")
    if not condition:
        raise AssertionError(name)


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def setup_repo() -> Path:
    repo = Path(tempfile.mkdtemp(prefix="looop-git-"))
    git(repo, "init")
    git(repo, "config", "user.email", "looop@example.local")
    git(repo, "config", "user.name", "Looop Test")
    (repo / "demo.txt").write_text("one\n", encoding="utf-8")
    git(repo, "add", "demo.txt")
    first = git(repo, "commit", "-m", "chore: initial")
    check("initial commit succeeds", first.returncode == 0, first.stderr)
    return repo


def main() -> int:
    home = tempfile.mkdtemp(prefix="looop-home-")
    os.environ["LOOOP_HOME"] = home

    repo = setup_repo()
    rt = current_runtime(session_id="test-session", project_root=str(repo))

    missing = rt.current()
    check("missing current is non-creating", missing["action"] == "missing")

    started = rt.start(
        objective="Ship a traceable loop",
        target_phase="v0",
        owner_agent="web agent",
        role="coordinator",
    )
    check("start activates loop", started["mode"] == "active")
    check("start records objective", started["objective"] == "Ship a traceable loop")

    slice_result = rt.begin_slice(
        summary="Edit demo file",
        owned_files=["demo.txt"],
    )
    check("begin slice creates id", bool(slice_result["current_slice_id"]))

    context = rt.context_for_user_prompt()
    check("context injects while active", context["action"] == "inject_context")
    check("context names Looop", "<looop_context" in context["message"])
    check("context carries target phase", "v0" in context["message"])

    stop = rt.stop_decision(last_assistant_message="partial update")
    check("stop gate blocks active next action", stop["decision"] == "block")

    (repo / "demo.txt").write_text("two\n", encoding="utf-8")
    failed_gate = rt.commit_gate(
        validation_pass=False,
        debugger_pass=True,
        auto_commit=True,
    )
    check("commit gate rejects failed validation", failed_gate["can_commit"] is False)

    passed_gate = rt.commit_gate(
        validation_pass=True,
        debugger_pass=True,
        auto_commit=True,
        message="test(looop): commit owned slice",
    )
    check("commit gate allows owned validated commit", passed_gate["can_commit"] is True)
    check("commit was created", bool(passed_gate.get("commit")))
    log = git(repo, "log", "-1", "--pretty=%B").stdout
    check("commit footer includes agent", "Agent: web agent" in log)
    check("commit footer includes slice", "Looop-Slice:" in log)

    milestone = rt.milestone(
        summary="Slice committed",
        validation="test validation passed",
        debugger="no P0/P1 blocker",
        next_action="Close the loop",
    )
    check("milestone file exists", Path(milestone["path"]).is_file())

    hook_context = handle_request(
        "codex",
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "test-session",
            "cwd": str(repo),
        },
    )
    check("codex hook injects context", "hookSpecificOutput" in hook_context)

    hook_stop = handle_request(
        "claude",
        {
            "hook_event_name": "Stop",
            "session_id": "test-session",
            "cwd": str(repo),
            "last_assistant_message": "done?",
        },
    )
    check("claude stop hook blocks active loop", hook_stop.get("decision") == "block")

    closed = rt.close(summary="Finished v0 test.")
    check("close disables mode", closed["mode"] == "disabled")
    allowed = handle_request(
        "claude",
        {"hook_event_name": "Stop", "session_id": "test-session", "cwd": str(repo)},
    )
    check("stop hook allows after close", allowed.get("continue") is True)

    events_path = Path(home) / "sessions" / "test-session" / "events.jsonl"
    check("events log exists", events_path.is_file())
    check("events log has entries", len(events_path.read_text().splitlines()) >= 5)

    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
