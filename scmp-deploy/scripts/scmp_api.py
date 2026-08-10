#!/usr/bin/env python3
"""SCMP HTTP API helpers.

This module is intentionally dependency-free (stdlib only).

Auth:
- SCMP web UI appears to use a JWT-like token sent via a custom header: `authentication`.
- The existing Playwright automation saves `storage_state` to JSON (see `--session-path`).
  That file can include localStorage entries; we try to extract the token from there.
- You can also override with env var `SCMP_AUTHENTICATION`.
"""

from __future__ import annotations

import json
import os
import re
import socket
import stat
import time
import ssl
import subprocess
import urllib.error
import urllib.request
import sys
from getpass import getpass
from datetime import datetime
from dataclasses import dataclass
from urllib.parse import urlparse
from typing import Any, Dict, Optional


_JWT_RE = re.compile(r"^eyJ[0-9A-Za-z_-]*\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+$")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9._~+/=-]+$")


def _normalize_token(value: str) -> str:
    value = (value or "").strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    return value


def _looks_like_auth_token(value: str) -> bool:
    value = _normalize_token(value)
    if len(value) < 8:
        return False
    if " " in value or "\t" in value or "\n" in value or "\r" in value:
        return False
    # Prefer JWT-looking tokens, but also accept opaque tokens.
    if _JWT_RE.match(value):
        return True
    return bool(_TOKEN_RE.match(value))


def _bool_env(name: str) -> bool:
    v = os.environ.get(name)
    if v is None:
        return False
    return str(v).strip().lower() in ("1", "true", "yes", "y", "on")


def _debug(msg: str) -> None:
    if _bool_env("SCMP_DEBUG"):
        print(f"[scmp_api debug] {msg}", file=sys.stderr)


def _preview_text(value: Any, *, limit: int = 1200) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            value = json.dumps(value, ensure_ascii=True)
        except Exception:
            value = str(value)
    s = str(value)
    if len(s) > limit:
        return s[:limit] + "…"
    return s


def _is_private_host(host: str) -> bool:
    host = (host or "").strip()
    if not host:
        return False
    # IP literal
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        a, b, c, d = (int(p) for p in parts)
        if a == 10:
            return True
        if a == 192 and b == 168:
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        return False

    try:
        ip = socket.gethostbyname(host)
    except Exception:
        return False
    return _is_private_host(ip)


def _disable_proxies_for_url(url: str) -> bool:
    if _bool_env("SCMP_DISABLE_PROXY"):
        return True
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        host = ""
    # Internal DNS tends to resolve to RFC1918; proxies often break these.
    if host and _is_private_host(host):
        return True
    # Conservative fallback: allow users to opt-in via NO_PROXY.
    return False


def _open_url(req: urllib.request.Request, *, timeout: int) -> Any:
    url = getattr(req, "full_url", "") or ""
    ctx = ssl.create_default_context()

    handlers: list[Any] = []
    handlers.append(urllib.request.HTTPSHandler(context=ctx))

    if _disable_proxies_for_url(url):
        handlers.append(urllib.request.ProxyHandler({}))

    if _bool_env("SCMP_DEBUG"):
        try:
            host = urlparse(url).hostname or ""
        except Exception:
            host = ""
        try:
            proxies = urllib.request.getproxies()  # type: ignore[attr-defined]
        except Exception:
            proxies = {}
        _debug(
            f"url={url} host={host} disable_proxy={_disable_proxies_for_url(url)} proxies={proxies} no_proxy={os.environ.get('no_proxy') or os.environ.get('NO_PROXY')}"
        )

    opener = urllib.request.build_opener(*handlers)
    return opener.open(req, timeout=timeout)


class LoginError(Exception):
    pass


class CredentialError(Exception):
    pass


def _is_interactive() -> bool:
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except Exception:
        return False


def _prompt_password(*, plain: bool, context: str) -> str:
    if plain:
        return input(f"SCMP password ({context}, PLAINTEXT): ")
    return getpass(f"SCMP password ({context}, input hidden): ")


