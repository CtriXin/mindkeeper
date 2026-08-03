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
import subprocess
import sys
from datetime import datetime
from getpass import getpass
from typing import Any, Dict, List, NoReturn, Optional, Tuple
from urllib.parse import quote

from scmp_api import (
    SCMPApi,
    CredentialError,
    default_config_path,
    default_token_path,
    keychain_service_name,
    keychain_set_password,
    LoginError,
    load_token_file,
    login_and_get_token,
    redact_secret,
    resolve_scmp_credentials,
    save_scmp_config,
    save_token_file,
    ensure_daily_token,
)
from scmp_auth import add_auth_subcommands


BASE_URL = "https://scmp.adsconflux.xyz"


def _die(msg: str) -> NoReturn:
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


def _has_nonempty_path_from_history(params: List[Dict[str, Any]]) -> bool:
    """Check if last run had a non-empty path param."""
    path_val = _extract_param(params, "path")
    return path_val is not None and str(path_val).strip() != ""


def _get_pipeline_path_default(api: SCMPApi, group: str, project: str, service: str, pipeline_name: str) -> Optional[str]:
    """Get the default path value from pipeline start_params config."""
    path = f"/ci/api/v2/groups/{quote(group)}/projects/{quote(project)}/services/{quote(service)}/pipelines"
    path += f"?pipelineName={quote(pipeline_name)}&order=run_time&page=1&limit=1"
    resp = api.get_json(path)
    if not isinstance(resp.body, dict):
        return None
    result = resp.body.get("result") or []
    if not isinstance(result, list) or not result:
        return None
    pipeline_obj = result[0] if isinstance(result[0], dict) else {}
    start_params = pipeline_obj.get("start_params") or {}
    string_params = start_params.get("stringParameters") or []
    for p in string_params:
        if isinstance(p, dict) and str(p.get("name")) == "path":
            default_val = p.get("defaultValue")
            if default_val is not None and str(default_val).strip() != "":
                return str(default_val)
    return None


def login_cmd(args: argparse.Namespace) -> None:
    try:
        credentials = resolve_scmp_credentials(
            share_id=args.share_id,
            password=args.password,
            force_prompt_password=bool(args.prompt_password),
            plain_password=bool(args.plain_password or _bool_env("SCMP_PLAIN_PASSWORD")),
            context="login",
        )
        token = login_and_get_token(BASE_URL, credentials.share_id, credentials.password)
    except CredentialError as e:
        _die(str(e))
    except LoginError as e:
        _die(f"login failed: {e}")

    print(f"token={redact_secret(token)}")

    if args.save_credentials:
        try:
            service = keychain_service_name()
            save_scmp_config(share_id=credentials.share_id, keychain_service=service)
            keychain_set_password(credentials.share_id, credentials.password, service=service)
        except CredentialError as e:
            _die(str(e))
        print(f"saved_config_file={default_config_path()}")
        print(f"saved_keychain_service={service}")

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


def _mmddhhmm() -> str:
    return datetime.now().strftime("%m%d%H%M")


def _build_default_version(base_version: Optional[str]) -> str:
    base = (base_version or "version").strip()
    return f"{_mmddhhmm()}-{base}"


def _git_current_branch() -> Optional[str]:
    """Best-effort read current git branch from cwd."""
    try:
        p = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
        branch = (p.stdout or "").strip()
        if branch and branch != "HEAD":
            return branch
    except Exception:
        return None
    return None


def _git_repo_root() -> Optional[str]:
    try:
        p = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
        root = (p.stdout or "").strip()
        return root or None
    except Exception:
        return None


def _read_repo_field(filename: str) -> Optional[str]:
    root = _git_repo_root()
    if not root:
        return None
    fp = os.path.join(root, filename)
    try:
        if not os.path.isfile(fp):
            return None
        with open(fp, "r", encoding="utf-8") as f:
            val = (f.readline() or "").rstrip("\r\n")
        return val
    except Exception:
        return None


