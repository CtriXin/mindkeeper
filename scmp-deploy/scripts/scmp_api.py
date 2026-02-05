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


def default_token_path() -> str:
    return os.path.expanduser("~/.scmp_token.json")


def save_token_file(path: str, token: str) -> None:
    path = os.path.expanduser(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {"authentication": token, "saved_at": int(time.time())}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        # Best effort on non-POSIX FS.
        pass


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


def ensure_daily_token(base_url: str) -> str:
    """Ensure we have a valid token from today. If not, prompt login."""
    token_path = default_token_path()

    # 1. Check if token exists and is from today
    meta = load_token_metadata(token_path)
    saved_at = meta.get("saved_at", 0)
    token = meta.get("authentication")

    is_fresh = False
    if token and saved_at:
        saved_date = datetime.fromtimestamp(saved_at).date()
        today = datetime.now().date()
        if saved_date == today:
            is_fresh = True

    # If using env var auth, skip file checks
    env_token = os.environ.get("SCMP_AUTHENTICATION")
    if env_token and _looks_like_auth_token(env_token):
        return _normalize_token(env_token)

    if is_fresh and token and _looks_like_auth_token(str(token)):
        return _normalize_token(str(token))

    # 2. Token is stale or missing. Perform login.
    if not token:
        print(f"Token not found at {token_path}.")
    else:
        print("Token has expired (daily check). Please re-login.")

    share_id = os.environ.get("SCMP_SHARE_ID")
    if not share_id:
        share_id = input("SCMP share_id: ").strip()
        if not share_id:
            print("Error: share_id is required.", file=sys.stderr)
            sys.exit(1)

    password = os.environ.get("SCMP_PASSWORD")
    if not password:
        if _bool_env("SCMP_PLAIN_PASSWORD"):
            password = input("SCMP password (PLAINTEXT): ")
        else:
            password = getpass("SCMP password (input hidden): ")

    print(f"Logging in as {share_id}...")
    try:
        new_token = login_and_get_token(base_url, share_id, password)
    except LoginError as e:
        print(f"Login failed: {e}", file=sys.stderr)
        sys.exit(1)

    save_token_file(token_path, new_token)
    print("Login successful. Token refreshed.")
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
