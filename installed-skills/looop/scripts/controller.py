#!/usr/bin/env python3
import argparse
import json
from typing import Optional

from runtime import current_runtime


def _print(data: dict) -> int:
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def _runtime(args: argparse.Namespace):
    return current_runtime(
        session_id=args.session_id,
        path=args.path,
        project_root=getattr(args, "project_root", None),
    )


def current_command(args: argparse.Namespace) -> int:
    return _print(_runtime(args).current(auto_create=args.auto_create))


def start_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).start(
            objective=args.objective,
            target_phase=args.target_phase,
            done_when=args.done_when,
            owner_agent=args.owner_agent,
            role=args.role,
            commit_policy=args.commit_policy,
            max_iterations=args.max_iterations,
        )
    )


def begin_slice_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).begin_slice(
            summary=args.summary,
            owned_files=args.owned_file,
        )
    )


def event_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).event(
            args.kind,
            args.summary,
            detail=args.detail,
            touched_files=args.touched_file,
        )
    )


def milestone_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).milestone(
            summary=args.summary,
            validation=args.validation,
            debugger=args.debugger,
            next_action=args.next_action,
            screenshots=args.screenshot,
        )
    )


def quality_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).update_quality(
            validation_status=args.validation_status,
            validation_summary=args.validation_summary,
            debugger_status=args.debugger_status,
            debugger_summary=args.debugger_summary,
            residual_uncertainty=args.residual_uncertainty,
            blocker=args.blocker,
        )
    )


def validate_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).validate_command(
            command=args.command,
            timeout=args.timeout,
        )
    )


def context_command(args: argparse.Namespace) -> int:
    return _print(_runtime(args).context_for_user_prompt())


def stop_decision_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).stop_decision(
            last_assistant_message=args.last_assistant_message
        )
    )


def precompact_command(args: argparse.Namespace) -> int:
    return _print(_runtime(args).precompact(reason=args.reason))


def tool_use_command(args: argparse.Namespace) -> int:
    tool_input = json.loads(args.tool_input) if args.tool_input else {}
    tool_output = json.loads(args.tool_output) if args.tool_output else {}
    return _print(
        _runtime(args).record_tool_use(
            tool_name=args.tool_name,
            tool_input=tool_input,
            tool_output=tool_output,
        )
    )


def recover_command(args: argparse.Namespace) -> int:
    return _print(_runtime(args).recovery_report())


def close_command(args: argparse.Namespace) -> int:
    return _print(_runtime(args).close(summary=args.summary))


def commit_gate_command(args: argparse.Namespace) -> int:
    return _print(
        _runtime(args).commit_gate(
            validation_pass=args.validation_pass,
            debugger_pass=args.debugger_pass,
            auto_commit=args.auto_commit,
            message=args.message,
            owned_files=args.owned_file,
        )
    )


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--session-id")
    parser.add_argument("--path")
    parser.add_argument("--project-root")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Looop controller.")
    sub = parser.add_subparsers(dest="command", required=True)

    current = sub.add_parser("current")
    add_common(current)
    current.add_argument("--auto-create", action="store_true")
    current.set_defaults(func=current_command)

    start = sub.add_parser("start")
    add_common(start)
    start.add_argument("--objective", required=True)
    start.add_argument("--target-phase", default="")
    start.add_argument("--done-when", default="")
    start.add_argument("--owner-agent", default="")
    start.add_argument("--role", default="")
    start.add_argument(
        "--commit-policy", default="auto", choices=["auto", "manual", "disabled"]
    )
    start.add_argument("--max-iterations", type=int, default=20)
    start.set_defaults(func=start_command)

    begin = sub.add_parser("begin-slice")
    add_common(begin)
    begin.add_argument("--summary", required=True)
    begin.add_argument("--owned-file", action="append", default=[])
    begin.set_defaults(func=begin_slice_command)

    event = sub.add_parser("event")
    add_common(event)
    event.add_argument("--kind", required=True)
    event.add_argument("--summary", required=True)
    event.add_argument("--detail", default="")
    event.add_argument("--touched-file", action="append", default=[])
    event.set_defaults(func=event_command)

    milestone = sub.add_parser("milestone")
    add_common(milestone)
    milestone.add_argument("--summary", required=True)
    milestone.add_argument("--validation", default="")
    milestone.add_argument("--debugger", default="")
    milestone.add_argument("--next-action", default="")
    milestone.add_argument("--screenshot", action="append", default=[])
    milestone.set_defaults(func=milestone_command)

    quality = sub.add_parser("quality")
    add_common(quality)
    quality.add_argument("--validation-status", default="")
    quality.add_argument("--validation-summary", default="")
    quality.add_argument("--debugger-status", default="")
    quality.add_argument("--debugger-summary", default="")
    quality.add_argument("--residual-uncertainty", default="")
    quality.add_argument("--blocker", default="")
    quality.set_defaults(func=quality_command)

    validate = sub.add_parser("validate")
    add_common(validate)
    validate.add_argument("--command", required=True)
    validate.add_argument("--timeout", type=int, default=120)
    validate.set_defaults(func=validate_command)

    context = sub.add_parser("context")
    add_common(context)
    context.set_defaults(func=context_command)

    stop = sub.add_parser("stop-decision")
    add_common(stop)
    stop.add_argument("--last-assistant-message", default="")
    stop.set_defaults(func=stop_decision_command)

    precompact = sub.add_parser("precompact")
    add_common(precompact)
    precompact.add_argument("--reason", default="")
    precompact.set_defaults(func=precompact_command)

    tool_use = sub.add_parser("tool-use")
    add_common(tool_use)
    tool_use.add_argument("--tool-name", required=True)
    tool_use.add_argument("--tool-input", default="")
    tool_use.add_argument("--tool-output", default="")
    tool_use.set_defaults(func=tool_use_command)

    recover = sub.add_parser("recover")
    add_common(recover)
    recover.set_defaults(func=recover_command)

    close = sub.add_parser("close")
    add_common(close)
    close.add_argument("--summary", default="")
    close.set_defaults(func=close_command)

    commit = sub.add_parser("commit-gate")
    add_common(commit)
    commit.add_argument("--validation-pass", action="store_true")
    commit.add_argument("--debugger-pass", action="store_true")
    commit.add_argument("--auto-commit", action="store_true")
    commit.add_argument("--message", default="")
    commit.add_argument("--owned-file", action="append", default=[])
    commit.set_defaults(func=commit_gate_command)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