def _extract_error_hint(body: Any) -> Optional[str]:
    if not isinstance(body, dict):
        return None
    code = body.get("code")
    msg = body.get("message")
    result = body.get("result")
    parts = []
    if code is not None:
        parts.append(f"code={code}")
    if msg:
        parts.append(f"message={msg}")
    # Some endpoints return string errors in result.
    if isinstance(result, str) and result:
        parts.append(f"result={result}")
    return " ".join(parts) if parts else None


def redact_secret(value: str, *, keep_prefix: int = 8, keep_suffix: int = 6) -> str:
    value = value or ""
    if len(value) <= keep_prefix + keep_suffix:
        return "[REDACTED]"
    return f"{value[:keep_prefix]}…{value[-keep_suffix:]}"


def extract_authentication_token(session_path: str) -> Optional[str]:
    """Extract SCMP `authentication` token.

    Priority:
    1) env var `SCMP_AUTHENTICATION`
    2) Playwright storage_state JSON at session_path (localStorage scan)
    """

    env_token = os.environ.get("SCMP_AUTHENTICATION")
    if env_token and _looks_like_auth_token(env_token):
        return _normalize_token(env_token)

    if not session_path or not os.path.exists(session_path):
        return None

    try:
        with open(session_path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception:
        return None

    # Playwright storage_state format:
    # {"cookies": [...], "origins": [{"origin": "...", "localStorage": [{"name": "...", "value": "..."}]}]}
    preferred_keys = {
        "authentication",
        "auth",
        "token",
        "jwt",
        "access_token",
        "accessToken",
        "id_token",
        "idToken",
    }

    candidates = []
    for origin in state.get("origins", []) or []:
        for item in origin.get("localStorage", []) or []:
            name = str(item.get("name", ""))
            value = str(item.get("value", ""))
            if not value:
                continue
            if _looks_like_auth_token(value):
                score = 0
                if name in preferred_keys or name.lower() in preferred_keys:
                    score += 10
                if name.lower().startswith("auth"):
                    score += 5
                candidates.append((score, _normalize_token(value)))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1].strip()


def _find_token_like(value: Any) -> Optional[str]:
    if isinstance(value, str) and _looks_like_auth_token(value):
        return _normalize_token(value)
    if isinstance(value, dict):
        for v in value.values():
            found = _find_token_like(v)
            if found:
                return found
    if isinstance(value, list):
        for v in value:
            found = _find_token_like(v)
            if found:
                return found
    return None


def default_config_path() -> str:
    return os.path.expanduser(
        os.environ.get("SCMP_CONFIG_FILE") or "~/.config/auto-skills/scmp.json"
    )


def default_token_path() -> str:
    return os.path.expanduser(os.environ.get("SCMP_TOKEN_FILE") or "~/.scmp_token.json")


def keychain_service_name() -> str:
    config = load_scmp_config()
    service = os.environ.get("SCMP_KEYCHAIN_SERVICE") or config.get("keychain_service")
    return str(service or "auto-skills.scmp.ldap")


def _chmod_600(path: str) -> None:
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        pass


def save_token_file(path: str, token: str) -> None:
    path = os.path.expanduser(path)
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    payload = {"authentication": token, "saved_at": int(time.time())}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    _chmod_600(path)


def load_scmp_config(path: Optional[str] = None) -> Dict[str, Any]:
    config_path = os.path.expanduser(path or default_config_path())
    if not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    if "password" in data:
        print(
            f"Warning: ignoring plaintext password field in {config_path}; use macOS Keychain via `scmp-auth setup`.",
            file=sys.stderr,
        )
    return {k: v for k, v in data.items() if k != "password"}


