#!/usr/bin/env python3
"""Export/import CRS OAuth accounts without re-running OAuth.

Supports:
- OpenAI
- Claude
- both platforms in one bundle
- export / import / migrate
- optional gzip-compressed bundle output

Default platform stays `openai` for backward compatibility.
"""

from __future__ import annotations

import argparse
import getpass
import gzip
import json
import os
import subprocess
import sys
import textwrap
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_CONTAINER = "claude-relay-service-claude-relay-1"
OPENAI = "openai"
CLAUDE = "claude"
BOTH = "both"
PLATFORMS = (OPENAI, CLAUDE)


class CliError(RuntimeError):
    pass


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=False)


def _normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def _selected_platforms(platform: str) -> list[str]:
    if platform == BOTH:
        return list(PLATFORMS)
    return [platform]


def _http_json(
    url: str,
    *,
    method: str = "GET",
    data: Any | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> Any:
    payload = None
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    if data is not None:
        payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise CliError(f"HTTP {exc.code} {method} {url}\n{body}") from exc
    except urllib.error.URLError as exc:
        raise CliError(f"Request failed: {method} {url}\n{exc}") from exc


def _resolve_admin_password(args: argparse.Namespace) -> str:
    password = args.admin_pass or os.environ.get("CRS_ADMIN_PASSWORD")
    if password:
        return password
    return getpass.getpass("CRS admin password: ")


def _resolve_admin_username(args: argparse.Namespace) -> str:
    return args.admin_user or os.environ.get("CRS_ADMIN_USERNAME") or "admin"


def _admin_login(base_url: str, username: str, password: str) -> str:
    res = _http_json(
        f"{_normalize_base_url(base_url)}/web/auth/login",
        method="POST",
        data={"username": username, "password": password},
    )
    token = (res or {}).get("token")
    if not token:
        raise CliError(f"Admin login failed: {_json_dumps(res)}")
    return token


def _admin_list_accounts(base_url: str, token: str, platform: str) -> list[dict[str, Any]]:
    route = "openai-accounts" if platform == OPENAI else "claude-accounts"
    res = _http_json(
        f"{_normalize_base_url(base_url)}/admin/{route}",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = (res or {}).get("data")
    if not isinstance(data, list):
        raise CliError(f"Unexpected account list response for {platform}: {_json_dumps(res)}")
    return data


def _admin_create_account(
    base_url: str, token: str, platform: str, payload: dict[str, Any], *, timeout: int = 120
) -> dict[str, Any]:
    route = "openai-accounts" if platform == OPENAI else "claude-accounts"
    res = _http_json(
        f"{_normalize_base_url(base_url)}/admin/{route}",
        method="POST",
        data=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    data = (res or {}).get("data")
    if not isinstance(data, dict):
        raise CliError(f"Unexpected create response for {platform}: {_json_dumps(res)}")
    return data


def _admin_update_account(
    base_url: str, token: str, platform: str, account_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    route = "openai-accounts" if platform == OPENAI else "claude-accounts"
    res = _http_json(
        f"{_normalize_base_url(base_url)}/admin/{route}/{account_id}",
        method="PUT",
        data=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
    )
    data = (res or {}).get("data")
    return data if isinstance(data, dict) else {"id": account_id}


def _write_bundle(bundle: dict[str, Any], path: str, compress: bool) -> None:
    text = _json_dumps(bundle) + "\n"
    if compress or path.endswith(".gz"):
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(text)
    else:
        Path(path).write_text(text)


def _read_bundle(path: str) -> dict[str, Any]:
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = json.loads(Path(path).read_text())
    if not isinstance(data, dict):
        raise CliError(f"Invalid bundle file: {path}")
    if "platforms" not in data:
        # backward compatibility with old OpenAI-only bundle
        accounts = data.get("accounts")
        if not isinstance(accounts, list):
            raise CliError(f"Invalid bundle file: {path}")
        data = {
            "version": data.get("version", 1),
            "exportedAt": data.get("exportedAt"),
            "platforms": {OPENAI: accounts},
            "missing": data.get("missing", []),
        }
    return data


def _apply_name_transform(name: str, prefix: str, suffix: str) -> str:
    return f"{prefix}{name}{suffix}"


def _run_remote_export(
    ssh_target: str,
    container: str,
    *,
    platform: str,
    account_ids: list[str],
    account_names: list[str],
    export_all: bool,
) -> dict[str, Any]:
    selectors = {
        "ids": account_ids,
        "names": account_names,
        "all": export_all,
    }
    platforms = _selected_platforms(platform)
    start_marker = "__CRS_ACCOUNT_EXPORT_JSON_START__"
    end_marker = "__CRS_ACCOUNT_EXPORT_JSON_END__"
    js = textwrap.dedent(
        f"""
        const openaiService = require('/app/src/services/account/openaiAccountService');
        const claudeService = require('/app/src/services/account/claudeAccountService');
        const redis = require('/app/src/models/redis');

        const selectors = {json.dumps(selectors, ensure_ascii=False)};
        const platforms = {json.dumps(platforms)};

        function boolish(v, defaultValue) {{
          if (v === undefined || v === null || v === '') return defaultValue;
          if (typeof v === 'boolean') return v;
          return String(v) === 'true';
        }}

        function parseJsonMaybe(v, fallback) {{
          if (!v) return fallback;
          if (typeof v === 'object') return v;
          try {{ return JSON.parse(v); }} catch (e) {{ return fallback; }}
        }}

        function parseScopes(v) {{
          if (!v || typeof v !== 'string' || !v.trim()) return [];
          return v.split(' ');
        }}

        function matchesFromList(list) {{
          const byId = new Map(list.map((a) => [a.id, a]));
          const byName = new Map();
          for (const account of list) {{
            const key = String(account.name || '').toLowerCase();
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push(account);
          }}
          const resolvedIds = [];
          const missing = [];
          if (selectors.all) {{
            resolvedIds.push(...list.map((a) => a.id));
          }} else {{
            for (const accountId of selectors.ids || []) {{
              if (byId.has(accountId)) resolvedIds.push(accountId);
              else missing.push({{ type: 'id', value: accountId }});
            }}
            for (const accountName of selectors.names || []) {{
              const matches = byName.get(String(accountName).toLowerCase()) || [];
              if (matches.length === 0) {{
                missing.push({{ type: 'name', value: accountName }});
              }} else {{
                resolvedIds.push(...matches.map((a) => a.id));
              }}
            }}
          }}
          return {{ ids: Array.from(new Set(resolvedIds)), missing }};
        }}

        async function exportOpenAI() {{
          const all = await openaiService.getAllAccounts();
          const match = matchesFromList(all);
          const client = redis.getClientSafe();
          const exported = [];
          for (const accountId of match.ids) {{
            const account = await openaiService.getAccount(accountId);
            if (!account) {{
              match.missing.push({{ type: 'id', value: accountId }});
              continue;
            }}
            const raw = await client.hgetall(`openai:account:${{accountId}}`);
            const accessToken = raw?.accessToken ? openaiService.decrypt(raw.accessToken) : '';
            const oauth = account.openaiOauth && typeof account.openaiOauth === 'object'
              ? {{ ...account.openaiOauth }}
              : {{}};
            if (!oauth.accessToken && accessToken) oauth.accessToken = accessToken;
            if (!oauth.refreshToken && account.refreshToken) oauth.refreshToken = account.refreshToken;
            if (!oauth.idToken && account.idToken) oauth.idToken = account.idToken;

            exported.push({{
              sourceId: account.id,
              platform: 'openai',
              name: account.name,
              description: account.description || '',
              accountType: account.accountType || 'shared',
              priority: Number(account.priority || 50),
              rateLimitDuration: Number(account.rateLimitDuration || 60),
              isActive: boolish(account.isActive, true),
              schedulable: boolish(account.schedulable, true),
              disableAutoProtection: boolish(account.disableAutoProtection, false),
              subscriptionExpiresAt: account.subscriptionExpiresAt || null,
              proxy: account.proxy || null,
              accountInfo: {{
                accountId: account.accountId || '',
                chatgptUserId: account.chatgptUserId || '',
                organizationId: account.organizationId || '',
                organizationRole: account.organizationRole || '',
                organizationTitle: account.organizationTitle || '',
                planType: account.planType || '',
                email: account.email || '',
                emailVerified: boolish(account.emailVerified, false),
              }},
              openaiOauth: oauth,
            }});
          }}
          return {{ accounts: exported, missing: match.missing }};
        }}

        async function exportClaude() {{
          const all = await claudeService.getAllAccounts();
          const match = matchesFromList(all);
          const exported = [];
          for (const accountId of match.ids) {{
            const raw = await redis.getClaudeAccount(accountId);
            if (!raw || Object.keys(raw).length === 0) {{
              match.missing.push({{ type: 'id', value: accountId }});
              continue;
            }}
            const oauth = raw.claudeAiOauth
              ? parseJsonMaybe(claudeService._decryptSensitiveData(raw.claudeAiOauth), null)
              : null;
            const refreshToken = raw.refreshToken
              ? claudeService._decryptSensitiveData(raw.refreshToken)
              : '';
            const email = raw.email ? claudeService._decryptSensitiveData(raw.email) : '';
            const proxy = parseJsonMaybe(raw.proxy, null);
            const subscriptionInfo = parseJsonMaybe(raw.subscriptionInfo, null);
            const extInfo = parseJsonMaybe(raw.extInfo, null);

            exported.push({{
              sourceId: raw.id,
              platform: 'claude',
              name: raw.name,
              description: raw.description || '',
              email,
              accountType: raw.accountType || 'shared',
              priority: Number(raw.priority || 50),
              isActive: boolish(raw.isActive, true),
              schedulable: boolish(raw.schedulable, true),
              proxy,
              claudeAiOauth: oauth,
              refreshToken,
              scopes: parseScopes(raw.scopes),
              status: raw.status || '',
              subscriptionInfo,
              subscriptionExpiresAt: raw.subscriptionExpiresAt || null,
              autoStopOnWarning: boolish(raw.autoStopOnWarning, false),
              useUnifiedUserAgent: boolish(raw.useUnifiedUserAgent, false),
              useUnifiedClientId: boolish(raw.useUnifiedClientId, false),
              unifiedClientId: raw.unifiedClientId || '',
              extInfo,
              maxConcurrency: Number(raw.maxConcurrency || 0),
              interceptWarmup: boolish(raw.interceptWarmup, false),
              disableTempUnavailable: boolish(raw.disableTempUnavailable, false),
              tempUnavailable503TtlSeconds: raw.tempUnavailable503TtlSeconds === '' ? null : Number(raw.tempUnavailable503TtlSeconds || 0),
              tempUnavailable5xxTtlSeconds: raw.tempUnavailable5xxTtlSeconds === '' ? null : Number(raw.tempUnavailable5xxTtlSeconds || 0),
            }});
          }}
          return {{ accounts: exported, missing: match.missing }};
        }}

        async function main() {{
          await redis.connect();
          const out = {{
            version: 2,
            exportedAt: new Date().toISOString(),
            selectors,
            platforms: {{}},
            missing: [],
          }};

          if (platforms.includes('openai')) {{
            const openai = await exportOpenAI();
            out.platforms.openai = openai.accounts;
            out.missing.push(...openai.missing.map((item) => ({{ platform: 'openai', ...item }})));
          }}
          if (platforms.includes('claude')) {{
            const claude = await exportClaude();
            out.platforms.claude = claude.accounts;
            out.missing.push(...claude.missing.map((item) => ({{ platform: 'claude', ...item }})));
          }}

          process.stdout.write('{start_marker}' + JSON.stringify(out) + '{end_marker}');
          process.exit(0);
        }}

        main().catch((error) => {{
          console.error(error?.stack || String(error));
          process.exit(1);
        }});
        """
    ).strip()

    cmd = [
        "ssh",
        ssh_target,
        "docker",
        "exec",
        "-e",
        "LOG_LEVEL=error",
        "-i",
        container,
        "node",
        "-",
    ]
    proc = subprocess.run(cmd, input=js, text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        raise CliError(f"Remote export failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
    start = proc.stdout.find(start_marker)
    end = proc.stdout.rfind(end_marker)
    if start == -1 or end == -1 or end < start:
        raise CliError(f"Remote export returned no marked JSON payload:\n{proc.stdout}")
    payload = proc.stdout[start + len(start_marker) : end]
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise CliError(f"Remote export returned invalid JSON:\n{payload}") from exc


def _import_openai_accounts(
    *,
    base_url: str,
    token: str,
    accounts: list[dict[str, Any]],
    name_prefix: str,
    name_suffix: str,
    force_account_type: str | None,
    skip_existing: bool,
    dry_run: bool,
) -> dict[str, Any]:
    existing = _admin_list_accounts(base_url, token, OPENAI)
    existing_by_name = {str(item.get("name", "")): item for item in existing}
    summary = {"created": [], "skipped": [], "planned": []}

    for account in accounts:
        final_name = _apply_name_transform(account["name"], name_prefix, name_suffix)
        if skip_existing and final_name in existing_by_name:
            summary["skipped"].append(
                {
                    "platform": OPENAI,
                    "name": final_name,
                    "reason": "name_exists",
                    "existingId": existing_by_name[final_name].get("id"),
                    "sourceId": account.get("sourceId"),
                }
            )
            continue

        create_payload = {
            "name": final_name,
            "description": account.get("description") or "",
            "accountType": force_account_type or account.get("accountType") or "shared",
            "priority": account.get("priority", 50),
            "rateLimitDuration": account.get("rateLimitDuration", 60),
            "openaiOauth": account.get("openaiOauth") or {},
            "accountInfo": account.get("accountInfo") or {},
            "proxy": account.get("proxy"),
            "needsImmediateRefresh": False,
            "requireRefreshSuccess": False,
        }
        update_payload = {
            "schedulable": account.get("schedulable", True),
            "isActive": account.get("isActive", True),
            "disableAutoProtection": account.get("disableAutoProtection", False),
            "subscriptionExpiresAt": account.get("subscriptionExpiresAt"),
        }

        if dry_run:
            summary["planned"].append(
                {
                    "platform": OPENAI,
                    "name": final_name,
                    "sourceId": account.get("sourceId"),
                    "createPayload": create_payload,
                    "updatePayload": update_payload,
                }
            )
            continue

        created = _admin_create_account(base_url, token, OPENAI, create_payload)
        clean_update = {k: v for k, v in update_payload.items() if v is not None and v != ""}
        if clean_update:
            _admin_update_account(base_url, token, OPENAI, created["id"], clean_update)
        summary["created"].append(
            {
                "platform": OPENAI,
                "name": final_name,
                "sourceId": account.get("sourceId"),
                "targetId": created.get("id"),
            }
        )
    return summary


def _import_claude_accounts(
    *,
    base_url: str,
    token: str,
    accounts: list[dict[str, Any]],
    name_prefix: str,
    name_suffix: str,
    force_account_type: str | None,
    skip_existing: bool,
    dry_run: bool,
) -> dict[str, Any]:
    existing = _admin_list_accounts(base_url, token, CLAUDE)
    existing_by_name = {str(item.get("name", "")): item for item in existing}
    summary = {"created": [], "skipped": [], "planned": []}

    for account in accounts:
        final_name = _apply_name_transform(account["name"], name_prefix, name_suffix)
        if skip_existing and final_name in existing_by_name:
            summary["skipped"].append(
                {
                    "platform": CLAUDE,
                    "name": final_name,
                    "reason": "name_exists",
                    "existingId": existing_by_name[final_name].get("id"),
                    "sourceId": account.get("sourceId"),
                }
            )
            continue

        create_payload = {
            "name": final_name,
            "description": account.get("description") or "",
            "email": account.get("email") or "",
            "refreshToken": account.get("refreshToken") or "",
            "claudeAiOauth": account.get("claudeAiOauth"),
            "proxy": account.get("proxy"),
            "accountType": force_account_type or account.get("accountType") or "shared",
            "platform": "claude",
            "priority": account.get("priority", 50),
            "autoStopOnWarning": account.get("autoStopOnWarning", False),
            "useUnifiedUserAgent": account.get("useUnifiedUserAgent", False),
            "useUnifiedClientId": account.get("useUnifiedClientId", False),
            "unifiedClientId": account.get("unifiedClientId") or "",
            "expiresAt": account.get("subscriptionExpiresAt"),
            "extInfo": account.get("extInfo"),
            "maxConcurrency": account.get("maxConcurrency", 0),
            "interceptWarmup": account.get("interceptWarmup", False),
            "disableTempUnavailable": account.get("disableTempUnavailable", False),
            "tempUnavailable503TtlSeconds": account.get("tempUnavailable503TtlSeconds"),
            "tempUnavailable5xxTtlSeconds": account.get("tempUnavailable5xxTtlSeconds"),
        }
        update_payload = {
            "schedulable": account.get("schedulable", True),
            "isActive": account.get("isActive", True),
        }
        if account.get("subscriptionInfo") is not None:
            update_payload["subscriptionInfo"] = account.get("subscriptionInfo")

        if dry_run:
            summary["planned"].append(
                {
                    "platform": CLAUDE,
                    "name": final_name,
                    "sourceId": account.get("sourceId"),
                    "createPayload": create_payload,
                    "updatePayload": update_payload,
                }
            )
            continue

        created = _admin_create_account(base_url, token, CLAUDE, create_payload)
        clean_update = {k: v for k, v in update_payload.items() if v is not None and v != ""}
        if clean_update:
            _admin_update_account(base_url, token, CLAUDE, created["id"], clean_update)
        summary["created"].append(
            {
                "platform": CLAUDE,
                "name": final_name,
                "sourceId": account.get("sourceId"),
                "targetId": created.get("id"),
            }
        )
    return summary


def _import_accounts(
    *,
    base_url: str,
    username: str,
    password: str,
    bundle: dict[str, Any],
    platform: str,
    name_prefix: str,
    name_suffix: str,
    force_account_type: str | None,
    skip_existing: bool,
    dry_run: bool,
) -> dict[str, Any]:
    token = _admin_login(base_url, username, password)
    summary = {"openai": None, "claude": None}
    selected = _selected_platforms(platform)
    platforms_block = bundle.get("platforms") or {}

    if OPENAI in selected:
        summary["openai"] = _import_openai_accounts(
            base_url=base_url,
            token=token,
            accounts=platforms_block.get(OPENAI, []),
            name_prefix=name_prefix,
            name_suffix=name_suffix,
            force_account_type=force_account_type,
            skip_existing=skip_existing,
            dry_run=dry_run,
        )
    if CLAUDE in selected:
        summary["claude"] = _import_claude_accounts(
            base_url=base_url,
            token=token,
            accounts=platforms_block.get(CLAUDE, []),
            name_prefix=name_prefix,
            name_suffix=name_suffix,
            force_account_type=force_account_type,
            skip_existing=skip_existing,
            dry_run=dry_run,
        )
    return summary


def cmd_export(args: argparse.Namespace) -> int:
    bundle = _run_remote_export(
        args.ssh,
        args.container,
        platform=args.platform,
        account_ids=args.account_id,
        account_names=args.account_name,
        export_all=args.all,
    )
    if args.out:
        _write_bundle(bundle, args.out, args.compress)
        total = sum(len(bundle.get("platforms", {}).get(p, [])) for p in _selected_platforms(args.platform))
        print(f"Wrote {total} account(s) to {args.out}")
    else:
        print(_json_dumps(bundle))
    if bundle.get("missing"):
        print(f"Missing selectors: {len(bundle['missing'])}", file=sys.stderr)
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    bundle = _read_bundle(args.input)
    summary = _import_accounts(
        base_url=args.target_base_url,
        username=_resolve_admin_username(args),
        password=_resolve_admin_password(args),
        bundle=bundle,
        platform=args.platform,
        name_prefix=args.name_prefix,
        name_suffix=args.name_suffix,
        force_account_type=args.force_account_type,
        skip_existing=args.skip_existing,
        dry_run=args.dry_run,
    )
    print(_json_dumps(summary))
    return 0


def cmd_migrate(args: argparse.Namespace) -> int:
    bundle = _run_remote_export(
        args.ssh,
        args.container,
        platform=args.platform,
        account_ids=args.account_id,
        account_names=args.account_name,
        export_all=args.all,
    )
    if args.out:
        _write_bundle(bundle, args.out, args.compress)
    summary = _import_accounts(
        base_url=args.target_base_url,
        username=_resolve_admin_username(args),
        password=_resolve_admin_password(args),
        bundle=bundle,
        platform=args.platform,
        name_prefix=args.name_prefix,
        name_suffix=args.name_suffix,
        force_account_type=args.force_account_type,
        skip_existing=args.skip_existing,
        dry_run=args.dry_run,
    )
    result = {
        "bundle": {
            "platforms": {k: len(v) for k, v in (bundle.get("platforms") or {}).items()},
            "missing": bundle.get("missing", []),
            "out": args.out,
        },
        "import": summary,
    }
    print(_json_dumps(result))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export/import CRS OpenAI/Claude OAuth accounts without re-running OAuth."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add_selector_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("--account-id", action="append", default=[], help="Source account id")
        p.add_argument("--account-name", action="append", default=[], help="Source account name")
        p.add_argument("--all", action="store_true", help="Export all accounts in selected platform(s)")

    def add_common_platform_arg(p: argparse.ArgumentParser, *, default: str) -> None:
        p.add_argument(
            "--platform",
            choices=[OPENAI, CLAUDE, BOTH],
            default=default,
            help="Account platform to handle",
        )

    export_p = sub.add_parser("export", help="Export accounts from source CRS over SSH")
    export_p.add_argument("--ssh", required=True, help="SSH target for source CRS, e.g. root@host")
    export_p.add_argument("--container", default=DEFAULT_CONTAINER, help="CRS docker container name")
    export_p.add_argument("--out", help="Output bundle path; .gz suffix or --compress writes gzip")
    export_p.add_argument("--compress", action="store_true", help="Gzip-compress the output bundle")
    add_common_platform_arg(export_p, default=OPENAI)
    add_selector_args(export_p)
    export_p.set_defaults(func=cmd_export)

    import_p = sub.add_parser("import", help="Import accounts into target CRS via admin API")
    import_p.add_argument("--input", required=True, help="Exported JSON or JSON.gz bundle")
    import_p.add_argument("--target-base-url", required=True, help="Target CRS base URL, e.g. http://127.0.0.1:3000")
    import_p.add_argument("--admin-user", help="Target CRS admin username; defaults to $CRS_ADMIN_USERNAME or 'admin'")
    import_p.add_argument("--admin-pass", help="Target CRS admin password; defaults to $CRS_ADMIN_PASSWORD or prompt")
    import_p.add_argument("--name-prefix", default="", help="Prefix added to imported account names")
    import_p.add_argument("--name-suffix", default="", help="Suffix added to imported account names")
    import_p.add_argument(
        "--force-account-type",
        choices=["shared", "dedicated", "group"],
        help="Override imported accountType on target",
    )
    import_p.add_argument("--skip-existing", action=argparse.BooleanOptionalAction, default=True, help="Skip accounts when the target name already exists")
    import_p.add_argument("--dry-run", action="store_true", help="Do not create accounts; print planned payloads")
    add_common_platform_arg(import_p, default=BOTH)
    import_p.set_defaults(func=cmd_import)

    migrate_p = sub.add_parser("migrate", help="Export from source and import into target in one run")
    migrate_p.add_argument("--ssh", required=True, help="SSH target for source CRS, e.g. root@host")
    migrate_p.add_argument("--container", default=DEFAULT_CONTAINER, help="CRS docker container name")
    migrate_p.add_argument("--target-base-url", required=True, help="Target CRS base URL, e.g. http://127.0.0.1:3000")
    migrate_p.add_argument("--admin-user", help="Target CRS admin username; defaults to $CRS_ADMIN_USERNAME or 'admin'")
    migrate_p.add_argument("--admin-pass", help="Target CRS admin password; defaults to $CRS_ADMIN_PASSWORD or prompt")
    migrate_p.add_argument("--name-prefix", default="", help="Prefix added to imported account names")
    migrate_p.add_argument("--name-suffix", default="", help="Suffix added to imported account names")
    migrate_p.add_argument(
        "--force-account-type",
        choices=["shared", "dedicated", "group"],
        help="Override imported accountType on target",
    )
    migrate_p.add_argument("--skip-existing", action=argparse.BooleanOptionalAction, default=True, help="Skip accounts when the target name already exists")
    migrate_p.add_argument("--dry-run", action="store_true", help="Do not create accounts; print planned payloads")
    migrate_p.add_argument("--out", help="Optional bundle path; .gz suffix or --compress writes gzip")
    migrate_p.add_argument("--compress", action="store_true", help="Gzip-compress the output bundle")
    add_common_platform_arg(migrate_p, default=BOTH)
    add_selector_args(migrate_p)
    migrate_p.set_defaults(func=cmd_migrate)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if getattr(args, "command", None) in {"export", "migrate"}:
        if not args.all and not args.account_id and not args.account_name:
            parser.error("one of --all / --account-id / --account-name is required")
    try:
        return args.func(args)
    except CliError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