def _write_repo_field(filename: str, value: str) -> None:
    root = _git_repo_root()
    if not root:
        return
    fp = os.path.join(root, filename)
    try:
        with open(fp, "w", encoding="utf-8") as f:
            f.write(f"{value.strip()}\n")
    except Exception:
        pass


def _ensure_daily_login(
    token_file: str, *, share_id: Optional[str], plain_password: bool
) -> None:
    try:
        ensure_daily_token(
            BASE_URL,
            token_file=token_file,
            share_id=share_id,
            plain_password=plain_password,
        )
    except CredentialError as e:
        _die(str(e))


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
        "service": getattr(args, "service", None),
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


# ────────────────────────────────────────────────────────────────────────────
# W-02 predeploy receipt 硬门(2026-07-31 清算判决 D-010 / release-governance §一.1)
# dispatcher 编排退役后,发版唯一路径 = auditor predeploy receipt(绑最终 HEAD)
# → 本 CLI deploy → production receipt。底层入口必须自己强制,不能只靠上层 runner。
# ────────────────────────────────────────────────────────────────────────────
AUDITOR_CLI = os.environ.get(
    "AUDITOR_CLI", "/Users/xin/auto-skills/CtriXin-repo/auditor/scripts/auditor.py"
)


def _git_repo_root() -> str:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=False,
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def _git_sha(ref: str) -> str:
    proc = subprocess.run(
        ["git", "rev-parse", ref], capture_output=True, text=True, check=False
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def _discover_receipt(repo: str) -> Tuple[str, str]:
    """返回 (receipt, plan):优先 .ai/auditor/*/predeploy-receipt.json 最新者,plan 取同目录 plan.json。"""
    import glob
    cands = sorted(
        glob.glob(os.path.join(repo, ".ai", "auditor", "*", "predeploy-receipt.json")),
        key=os.path.getmtime,
        reverse=True,
    )
    for receipt in cands:
        plan = os.path.join(os.path.dirname(receipt), "plan.json")
        if os.path.isfile(plan):
            return receipt, plan
    return (cands[0], "") if cands else ("", "")


def _write_bypass_record(repo: str, args: argparse.Namespace, head: str) -> str:
    """--bypass-receipt 绕行落盘(waiver 四元组口径:跳过什么/为什么/保留什么/谁批)。"""
    gate_dir = os.path.join(repo, ".gate")
    os.makedirs(gate_dir, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    record = {
        "schema": "scmp.deploy.receipt-bypass.v1",
        "at": stamp,
        "skipped": "W-02 auditor predeploy receipt gate (scmp_cli.py deploy)",
        "reason": args.bypass_receipt,
        "retained": "底层 pipeline run 记录 + 本文件留痕;postdeploy 验证与 production receipt 义务不免除",
        "approved_by": os.environ.get("SCMP_OPERATOR") or os.environ.get("USER") or "unknown",
        "service": getattr(args, "service", None),
        "version": getattr(args, "version", None),
        "branch": getattr(args, "branch", None),
        "head": head,
    }
    path = os.path.join(gate_dir, f"deploy-receipt-bypass-{stamp}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(record, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def _predeploy_receipt_guard(args: argparse.Namespace, inferred: Dict[str, Any]) -> None:
    """prod + DEPLOY=true 的发版必须先过 auditor predeploy receipt(绑部署 HEAD)。"""
    if str(inferred.get("Env") or "").lower() != "prod" or not inferred.get("DEPLOY"):
        return  # test 环境 / build-only 不强制(发版才锁)
    repo = _git_repo_root()
    if not repo:
        _die("W-02: 无法定位 git repo —— 请在目标服务 repo 内运行 deploy,或显式 --bypass-receipt <理由>")
    branch = str(inferred.get("branch") or "")
    head = _git_sha(branch) or _git_sha("HEAD")
    if not head:
        _die("W-02: 无法解析部署分支 HEAD")

    if getattr(args, "bypass_receipt", None):
        path = _write_bypass_record(repo, args, head)
        print(f"⚠ W-02 bypass: 显式跳过 predeploy receipt 硬门,留痕 → {path}")
        return

    receipt = getattr(args, "predeploy_receipt", "") or ""
    plan = getattr(args, "predeploy_plan", "") or ""
    if not receipt:
        receipt, discovered_plan = _discover_receipt(repo)
        plan = plan or discovered_plan
    if not receipt or not os.path.isfile(receipt):
        _die(
            "W-02: 未找到 auditor predeploy receipt(.ai/auditor/*/predeploy-receipt.json)。\n"
            "  发版路径: 先跑 auditor predeploy 在最终 HEAD 上出 receipt,再 deploy。\n"
            "  确需绕行: --bypass-receipt '<理由>'(落盘 .gate/deploy-receipt-bypass-*.json)"
        )
    if not plan or not os.path.isfile(plan):
        _die(f"W-02: receipt 对应 plan.json 缺失: {plan or '(未提供)'}")
    if not os.path.isfile(AUDITOR_CLI):
        _die(f"W-02: auditor CLI 缺失: {AUDITOR_CLI}(设 AUDITOR_CLI 环境变量覆盖)")

    cmd = [
        sys.executable, AUDITOR_CLI, "verify",
        "--plan", plan,
        "--receipt", receipt,
        "--stage", "predeploy",
        "--expect-head", head,
        "--max-age-sec", str(getattr(args, "receipt_max_age_sec", 3600)),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
    if proc.returncode != 0:
        tail = (proc.stdout + proc.stderr).strip()[-600:]
        _die(
            f"W-02: predeploy receipt 校验失败(HEAD={head[:12]}, receipt={receipt})。\n{tail}\n"
            "  receipt 过期/HEAD 漂移 → 在最终部署 HEAD 上重跑 auditor predeploy;\n"
            "  确需绕行: --bypass-receipt '<理由>'(落盘留痕)"
        )
    print(f"✅ W-02: predeploy receipt 校验通过(HEAD={head[:12]}, {os.path.basename(receipt)})")


def deploy_cmd(args: argparse.Namespace) -> None:
    if getattr(args, "daily_login", True):
        _ensure_daily_login(
            args.token_file,
            share_id=getattr(args, "share_id", None),
            plain_password=bool(getattr(args, "plain_password", False)),
        )

    token = _load_token_or_die(args.token_file)
    api = SCMPApi(BASE_URL, token)
    current_git_branch = _git_current_branch()
    saved_path = _read_repo_field(".deploy-path")

    # Interactive mode: ask for required/optional params.
    if args.interactive and _is_interactive():
        if not args.env:
            args.env = _prompt("Env (prod/test)", default="prod")
            if args.env not in ("prod", "test"):
                _die("invalid Env: must be prod or test")

        if not args.branch:
            args.branch = _prompt("Branch", default=current_git_branch)

        if not args.version:
            args.version = _prompt(
                "Version",
                default=_build_default_version(args.branch),
            )

        if args.path is None:
            path_default_display = (
                str(saved_path)
                if (saved_path is not None and str(saved_path).strip() != "")
                else "无"
            )
            path_input = _prompt("Path", default=path_default_display).strip()
            if path_input == "无":
                path_input = ""
            # 如果用户留空，保持 args.path=None，让后续逻辑使用 pipeline 默认值
            if path_input:
                args.path = path_input

        use_defaults = _prompt_yes_no(
            "Use default values for tag/path/DEPLOY?",
            default=True,
        )
        if use_defaults:
            if args.tag is None:
                args.tag = ""
            # args.path 保持 None，让后续 inferred 逻辑处理（可使用 pipeline 默认值）
            if args.deploy is None:
                args.deploy = True
        else:
            if args.tag is None:
                args.tag = _prompt("Tag", default="")
            # args.path 保持 None，让后续 inferred 逻辑处理
            if args.deploy is None:
                args.deploy = _prompt_yes_no("DEPLOY?", default=True)

    # Non-interactive safeguard.
    if not _is_interactive() and args.interactive:
        if not args.env:
            _die(
                "non-interactive mode: provide --env (and optionally --branch/--version/--tag/--path/--deploy)"
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

    # Get pipeline default path from config (fallback for new projects)
    pipeline_default_path = _get_pipeline_path_default(api, ci_group, ci_project, args.service, pipeline_name)

    # Detect if this project typically needs a path (based on last run)
    needs_path_hint = _has_nonempty_path_from_history(params)
    # Only error out if NO path is available from any source.
    path_from_history = _extract_param(params, "path")
    if needs_path_hint and not args.path and not saved_path and not path_from_history and not pipeline_default_path:
        if _is_interactive():
            print(f"\n[提示] 该项目需要 path 参数，但无法从任何来源获取默认值")
        else:
            _die("该项目需要 path 参数，但在非交互模式下未提供。请使用 --path 指定")

    inferred = {
        "Env": args.env or _extract_param(params, "Env"),
        "branch": args.branch or _extract_param(params, "branch"),
        "tag": args.tag
        if args.tag is not None
        else (_extract_param(params, "tag") or ""),
        "service": args.service or _extract_param(params, "service"),
        "version": args.version or _extract_param(params, "version"),
        "path": (
            args.path
            if args.path is not None
            else (
                saved_path
                if saved_path is not None
                else (
                    path_from_history
                    if path_from_history
                    else (pipeline_default_path or "")
                )
            )
        ),
        "DEPLOY": bool(args.deploy if args.deploy is not None else True),
    }

    if not inferred["version"]:
        inferred["version"] = _build_default_version(_extract_param(params, "version"))

    if inferred["path"]:
        _write_repo_field(".deploy-path", str(inferred["path"]))

    # 3.5) W-02 predeploy receipt 硬门(prod 发版强制,见函数 docstring)
    _predeploy_receipt_guard(args, inferred)

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

    # If backend requires non-empty path, fallback to manual input once.
    if (
        not (200 <= resp.status < 300)
        and _is_interactive()
        and str(inferred.get("path") or "") == ""
        and isinstance(resp.body, dict)
    ):
        message_text = str(resp.body.get("message") or "").lower()
        body_text = json.dumps(resp.body, ensure_ascii=False).lower()
        if "path" in message_text or "path" in body_text:
            manual_path = _prompt("Path (required by backend)", default="")
            if manual_path.strip():
                inferred["path"] = manual_path.strip()
                for item in params_list:
                    if item.get("name") == "path":
                        item["value"] = inferred["path"]
                        break
                resp = api.post_json(run_url, payload)

    out = {
        "service": getattr(args, "service", None),
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
    sp.add_argument(
        "--save-credentials",
        action="store_true",
        help="Save share_id to global config and password to macOS Keychain after login",
    )
    sp.set_defaults(func=login_cmd)

    add_auth_subcommands(sub, base_url=BASE_URL)

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
    sp.add_argument("--predeploy-receipt", default="",
                    help="W-02: auditor predeploy receipt 路径(默认自动发现 .ai/auditor/*/predeploy-receipt.json)")
    sp.add_argument("--predeploy-plan", default="",
                    help="W-02: receipt 对应 plan.json(默认取 receipt 同目录)")
    sp.add_argument("--receipt-max-age-sec", type=int, default=3600,
                    help="W-02: receipt 最大接受年龄秒数(默认 3600)")
    sp.add_argument("--bypass-receipt", metavar="REASON", default="",
                    help="W-02: 显式跳过 receipt 硬门并把理由落盘 .gate/(留痕,勿当常态)")
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