def save_scmp_config(
    *, share_id: str, keychain_service: Optional[str] = None, path: Optional[str] = None
) -> str:
    config_path = os.path.expanduser(path or default_config_path())
    directory = os.path.dirname(config_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    payload: Dict[str, Any] = {"share_id": str(share_id)}
    service = keychain_service or os.environ.get("SCMP_KEYCHAIN_SERVICE")
    if service:
        payload["keychain_service"] = str(service)
    else:
        existing_service = load_scmp_config(config_path).get("keychain_service")
        if existing_service:
            payload["keychain_service"] = str(existing_service)
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    _chmod_600(config_path)
    return config_path


def _run_security(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/usr/bin/security", *args],
        check=False,
        capture_output=True,
        text=True,
    )


def keychain_set_password(
    share_id: str, password: str, service: Optional[str] = None
) -> None:
    svc = service or keychain_service_name()
    result = _run_security(
        ["add-generic-password", "-U", "-a", str(share_id), "-s", svc, "-w", str(password)]
    )
    if result.returncode != 0:
        raise CredentialError(
            f"failed to save password to macOS Keychain: {(result.stderr or result.stdout).strip()}"
        )


def keychain_get_password(
    share_id: str, service: Optional[str] = None
) -> Optional[str]:
    svc = service or keychain_service_name()
    result = _run_security(["find-generic-password", "-a", str(share_id), "-s", svc, "-w"])
    if result.returncode != 0:
        _debug(f"keychain lookup miss for service={svc} account={share_id}")
        return None
    password = result.stdout.rstrip("\n")
    return password or None


def keychain_has_password(share_id: str, service: Optional[str] = None) -> bool:
    svc = service or keychain_service_name()
    result = _run_security(["find-generic-password", "-a", str(share_id), "-s", svc])
    return result.returncode == 0


def keychain_delete_password(share_id: str, service: Optional[str] = None) -> bool:
    svc = service or keychain_service_name()
    result = _run_security(["delete-generic-password", "-a", str(share_id), "-s", svc])
    return result.returncode == 0


@dataclass(frozen=True)
class SCMPCredentials:
    share_id: str
    password: str
    share_id_source: str
    password_source: str


def _resolve_share_id(
    share_id: Optional[str], config: Dict[str, Any], allow_prompt: bool
) -> tuple[str, str]:
    if share_id:
        return str(share_id).strip(), "argument"
    env_share_id = os.environ.get("SCMP_SHARE_ID")
    if env_share_id:
        return env_share_id.strip(), "env"
    config_share_id = config.get("share_id")
    if config_share_id:
        return str(config_share_id).strip(), "config"
    if allow_prompt and _is_interactive():
        return input("SCMP share_id: ").strip(), "prompt"
    raise CredentialError(
        "missing SCMP share_id: run `scmp-auth setup`, set SCMP_SHARE_ID, or pass --share-id"
    )


def _resolve_password(
    share_id: str,
    password: Optional[str],
    *,
    force_prompt_password: bool,
    plain_password: bool,
    allow_prompt: bool,
    context: str,
) -> tuple[str, str]:
    if force_prompt_password:
        if not (allow_prompt and _is_interactive()):
            raise CredentialError("password prompt requested but stdin/stdout is not interactive")
        return _prompt_password(plain=plain_password, context=context), "prompt"
    if password:
        return str(password), "argument"
    env_password = os.environ.get("SCMP_PASSWORD")
    if env_password:
        return env_password, "env"
    keychain_password = keychain_get_password(share_id)
    if keychain_password:
        return keychain_password, "keychain"
    if allow_prompt and _is_interactive():
        return _prompt_password(plain=plain_password, context=context), "prompt"
    raise CredentialError(
        "missing SCMP password: run `scmp-auth setup`, set SCMP_AUTHENTICATION, or pass --password in an interactive shell"
    )


def resolve_scmp_credentials(
    *,
    share_id: Optional[str] = None,
    password: Optional[str] = None,
    force_prompt_password: bool = False,
    plain_password: bool = False,
    allow_prompt: bool = True,
    context: str = "login",
) -> SCMPCredentials:
    resolved_share_id, share_id_source = _resolve_share_id(
        share_id, load_scmp_config(), allow_prompt
    )
    if not resolved_share_id:
        raise CredentialError("SCMP share_id is required")
    resolved_password, password_source = _resolve_password(
        resolved_share_id,
        password,
        force_prompt_password=force_prompt_password,
        plain_password=plain_password,
        allow_prompt=allow_prompt,
        context=context,
    )
    return SCMPCredentials(
        share_id=resolved_share_id,
        password=resolved_password,
        share_id_source=share_id_source,
        password_source=password_source,
    )


def load_token_file(path: str) -> Optional[str]:
    path = os.path.expanduser(path)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    token = None
    if isinstance(data, dict):
        token = data.get("authentication") or data.get("token")
    if token and _looks_like_auth_token(str(token)):
        return _normalize_token(str(token))
    found = _find_token_like(data)
    return found.strip() if found else None


def load_token_metadata(path: str) -> Dict[str, Any]:
    """Load raw token file content to check metadata like saved_at."""
    path = os.path.expanduser(path)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def token_file_saved_ymd(path: str) -> Optional[str]:
    """Return token file saved_at as YYYY-MM-DD (local time)."""
    meta = load_token_metadata(path)
    ts = meta.get("saved_at")
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d")
    except Exception:
        return None


def _fresh_token_from_file(token_path: str) -> Optional[str]:
    meta = load_token_metadata(token_path)
    saved_at = meta.get("saved_at", 0)
    token = meta.get("authentication") or meta.get("token")
    if not token or not saved_at:
        return None
    try:
        saved_date = datetime.fromtimestamp(int(saved_at)).date()
    except Exception:
        return None
    if saved_date == datetime.now().date() and _looks_like_auth_token(str(token)):
        return _normalize_token(str(token))
    return None


def _token_refresh_notice(token_path: str) -> None:
    meta = load_token_metadata(token_path)
    if meta.get("authentication") or meta.get("token"):
        print("Token has expired (daily check). Refreshing token.", file=sys.stderr)
    else:
        print(f"Token not found at {token_path}.", file=sys.stderr)


def _login_with_credentials(base_url: str, credentials: SCMPCredentials) -> str:
    print(f"Logging in as {credentials.share_id}...", file=sys.stderr)
    try:
        return login_and_get_token(base_url, credentials.share_id, credentials.password)
    except LoginError as e:
        raise CredentialError(f"login failed: {e}") from e


def ensure_daily_token(
    base_url: str,
    *,
    token_file: Optional[str] = None,
    share_id: Optional[str] = None,
    password: Optional[str] = None,
    force_prompt_password: bool = False,
    plain_password: bool = False,
    allow_prompt: Optional[bool] = None,
) -> str:
    token_path = os.path.expanduser(token_file or default_token_path())
    env_token = os.environ.get("SCMP_AUTHENTICATION")
    if env_token and _looks_like_auth_token(env_token):
        return _normalize_token(env_token)
    fresh_token = _fresh_token_from_file(token_path)
    if fresh_token:
        return fresh_token

    _token_refresh_notice(token_path)
    credentials = resolve_scmp_credentials(
        share_id=share_id,
        password=password,
        force_prompt_password=force_prompt_password,
        plain_password=plain_password or _bool_env("SCMP_PLAIN_PASSWORD"),
        allow_prompt=_is_interactive() if allow_prompt is None else allow_prompt,
        context="daily login",
    )
    new_token = _login_with_credentials(base_url, credentials)
    save_token_file(token_path, new_token)
    print(f"Login successful. Token refreshed at {token_path}.", file=sys.stderr)
    return new_token


@dataclass(frozen=True)
class SCMPResponse:
    status: int
    headers: Dict[str, str]
    body: Any


class SCMPApi:
    def __init__(self, base_url: str, authentication_token: str):
        self.base_url = base_url.rstrip("/")
        self.authentication_token = authentication_token

    def post_json(self, url_or_path: str, payload: Any) -> SCMPResponse:
        return self._request_json("POST", url_or_path, payload)

    def get_json(self, url_or_path: str) -> SCMPResponse:
        return self._request_json("GET", url_or_path, None)

    def _request_json(
        self, method: str, url_or_path: str, payload: Any
    ) -> SCMPResponse:
        url = url_or_path
        if url_or_path.startswith("/"):
            url = f"{self.base_url}{url_or_path}"

        data = None
        headers = {
            "accept": "application/json",
            "authentication": self.authentication_token,
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["content-type"] = "application/json"

        req = urllib.request.Request(url, data=data, method=method, headers=headers)

        try:
            with _open_url(req, timeout=60) as resp:
                raw = resp.read()
                content_type = resp.headers.get("content-type", "")
                if "application/json" in content_type:
                    body: Any = json.loads(raw.decode("utf-8"))
                else:
                    body = raw.decode("utf-8", errors="replace")
                return SCMPResponse(
                    status=resp.status,
                    headers={k.lower(): v for k, v in resp.headers.items()},
                    body=body,
                )
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = raw.decode("utf-8", errors="replace")
            return SCMPResponse(
                status=e.code,
                headers={k.lower(): v for k, v in e.headers.items()},
                body=body,
            )


def login_and_get_token(base_url: str, share_id: str, password: str) -> str:
    """Log in and return the `authentication` token.

    Raises:
        LoginError: when the server rejects credentials or the network call fails.
    """
    url = base_url.rstrip("/") + "/user/api/v1/login"
    data = json.dumps({"share_id": share_id, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"accept": "application/json", "content-type": "application/json"},
    )
    body: Any = None
    try:
        with _open_url(req, timeout=60) as resp:
            raw = resp.read()
            headers = {k.lower(): v for k, v in resp.headers.items()}
            header_token = headers.get("authentication")
            if header_token and _looks_like_auth_token(str(header_token)):
                return _normalize_token(str(header_token))

            authz = headers.get("authorization")
            if authz and _looks_like_auth_token(str(authz)):
                return _normalize_token(str(authz))

            try:
                set_cookies = resp.headers.get_all("Set-Cookie") or []
            except Exception:
                set_cookies = []
            for line in set_cookies:
                first = str(line).split(";", 1)[0]
                if "=" not in first:
                    continue
                name, val = first.split("=", 1)
                if name.strip().lower() not in (
                    "authentication",
                    "token",
                    "access_token",
                    "accesstoken",
                ):
                    continue
                if _looks_like_auth_token(val):
                    return _normalize_token(val)

            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception as e:
                _debug(
                    f"login response not JSON: err={e} content_type={headers.get('content-type')} body={_preview_text(raw)}"
                )
                raise LoginError("login response is not JSON")
    except urllib.error.HTTPError as e:
        raw = e.read()
        headers = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = raw.decode("utf-8", errors="replace")
        _debug(
            "login HTTPError: "
            + f"status={e.code} "
            + f"content_type={headers.get('content-type')} "
            + f"body={_preview_text(body)}"
        )
        hint = _extract_error_hint(body)
        raise LoginError(hint or f"http={e.code} body={_preview_text(body)}")
    except urllib.error.URLError as e:
        _debug(f"login URLError: reason={getattr(e, 'reason', None) or e}")
        raise LoginError(f"network/ssl error: {getattr(e, 'reason', None) or e}")
    except Exception as e:
        _debug(f"login exception: {e!r}")
        raise LoginError(f"login exception: {e!r}")

    if isinstance(body, dict):
        token = (
            body.get("authentication")
            or body.get("token")
            or body.get("access_token")
            or body.get("accessToken")
            or (body.get("result") or {}).get("authentication")
            or (body.get("result") or {}).get("token")
            or (body.get("result") or {}).get("access_token")
            or (body.get("result") or {}).get("accessToken")
        )
        if token and _looks_like_auth_token(str(token)):
            return _normalize_token(str(token))

        hint = _extract_error_hint(body)
        if hint:
            raise LoginError(hint)

    found = _find_token_like(body)
    if found:
        return found.strip()
    raise LoginError("could not find token in response")
