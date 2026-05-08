#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Optional

from runtime import current_runtime


def _load_patch_arg(args: argparse.Namespace) -> dict:
    if args.json_text is None and args.json_file is None:
        raise SystemExit("update requires --json or --json-file")
    if args.json_file is not None:
        text = Path(args.json_file).expanduser().read_text(encoding="utf-8")
    else:
        text = args.json_text
    try:
        patch = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"could not parse update JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(patch, dict):
        raise SystemExit("update JSON must be an object")
    return patch


def _print_json(data: dict) -> int:
    print(json.dumps(data, ensure_ascii=True, indent=2))
    return 0


def current_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.bind(
            auto_create=args.auto_create,
            project_root=args.project_root,
        )
    )


def show_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(runtime.show())


def update_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.update(
            _load_patch_arg(args),
            auto_create=not args.no_auto_create,
            project_root=args.project_root,
        )
    )


def checkpoint_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.checkpoint(
            summary=args.summary,
            next_action=args.next_action,
            auto_create=not args.no_auto_create,
            project_root=args.project_root,
        )
    )


def authorize_active_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.authorize_active(
            evidence=args.evidence,
            scope=args.scope,
        )
    )


def activate_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(runtime.activate())


def return_to_inc_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.return_to_inc(
            reason=args.reason,
            next_action=args.next_action,
        )
    )


def close_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.close(
            reason=args.reason,
            summary=args.summary,
        )
    )


def context_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(runtime.context_for_user_prompt())


def stop_decision_command(args: argparse.Namespace) -> int:
    runtime = current_runtime(session_id=args.session_id, path=args.path)
    return _print_json(
        runtime.stop_decision(last_assistant_message=args.last_assistant_message)
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Long Long Run controller.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    current_parser = subparsers.add_parser("current")
    current_parser.add_argument("--session-id")
    current_parser.add_argument("--path")
    current_parser.add_argument("--project-root")
    current_parser.add_argument("--auto-create", action="store_true")
    current_parser.set_defaults(func=current_command)

    show_parser = subparsers.add_parser("show")
    show_parser.add_argument("--session-id")
    show_parser.add_argument("--path")
    show_parser.set_defaults(func=show_command)

    update_parser = subparsers.add_parser("update")
    update_parser.add_argument("--session-id")
    update_parser.add_argument("--path")
    update_parser.add_argument("--project-root")
    update_parser.add_argument("--json", dest="json_text")
    update_parser.add_argument("--json-file")
    update_parser.add_argument("--no-auto-create", action="store_true")
    update_parser.set_defaults(func=update_command)

    checkpoint_parser = subparsers.add_parser("checkpoint")
    checkpoint_parser.add_argument("--session-id")
    checkpoint_parser.add_argument("--path")
    checkpoint_parser.add_argument("--project-root")
    checkpoint_parser.add_argument("--summary", required=True)
    checkpoint_parser.add_argument("--next-action", default="")
    checkpoint_parser.add_argument("--no-auto-create", action="store_true")
    checkpoint_parser.set_defaults(func=checkpoint_command)

    authorize_parser = subparsers.add_parser("authorize-active")
    authorize_parser.add_argument("--session-id")
    authorize_parser.add_argument("--path")
    authorize_parser.add_argument("--evidence", required=True)
    authorize_parser.add_argument(
        "--scope",
        default="single",
        choices=["single", "standing_session"],
    )
    authorize_parser.set_defaults(func=authorize_active_command)

    activate_parser = subparsers.add_parser("activate")
    activate_parser.add_argument("--session-id")
    activate_parser.add_argument("--path")
    activate_parser.set_defaults(func=activate_command)

    return_parser = subparsers.add_parser("return-to-inc")
    return_parser.add_argument("--session-id")
    return_parser.add_argument("--path")
    return_parser.add_argument("--reason", required=True)
    return_parser.add_argument("--next-action", default="")
    return_parser.set_defaults(func=return_to_inc_command)

    close_parser = subparsers.add_parser("close")
    close_parser.add_argument("--session-id")
    close_parser.add_argument("--path")
    close_parser.add_argument("--reason", required=True)
    close_parser.add_argument("--summary", default="")
    close_parser.set_defaults(func=close_command)

    context_parser = subparsers.add_parser("context")
    context_parser.add_argument("--session-id")
    context_parser.add_argument("--path")
    context_parser.set_defaults(func=context_command)

    stop_parser = subparsers.add_parser("stop-decision")
    stop_parser.add_argument("--session-id")
    stop_parser.add_argument("--path")
    stop_parser.add_argument("--last-assistant-message", default="")
    stop_parser.set_defaults(func=stop_decision_command)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
