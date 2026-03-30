#!/usr/bin/env python3
"""Diagnose direct CRS vs newapi->CRS cache behavior for Responses API.

Outputs a JSON report with:
- environment summary
- models probe for both endpoints
- request fingerprints (session_id / prompt_cache_key / sha256)
- repeated small/medium/large responses runs
- response.completed fields and token/cache metrics
- basic diff summary

Example:
  python3 scripts/diagnose_newapi_crs_cache.py \
    --direct-base-url http://82.156.121.141:3000/openai \
    --direct-api-key cr_xxx \
    --relay-base-url http://82.156.121.141:4001 \
    --relay-api-key sk_xxx \
    --output /tmp/newapi-crs-diagnose.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import socket
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import httpx


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=False)


def _utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _trim(text: str, limit: int = 200) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def _normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def _models_url(base_url: str) -> str:
    base = _normalize_base_url(base_url)
    if base.endswith("/v1"):
        return f"{base}/models"
    return f"{base}/v1/models"


def _responses_url(base_url: str) -> str:
    base = _normalize_base_url(base_url)
    if base.endswith("/v1"):
        return f"{base}/responses"
    return f"{base}/v1/responses"


def _probe_models(client: httpx.Client, label: str, base_url: str, api_key: str) -> dict[str, Any]:
    started = time.monotonic()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "codex_cli_rs/0.38.0",
        "originator": "codex_cli_rs",
        "openai-beta": "responses=v1",
    }
    url = _models_url(base_url)
    try:
        resp = client.get(url, headers=headers)
        duration_ms = round((time.monotonic() - started) * 1000, 1)
        body_preview = resp.text[:1200]
        model_ids: list[str] = []
        model_count = None
        if resp.status_code == 200:
            try:
                body = resp.json()
                data = body.get("data") or []
                if isinstance(data, list):
                    model_ids = [str(item.get("id")) for item in data[:20] if isinstance(item, dict) and item.get("id")]
                    model_count = len(data)
            except Exception:
                pass
        return {
            "label": label,
            "url": url,
            "status_code": resp.status_code,
            "content_type": resp.headers.get("content-type"),
            "duration_ms": duration_ms,
            "model_count": model_count,
            "model_ids_preview": model_ids,
            "body_preview": body_preview,
        }
    except Exception as exc:
        return {
            "label": label,
            "url": url,
            "error": repr(exc),
            "duration_ms": round((time.monotonic() - started) * 1000, 1),
        }


def _extract_text_preview(completed: dict[str, Any] | None) -> str | None:
    if not completed:
        return None
    output = completed.get("output") or []
    for item in output:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "output_text":
                return _trim(content.get("text") or "", 200)
    return None


def _run_response_round(
    client: httpx.Client,
    *,
    label: str,
    base_url: str,
    api_key: str,
    model: str,
    session_id: str,
    prompt_cache_key: str,
    instructions: str,
    input_text: str,
    timeout_s: int,
) -> dict[str, Any]:
    url = _responses_url(base_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "codex_cli_rs/0.38.0",
        "originator": "codex_cli_rs",
        "openai-beta": "responses=v1",
        "session_id": session_id,
        "x-session-id": session_id,
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": input_text}]}],
        "stream": True,
        "store": False,
        "prompt_cache_key": prompt_cache_key,
    }
    request_fingerprint = {
        "url": url,
        "model": model,
        "session_id": session_id,
        "x_session_id": session_id,
        "prompt_cache_key": prompt_cache_key,
        "instructions_chars": len(instructions),
        "instructions_sha256": _sha256_text(instructions),
        "input_chars": len(input_text),
        "input_sha256": _sha256_text(input_text),
        "headers_subset": {
            "User-Agent": headers["User-Agent"],
            "originator": headers["originator"],
            "openai-beta": headers["openai-beta"],
            "session_id": headers["session_id"],
            "x-session-id": headers["x-session-id"],
        },
    }

    started = time.monotonic()
    event_types: list[str] = []
    completed: dict[str, Any] | None = None
    raw_error_body: str | None = None
    status_code: int | None = None
    content_type: str | None = None
    response_headers_subset: dict[str, str] = {}
    try:
        with client.stream("POST", url, headers=headers, json=payload, timeout=timeout_s) as resp:
            status_code = resp.status_code
            content_type = resp.headers.get("content-type")
            response_headers_subset = {
                k: v
                for k, v in resp.headers.items()
                if k.lower() in {"content-type", "x-request-id", "cf-ray", "server"}
            }
            if resp.status_code >= 400:
                raw_error_body = resp.read().decode(errors="replace")[:4000]
            else:
                for line in resp.iter_lines():
                    if not line:
                        continue
                    if line.startswith("event: "):
                        event_type = line[len("event: ") :]
                        if len(event_types) < 16:
                            event_types.append(event_type)
                    elif line.startswith("data: "):
                        data_str = line[len("data: ") :]
                        try:
                            data = json.loads(data_str)
                        except Exception:
                            continue
                        if data.get("type") == "response.completed":
                            completed = data.get("response")
                            break
        duration_ms = round((time.monotonic() - started) * 1000, 1)
    except Exception as exc:
        return {
            "label": label,
            "request": request_fingerprint,
            "error": repr(exc),
            "duration_ms": round((time.monotonic() - started) * 1000, 1),
        }

    usage = (completed or {}).get("usage") or {}
    input_details = usage.get("input_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or {}
    result = {
        "label": label,
        "request": request_fingerprint,
        "http": {
            "status_code": status_code,
            "content_type": content_type,
            "response_headers_subset": response_headers_subset,
            "duration_ms": duration_ms,
        },
        "events_preview": event_types,
        "response": {
            "id": completed.get("id") if completed else None,
            "status": completed.get("status") if completed else None,
            "model": completed.get("model") if completed else None,
            "prompt_cache_key": completed.get("prompt_cache_key") if completed else None,
            "previous_response_id": completed.get("previous_response_id") if completed else None,
            "service_tier": completed.get("service_tier") if completed else None,
            "safety_identifier": completed.get("safety_identifier") if completed else None,
            "text_preview": _extract_text_preview(completed),
            "usage": {
                "input_tokens": usage.get("input_tokens"),
                "cached_tokens": input_details.get("cached_tokens"),
                "output_tokens": usage.get("output_tokens"),
                "reasoning_tokens": output_details.get("reasoning_tokens"),
                "total_tokens": usage.get("total_tokens"),
            },
        },
        "raw_error_body": raw_error_body,
    }
    return result


def _build_scenarios(large_repeat: int) -> list[dict[str, Any]]:
    medium_text = (
        "下面是一段需要你持续记住的上下文。不要逐段复述，只在最后给结果。\\n"
        "项目代号：Maple Transit\\n"
        "目标：做一个面向城市通勤者的路线规划助手\\n"
        "核心约束：\\n"
        "1. 优先推荐总耗时最短方案\\n"
        "2. 如果总耗时差距在 8 分钟以内，优先少换乘\\n"
        "3. 夜间 22:30 之后避免推荐末班车风险高的线路\\n"
        "4. 用户偏好步行不超过 900 米\\n"
        "5. 输出必须简洁，最多 5 条要点\\n"
        "已知站点与时间：A-B 地铁12，A-C 公交9，C-B 公交11，B-D 地铁8，C-D 打车14，A-D 步行38，B换乘6，C换乘3。"
    )
    large_chunk = (
        "Maple Transit context: A-B metro 12, A-C bus 9, C-B bus 11, "
        "B-D metro 8, C-D taxi 14, A-D walk 38, B transfer 6, C transfer 3, "
        "prefer shortest, within 8 min prefer fewer transfers, after 22:30 avoid risky last train, "
        "walk <=900m. "
    )
    large_text = large_chunk * large_repeat + "Reply only: context loaded."
    return [
        {
            "id": "small",
            "rounds": 3,
            "instructions": "Reply OK only.",
            "input_text": "hi",
        },
        {
            "id": "medium",
            "rounds": 3,
            "instructions": "Read the context and reply only: context loaded.",
            "input_text": medium_text,
        },
        {
            "id": "large",
            "rounds": 2,
            "instructions": "Reply OK only.",
            "input_text": large_text,
        },
    ]


def _summarize(report: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"scenarios": {}}
    for scenario in report["scenarios"]:
        sid = scenario["scenario_id"]
        summary["scenarios"][sid] = {}
        for endpoint in scenario["endpoints"]:
            label = endpoint["label"]
            rounds = endpoint["rounds"]
            cached = [r.get("response", {}).get("usage", {}).get("cached_tokens") for r in rounds]
            inputs = [r.get("response", {}).get("usage", {}).get("input_tokens") for r in rounds]
            prompt_keys = [r.get("response", {}).get("prompt_cache_key") for r in rounds]
            prev_ids = [r.get("response", {}).get("previous_response_id") for r in rounds]
            statuses = [r.get("http", {}).get("status_code") for r in rounds]
            summary["scenarios"][sid][label] = {
                "http_statuses": statuses,
                "cached_tokens_progression": cached,
                "input_tokens_progression": inputs,
                "prompt_cache_key_echoes": prompt_keys,
                "previous_response_ids": prev_ids,
                "cache_hit_after_first_round": any((v or 0) > 0 for v in cached[1:]),
                "max_cached_tokens": max([(v or 0) for v in cached], default=0),
            }
        if len(scenario["endpoints"]) == 2:
            a = scenario["endpoints"][0]["label"]
            b = scenario["endpoints"][1]["label"]
            a2 = summary["scenarios"][sid][a]["max_cached_tokens"]
            b2 = summary["scenarios"][sid][b]["max_cached_tokens"]
            summary["scenarios"][sid]["comparison"] = {
                "labels": [a, b],
                "max_cached_tokens_delta": a2 - b2,
                "same_max_cached_tokens": a2 == b2,
            }
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Collect a comprehensive JSON report for direct CRS vs newapi->CRS cache diagnostics."
    )
    parser.add_argument("--direct-base-url", required=True, help="Direct CRS base URL, e.g. http://host:3000/openai")
    parser.add_argument("--direct-api-key", required=True, help="Direct CRS API key")
    parser.add_argument("--relay-base-url", required=True, help="newapi/relay base URL, e.g. http://host:4001")
    parser.add_argument("--relay-api-key", required=True, help="newapi/relay API key")
    parser.add_argument("--direct-label", default="direct", help="Label for direct endpoint in report")
    parser.add_argument("--relay-label", default="relay", help="Label for relay endpoint in report")
    parser.add_argument("--model", default="gpt-5.4", help="Model name for /responses requests")
    parser.add_argument("--session-prefix", default="diag-cache", help="Session/prompt cache key prefix")
    parser.add_argument("--timeout", type=int, default=240, help="Request timeout in seconds")
    parser.add_argument(
        "--large-repeat",
        type=int,
        default=800,
        help="Repeat count for the large context scenario",
    )
    parser.add_argument("--skip-models", action="store_true", help="Skip /v1/models probes")
    parser.add_argument("--output", help="Write report JSON to this file")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    client = httpx.Client(follow_redirects=True)
    report: dict[str, Any] = {
        "generated_at": _utc_now_iso(),
        "script": "diagnose_newapi_crs_cache.py",
        "host": socket.gethostname(),
        "platform": platform.platform(),
        "python": sys.version,
        "config": {
            "direct_label": args.direct_label,
            "relay_label": args.relay_label,
            "model": args.model,
            "session_prefix": args.session_prefix,
            "timeout_seconds": args.timeout,
            "large_repeat": args.large_repeat,
            "skip_models": args.skip_models,
        },
        "models_probe": [],
        "scenarios": [],
    }

    endpoints = [
        {
            "label": args.direct_label,
            "base_url": args.direct_base_url,
            "api_key": args.direct_api_key,
        },
        {
            "label": args.relay_label,
            "base_url": args.relay_base_url,
            "api_key": args.relay_api_key,
        },
    ]

    if not args.skip_models:
        for endpoint in endpoints:
            report["models_probe"].append(
                _probe_models(
                    client,
                    endpoint["label"],
                    endpoint["base_url"],
                    endpoint["api_key"],
                )
            )

    scenarios = _build_scenarios(args.large_repeat)
    for scenario in scenarios:
        scenario_report = {
            "scenario_id": scenario["id"],
            "instructions_chars": len(scenario["instructions"]),
            "input_chars": len(scenario["input_text"]),
            "input_sha256": _sha256_text(scenario["input_text"]),
            "rounds": scenario["rounds"],
            "endpoints": [],
        }
        for endpoint in endpoints:
            session_id = f"{args.session_prefix}-{scenario['id']}-{endpoint['label']}-{uuid.uuid4().hex[:8]}"
            endpoint_report = {
                "label": endpoint["label"],
                "base_url": _normalize_base_url(endpoint["base_url"]),
                "session_id": session_id,
                "prompt_cache_key": session_id,
                "rounds": [],
            }
            for round_idx in range(1, scenario["rounds"] + 1):
                result = _run_response_round(
                    client,
                    label=endpoint["label"],
                    base_url=endpoint["base_url"],
                    api_key=endpoint["api_key"],
                    model=args.model,
                    session_id=session_id,
                    prompt_cache_key=session_id,
                    instructions=scenario["instructions"],
                    input_text=scenario["input_text"],
                    timeout_s=args.timeout,
                )
                result["round"] = round_idx
                endpoint_report["rounds"].append(result)
            scenario_report["endpoints"].append(endpoint_report)
        report["scenarios"].append(scenario_report)

    report["summary"] = _summarize(report)
    text = _json_dumps(report)
    if args.output:
        Path(args.output).write_text(text + "\n")
        print(f"Wrote report to {args.output}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
