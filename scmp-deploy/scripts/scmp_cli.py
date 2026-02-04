#!/usr/bin/env python3
"""Standalone SCMP CLI (no browser / no UI).

This script follows the flow in `/Users/xin/Desktop/script.json`:
0) login -> get token
1) search service -> get git_url
2) list pipelines -> pick pipeline name
3) currentPipelineRun -> infer current params (branch/env/version)
4) pipeline run -> POST run payload

Security notes:
- This script NEVER writes plaintext passwords to disk.
- Token is stored (optionally) in a local file with best-effort 0600 perms.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from getpass import getpass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from scmp_api import (
    SCMPApi,
    default_token_path,
    load_token_file,
    login_and_get_token,
    redact_secret,
    save_token_file,
    token_file_saved_ymd,
)


BASE_URL = "https://scmp.adsconflux.xyz"


def _die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(2)


def _is_interactive() -> bool:
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except Exception:
        return False


def _prompt(text: str, *, default: Optional[str] = None) -> str:
    suffix = ""
    if default is not None:
        suffix = f" [{default}]"
    val = input(f"{text}{suffix}: ").strip()
    if val == "" and default is not None:
        return default
    return val


def _prompt_yes_no(text: str, *, default: bool = True) -> bool:
    d = "Y/n" if default else "y/N"
    while True:
        raw = input(f"{text} [{d}]: ").strip().lower()
        if raw == "":
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False


def _bool_env(name: str) -> bool:
    v = os.environ.get(name)
    if v is None:
        return False
    return str(v).strip().lower() in ("1", "true", "yes", "y", "on")


def _prompt_password(*, plain: bool, context: str) -> str:
    if plain:
        return input(f"SCMP password ({context}, PLAINTEXT): ")
    return getpass(f"SCMP password ({context}, input hidden): ")


def _require_ok(resp_body: Any, *, context: str) -> Any:
    if not isinstance(resp_body, dict):
        _die(f"{context}: unexpected response type: {type(resp_body)}")
    code = resp_body.get("code")
    if code not in (None, 20000, 0, 200):
        _die(f"{context}: failed: code={code} message={resp_body.get('message')}")
    return resp_body


def _pick_best_service(result: List[Dict[str, Any]], keyword: str) -> Dict[str, Any]:
    if not result:
        _die("service search: empty result")

    # Prefer exact name match
    for item in result:
        if str(item.get("name", "")) == keyword:
            return item

    # Otherwise prefer closest containing match (shortest name)
    candidates = [r for r in result if keyword in str(r.get("name", ""))]
    if candidates:
        candidates.sort(key=lambda r: len(str(r.get("name", ""))))
        return candidates[0]

    # Fallback to first entry
    return result[0]


def _extract_param(params: List[Dict[str, Any]], name: str) -> Optional[str]:
    for p in params or []:
        if str(p.get("name")) == name:
            v = p.get("value")
            return None if v is None else str(v)
    return None


def login_cmd(args: argparse.Namespace) -> None:
    share_id = args.share_id or os.environ.get("SCMP_SHARE_ID")
    if not share_id:
        _die("missing share_id: provide --share-id or SCMP_SHARE_ID")
    share_id = str(share_id)

    password = args.password or os.environ.get("SCMP_PASSWORD")
    if args.prompt_password or not password:
        plain = bool(args.plain_password or _bool_env("SCMP_PLAIN_PASSWORD"))
        password = _prompt_password(plain=plain, context="login")
    password = str(password)

    token = login_and_get_token(BASE_URL, share_id, password)
    if not token:
        _die("login failed: could not parse token from response")
    token = str(token)

    print(f"token={redact_secret(token)}")

    if not args.no_save:
        save_token_file(args.token_file, token)
        print(f"saved_token_file={os.path.expanduser(args.token_file)}")


def _load_token_or_die(token_file: str) -> str:
    token = os.environ.get("SCMP_AUTHENTICATION")
    if token:
        return token.strip()
    token = load_token_file(token_file)
    if token:
        return token
    _die("missing token: set SCMP_AUTHENTICATION or run `login` to create a token file")
    raise AssertionError


def _today_ymd() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _ensure_daily_login(
    token_file: str, *, share_id: Optional[str], plain_password: bool
) -> None:
    """每天第一次执行时，强制刷新 token（只保存 token，不保存密码）。"""

    # 用户如果显式提供了 token，就不覆盖。
    if os.environ.get("SCMP_AUTHENTICATION"):
        return

    saved_ymd = token_file_saved_ymd(token_file)
    if saved_ymd == _today_ymd():
        return

    if not _is_interactive():
        _die(
            "token 不是今天生成的，但当前是非交互环境；请先手动执行一次 login 更新 token"
        )

    sid = share_id or os.environ.get("SCMP_SHARE_ID")
    if not sid:
        sid = _prompt("SCMP share_id")
    if not sid:
        _die("share_id is required")

    plain = bool(plain_password or _bool_env("SCMP_PLAIN_PASSWORD"))
    password = _prompt_password(plain=plain, context="daily login")
    token = login_and_get_token(BASE_URL, str(sid), str(password))
    if not token:
        _die("daily login failed: could not parse token")

    save_token_file(token_file, str(token))
    print(f"daily_login=ok saved_token_file={os.path.expanduser(token_file)}")


def service_cmd(args: argparse.Namespace) -> None:
    token = _load_token_or_die(args.token_file)
    api = SCMPApi(BASE_URL, token)
    keyword_q = quote(args.keyword)
    path = (
        "/larke-serving/api/v1/groups/FE/projects/fe/services"
        f"?group=FE&project=fe&keyword={keyword_q}&is_star=false&enable_page=true&page=1&limit=10"
    )
    resp = api.get_json(path)
    body = _require_ok(resp.body, context="service search")
    result = body.get("result") or []
    if not isinstance(result, list):
        _die("service search: result is not a list")

    picked = _pick_best_service(result, args.keyword)
    print(json.dumps(picked, indent=2, ensure_ascii=True))


def pipelines_cmd(args: argparse.Namespace) -> None:
    token = _load_token_or_die(args.token_file)
    api = SCMPApi(BASE_URL, token)

    name_q = quote(args.pipeline_name or "")
    path = (
        f"/ci/api/v2/groups/{quote(args.group)}/projects/{quote(args.project)}/services/{quote(args.service)}/pipelines"
        f"?pipelineName={name_q}&order=run_time&page=1&limit={int(args.limit)}"
    )
    resp = api.get_json(path)
    body = _require_ok(resp.body, context="pipelines list")
    result = body.get("result") or []
    if not isinstance(result, list):
        _die("pipelines list: result is not a list")
    print(json.dumps(result, indent=2, ensure_ascii=True))


def current_cmd(args: argparse.Namespace) -> None:
    token = _load_token_or_die(args.token_file)
    api = SCMPApi(BASE_URL, token)

    path = f"/ci/api/v2/groups/{quote(args.group)}/projects/{quote(args.project)}/services/{quote(args.service)}/pipelines/{quote(args.pipeline)}/currentPipelineRun"
    resp = api.get_json(path)
    body = _require_ok(resp.body, context="currentPipelineRun")
    result = body.get("result") or {}
    spec = (result.get("spec") or {}) if isinstance(result, dict) else {}
    params = spec.get("params") or []

    summary = {
        "service": args.service,
        "pipeline": args.pipeline,
        "Env": _extract_param(params, "Env"),
        "branch": _extract_param(params, "branch"),
        "tag": _extract_param(params, "tag"),
        "version": _extract_param(params, "version"),
        "DEPLOY": _extract_param(params, "DEPLOY"),
        "revision": _extract_param(params, "revision"),
    }
    print(json.dumps({"summary": summary, "raw": result}, indent=2, ensure_ascii=True))


def run_cmd(args: argparse.Namespace) -> None:
    token = _load_token_or_die(args.token_file)
    api = SCMPApi(BASE_URL, token)

    payload: Any = None

    if args.payload_file:
        try:
            with open(args.payload_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as e:
            _die(f"failed to read payload file: {e}")
    elif args.payload:
        try:
            payload = json.loads(args.payload)
        except Exception as e:
            _die(f"payload must be valid JSON: {e}")
    else:
        _die("provide --payload or --payload-file")

    if payload is None:
        _die("payload is empty")

    # Some SCMP endpoints expect parameters under `params` (name/value list).
    # If a payload uses `env`, normalize to also include `params`.
    if (
        isinstance(payload, dict)
        and "params" not in payload
        and isinstance(payload.get("env"), list)
    ):
        payload = {**payload, "params": payload.get("env")}

    # Some backends also expect a `start_params` list to persist param values.
    # The API error `cannot unmarshal object into ... []models.Param` indicates
    # `start_params` MUST be a list of {name,value}.
    if isinstance(payload, dict) and "start_params" not in payload:
        params_list = None
        if isinstance(payload.get("params"), list):
            params_list = payload.get("params")
        elif isinstance(payload.get("env"), list):
            params_list = payload.get("env")
        if isinstance(params_list, list) and params_list:
            payload = {**payload, "start_params": params_list}

    url = f"{BASE_URL}/ci/api/v2/groups/{quote(args.group)}/projects/{quote(args.project)}/services/{quote(args.service)}/pipelines/{quote(args.pipeline)}/run"
    if args.print_payload:
        print(
            json.dumps(
                {"run_url": url, "payload": payload}, indent=2, ensure_ascii=True
            )
        )
    resp = api.post_json(url, payload)
    if 200 <= resp.status < 300:
        print(json.dumps(resp.body, indent=2, ensure_ascii=True))
        return
    _die(f"run failed: http={resp.status} body={str(resp.body)[:400]}")


def deploy_cmd(args: argparse.Namespace) -> None:
    if getattr(args, "daily_login", True):
        _ensure_daily_login(
            args.token_file,
            share_id=getattr(args, "share_id", None),
            plain_password=bool(getattr(args, "plain_password", False)),
        )

    token = _load_token_or_die(args.token_file)
    api = SCMPApi(BASE_URL, token)

    # Interactive mode: ask for required/optional params.
    if args.interactive and _is_interactive():
        if not args.env:
            args.env = _prompt("Env (prod/test)", default="prod")
            if args.env not in ("prod", "test"):
                _die("invalid Env: must be prod or test")

        if not args.branch:
            args.branch = _prompt("Branch")
        if not args.branch:
            _die("branch is required")

        if not args.version:
            args.version = _prompt("Version")
        if not args.version:
            _die("version is required")

        use_defaults = _prompt_yes_no(
            "Use default values for tag/path/DEPLOY?",
            default=True,
        )
        if use_defaults:
            if args.tag is None:
                args.tag = ""
            if args.path is None:
                args.path = ""
            if args.deploy is None:
                args.deploy = True
        else:
            if args.tag is None:
                args.tag = _prompt("Tag", default="")
            if args.path is None:
                args.path = _prompt("Path", default="")
            if args.deploy is None:
                args.deploy = _prompt_yes_no("DEPLOY?", default=True)

    # Non-interactive safeguard.
    if not _is_interactive() and args.interactive:
        if not args.branch or not args.version or not args.env:
            _die(
                "non-interactive mode: provide --env/--branch/--version (and optional --tag/--path/--deploy)"
            )

    # 1) service -> git_url
    keyword_q = quote(args.service)
    svc_path = (
        "/larke-serving/api/v1/groups/FE/projects/fe/services"
        f"?group=FE&project=fe&keyword={keyword_q}&is_star=false&enable_page=true&page=1&limit=10"
    )
    svc = _require_ok(api.get_json(svc_path).body, context="service search")
    picked = _pick_best_service(svc.get("result") or [], args.service)
    git_url = ((picked.get("ci") or {}) if isinstance(picked, dict) else {}).get(
        "git_url"
    )

    # 2) pipelines -> pick first
    pl_path = (
        f"/ci/api/v2/groups/{quote(args.group)}/projects/{quote(args.project)}/services/{quote(args.service)}/pipelines"
        f"?pipelineName=&order=run_time&page=1&limit=12"
    )
    pls = _require_ok(api.get_json(pl_path).body, context="pipelines list")
    pl_result = pls.get("result") or []
    if not pl_result:
        _die("pipelines list: empty")
    pipeline_obj = pl_result[0] if isinstance(pl_result[0], dict) else {}
    pipeline_name = str(pipeline_obj.get("name"))

    # IMPORTANT: do NOT blindly follow pipeline labels.group.
    # Labels may reflect ownership/org and can differ from the path-based permission model,
    # causing `no group permission` if used in the request URL.
    ci_group = str(args.group)
    ci_project = str(args.project)

    # 3) currentPipelineRun -> infer defaults
    cur_path = f"/ci/api/v2/groups/{quote(ci_group)}/projects/{quote(ci_project)}/services/{quote(args.service)}/pipelines/{quote(pipeline_name)}/currentPipelineRun"
    cur_resp = api.get_json(cur_path)
    cur_body = cur_resp.body

    # Retry with FE/fe if the server says no group permission.
    if (
        isinstance(cur_body, dict)
        and cur_body.get("code") == 401001
        and ci_group != "FE"
    ):
        ci_group = "FE"
        ci_project = "fe"
        cur_path = f"/ci/api/v2/groups/{quote(ci_group)}/projects/{quote(ci_project)}/services/{quote(args.service)}/pipelines/{quote(pipeline_name)}/currentPipelineRun"
        cur_resp = api.get_json(cur_path)
        cur_body = cur_resp.body

    cur = _require_ok(cur_body, context="currentPipelineRun")
    result = cur.get("result") or {}
    spec = (result.get("spec") or {}) if isinstance(result, dict) else {}
    params = spec.get("params") or []

    inferred = {
        "Env": args.env or _extract_param(params, "Env"),
        "branch": args.branch or _extract_param(params, "branch"),
        "tag": args.tag
        if args.tag is not None
        else (_extract_param(params, "tag") or ""),
        "service": args.service or _extract_param(params, "service"),
        "version": args.version or _extract_param(params, "version"),
        "path": args.path
        if args.path is not None
        else (_extract_param(params, "path") or ""),
        "DEPLOY": bool(args.deploy if args.deploy is not None else True),
    }

    # 4) run
    params_list = [
        {"name": "Env", "value": inferred["Env"] or ""},
        {"name": "branch", "value": inferred["branch"] or ""},
        {"name": "tag", "value": inferred["tag"] or ""},
        {"name": "service", "value": inferred["service"] or ""},
        {"name": "version", "value": inferred["version"] or ""},
        {"name": "path", "value": inferred["path"] or ""},
        {"name": "DEPLOY", "value": inferred["DEPLOY"]},
    ]

    payload = {
        # Use `start_params` only to avoid backend merging duplicates from multiple fields.
        # NOTE: must be a list of {name,value} (Go expects []models.Param).
        "start_params": params_list,
        "timeout": "",
        "tolerations": [],
        "failed_debug": False,
        "node_selector": {},
    }

    run_url = f"{BASE_URL}/ci/api/v2/groups/{quote(ci_group)}/projects/{quote(ci_project)}/services/{quote(args.service)}/pipelines/{quote(pipeline_name)}/run"
    if args.print_payload:
        print(
            json.dumps(
                {"run_url": run_url, "payload": payload}, indent=2, ensure_ascii=True
            )
        )
    resp = api.post_json(run_url, payload)

    # Retry with FE/fe if the server says no group permission.
    if (
        isinstance(resp.body, dict)
        and resp.body.get("code") == 401001
        and ci_group != "FE"
    ):
        ci_group = "FE"
        ci_project = "fe"
        run_url = f"{BASE_URL}/ci/api/v2/groups/{quote(ci_group)}/projects/{quote(ci_project)}/services/{quote(args.service)}/pipelines/{quote(pipeline_name)}/run"
        if args.print_payload:
            print(
                json.dumps(
                    {"run_url": run_url, "payload": payload},
                    indent=2,
                    ensure_ascii=True,
                )
            )
        resp = api.post_json(run_url, payload)
    out = {
        "service": args.service,
        "pipeline": pipeline_name,
        "git_url": git_url,
        "inferred": inferred,
        "run_http": resp.status,
        "run_response": resp.body,
    }
    print(json.dumps(out, indent=2, ensure_ascii=True))
    if not (200 <= resp.status < 300):
        raise SystemExit(1)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="SCMP CLI (no UI)")
    p.add_argument(
        "--token-file",
        default=default_token_path(),
        help="Path to token file (stores authentication token only)",
    )

    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("login", help="login and save token")
    sp.add_argument("--share-id", help="SCMP share_id (or SCMP_SHARE_ID env)")
    sp.add_argument("--password", help="SCMP password (or SCMP_PASSWORD env)")
    sp.add_argument(
        "--plain-password",
        action="store_true",
        help="Prompt password with echo (PLAINTEXT). Also via env SCMP_PLAIN_PASSWORD=1",
    )
    sp.add_argument(
        "--prompt-password",
        action="store_true",
        help="Prompt for password (overrides --password/SCMP_PASSWORD)",
    )
    sp.add_argument("--no-save", action="store_true", help="Do not write token file")
    sp.set_defaults(func=login_cmd)

    sp = sub.add_parser("service", help="search service info")
    sp.add_argument("keyword", help="service keyword / name")
    sp.set_defaults(func=service_cmd)

    sp = sub.add_parser("pipelines", help="list pipelines for a service")
    sp.add_argument("service", help="service name")
    sp.add_argument("--group", default="FE", help="CI group (default: FE)")
    sp.add_argument("--project", default="fe", help="CI project (default: fe)")
    sp.add_argument("--pipeline-name", help="filter pipelineName")
    sp.add_argument("--limit", type=int, default=12)
    sp.set_defaults(func=pipelines_cmd)

    sp = sub.add_parser("current", help="get currentPipelineRun and infer params")
    sp.add_argument("service", help="service name")
    sp.add_argument("pipeline", help="pipeline name")
    sp.add_argument("--group", default="FE", help="CI group (default: FE)")
    sp.add_argument("--project", default="fe", help="CI project (default: fe)")
    sp.set_defaults(func=current_cmd)

    sp = sub.add_parser("run", help="trigger pipeline run")
    sp.add_argument("service", help="service name")
    sp.add_argument("pipeline", help="pipeline name")
    sp.add_argument("--group", default="FE", help="CI group (default: FE)")
    sp.add_argument("--project", default="fe", help="CI project (default: fe)")
    sp.add_argument("--payload", help="JSON string payload")
    sp.add_argument("--payload-file", help="JSON file payload")
    sp.add_argument(
        "--print-payload",
        action="store_true",
        help="Print resolved run URL + payload before posting",
    )
    sp.set_defaults(func=run_cmd)

    sp = sub.add_parser(
        "deploy", help="one-shot: service -> pipelines -> current -> run"
    )
    sp.add_argument("service", help="service name")
    sp.add_argument("--group", default="FE", help="CI group (default: FE)")
    sp.add_argument("--project", default="fe", help="CI project (default: fe)")
    sp.add_argument(
        "--interactive",
        action="store_true",
        default=True,
        help="Prompt for inputs (default: true)",
    )
    sp.add_argument(
        "--no-interactive",
        dest="interactive",
        action="store_false",
        help="Disable prompts; require flags",
    )
    sp.add_argument("--env", choices=["test", "prod"], help="Env")
    sp.add_argument("--branch", help="branch")
    sp.add_argument(
        "--tag",
        default=None,
        help="tag (default: empty; prompted in interactive mode)",
    )
    sp.add_argument("--version", help="version")
    sp.add_argument(
        "--path",
        default=None,
        help="path (default: empty; prompted in interactive mode)",
    )
    sp.add_argument(
        "--share-id",
        default=None,
        help="SCMP share_id (for daily login; or env SCMP_SHARE_ID)",
    )
    sp.add_argument(
        "--plain-password",
        action="store_true",
        help="Prompt password with echo during daily login (PLAINTEXT). Also via env SCMP_PLAIN_PASSWORD=1",
    )
    sp.add_argument(
        "--daily-login",
        dest="daily_login",
        action="store_true",
        default=True,
        help="每天第一次 deploy 前强制登录刷新 token (默认开启)",
    )
    sp.add_argument(
        "--no-daily-login",
        dest="daily_login",
        action="store_false",
        help="关闭每天首次强制登录",
    )
    sp.add_argument(
        "--print-payload",
        action="store_true",
        help="Print resolved run URL + payload before posting",
    )
    sp.add_argument(
        "--deploy",
        dest="deploy",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="set DEPLOY true/false",
    )
    sp.set_defaults(func=deploy_cmd)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
