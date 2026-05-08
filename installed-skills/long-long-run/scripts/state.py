#!/usr/bin/env python3
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


SKILL_NAME = "long-long-run"
STATE_SCHEMA_VERSION = 1
CONTROLLER_VERSION = 1
MODE_VALUES = {"disabled", "inc", "active"}
DELIVERY_POSTURE_VALUES = {
    "high_quality",
    "scoped_production",
    "pilot",
    "demo",
    "exploratory",
}
ACTIVATION_STATUS_VALUES = {"idle", "authorized"}
ACTIVATION_SCOPE_VALUES = {"single", "standing_session"}
CHECKPOINT_HISTORY_LIMIT = 200
LEGACY_TOP_LEVEL_KEYS = {"hard_contract", "working_model", "execution"}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_string(value: object) -> str:
    return str(value).strip() if value is not None else ""


def clean_list(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    return [clean_string(value) for value in values if clean_string(value)]


def codex_home() -> Path:
    value = os.environ.get("CODEX_HOME")
    if value:
        return Path(value).expanduser()
    return Path.home() / ".codex"


def state_root() -> Path:
    return codex_home() / SKILL_NAME / "sessions"


def default_project_root(project_root: Optional[str]) -> str:
    if project_root:
        return str(Path(project_root).expanduser().resolve())
    return str(Path.cwd().resolve())


def session_state_path(session_id: str) -> Path:
    return (state_root() / f"{session_id}.json").resolve()


@dataclass
class SessionIdentity:
    session_id: str
    path: Path
    source: str
    warnings: list[str]


def resolve_identity(
    session_id: Optional[str] = None, path: Optional[str] = None
) -> SessionIdentity:
    env_session_id = clean_string(os.environ.get("CODEX_THREAD_ID", ""))
    warnings: list[str] = []

    if path:
        resolved_path = Path(path).expanduser().resolve()
        derived_session_id = session_id or resolved_path.stem
        source = "explicit_path"
        if session_id and resolved_path.stem != session_id:
            warnings.append(
                "The explicit path stem does not match the explicit session_id; using the explicit path."
            )
        if (
            env_session_id
            and derived_session_id
            and env_session_id != derived_session_id
        ):
            warnings.append(
                "The resolved session differs from CODEX_THREAD_ID; using the explicit path/session_id."
            )
        return SessionIdentity(
            session_id=derived_session_id,
            path=resolved_path,
            source=source,
            warnings=warnings,
        )

    chosen_session_id = session_id or env_session_id
    if not chosen_session_id:
        raise SystemExit(
            "could not resolve a session id; provide --session-id/--path or run inside Codex with CODEX_THREAD_ID"
        )

    source = "explicit_session_id" if session_id else "env_codex_thread_id"
    if session_id and env_session_id and session_id != env_session_id:
        warnings.append(
            "The explicit session_id differs from CODEX_THREAD_ID; using the explicit session_id."
        )

    return SessionIdentity(
        session_id=chosen_session_id,
        path=session_state_path(chosen_session_id),
        source=source,
        warnings=warnings,
    )


def default_state(session_id: str, project_root: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    return {
        "runtime": {
            "schema_version": STATE_SCHEMA_VERSION,
            "controller_version": CONTROLLER_VERSION,
            "skill": SKILL_NAME,
            "session_id": session_id,
            "mode": "disabled",
            "project_root": project_root,
            "created_at": timestamp,
            "updated_at": timestamp,
            "last_transition": "",
        },
        "contract": {
            "objective": "",
            "why_now": "",
            "requirements": [],
            "success_criteria": [],
            "guardrails": [],
            "delivery_posture": "high_quality",
            "confirmed": False,
        },
        "thinking": {
            "inferred_intent": "",
            "evidence_chain": [],
            "expert_defaults": [],
            "verified_constraints": [],
            "assumptions": [],
            "risks": [],
            "open_decisions": [],
        },
        "activation": {
            "status": "idle",
            "scope": "single",
            "evidence": "",
            "updated_at": "",
        },
        "progress": {
            "latest_checkpoint": "",
            "checkpoint_history": [],
            "next_action": "",
            "completion_signal": "",
            "blocker": {
                "kind": "none",
                "summary": "",
            },
            "closure": {
                "state": "open",
                "reason": "",
                "summary": "",
                "closed_at": "",
            },
        },
    }


def normalize_blocker(value: object) -> dict[str, str]:
    blocker = {"kind": "none", "summary": ""}
    if not isinstance(value, dict):
        return blocker
    kind = clean_string(value.get("kind", "")).lower() or "none"
    blocker["kind"] = kind
    blocker["summary"] = clean_string(value.get("summary", ""))
    return blocker


def normalize_checkpoint_history(values: object) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []

    cleaned: list[dict[str, str]] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        summary = clean_string(value.get("summary", ""))
        if not summary:
            continue
        entry = {
            "timestamp": clean_string(value.get("timestamp", "")),
            "mode": clean_string(value.get("mode", "")),
            "summary": summary,
            "next_action": clean_string(
                value.get("next_action", value.get("next_best_action", ""))
            ),
        }
        if entry["mode"] not in MODE_VALUES:
            entry["mode"] = ""
        cleaned.append(entry)
    return cleaned[-CHECKPOINT_HISTORY_LIMIT:]


def normalize_evidence_chain(values: object) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []

    cleaned: list[dict[str, str]] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        entry = {
            "claim": clean_string(value.get("claim", "")),
            "basis": clean_string(value.get("basis", "")),
            "implication": clean_string(value.get("implication", "")),
        }
        if any(entry.values()):
            cleaned.append(entry)
    return cleaned


def normalize_closure(value: object) -> dict[str, str]:
    closure = {
        "state": "open",
        "reason": "",
        "summary": "",
        "closed_at": "",
    }
    if not isinstance(value, dict):
        return closure
    state = clean_string(value.get("state", "")).lower()
    if state not in {"open", "closed"}:
        state = "open"
    closure["state"] = state
    closure["reason"] = clean_string(value.get("reason", ""))
    closure["summary"] = clean_string(value.get("summary", ""))
    closure["closed_at"] = clean_string(value.get("closed_at", ""))
    return closure


def _merge_contract(new_contract: dict[str, Any]) -> dict[str, Any]:
    objective = clean_string(new_contract.get("objective", ""))
    why_now = clean_string(new_contract.get("why_now", ""))
    requirements = clean_list(new_contract.get("requirements"))
    success_criteria = clean_list(new_contract.get("success_criteria"))
    guardrails = clean_list(new_contract.get("guardrails"))
    delivery_posture = clean_string(new_contract.get("delivery_posture", "")).lower()
    if delivery_posture not in DELIVERY_POSTURE_VALUES:
        delivery_posture = "high_quality"
    confirmed = bool(new_contract.get("confirmed", False))
    return {
        "objective": objective,
        "why_now": why_now,
        "requirements": requirements,
        "success_criteria": success_criteria,
        "guardrails": guardrails,
        "delivery_posture": delivery_posture,
        "confirmed": confirmed,
    }


def _merge_thinking(new_thinking: dict[str, Any]) -> dict[str, Any]:
    inferred_intent = clean_string(new_thinking.get("inferred_intent", ""))
    evidence_chain = normalize_evidence_chain(new_thinking.get("evidence_chain"))
    expert_defaults = clean_list(new_thinking.get("expert_defaults"))
    verified_constraints = clean_list(new_thinking.get("verified_constraints"))
    assumptions = clean_list(new_thinking.get("assumptions"))
    risks = clean_list(new_thinking.get("risks"))
    open_decisions = clean_list(new_thinking.get("open_decisions"))
    return {
        "inferred_intent": inferred_intent,
        "evidence_chain": evidence_chain,
        "expert_defaults": expert_defaults,
        "verified_constraints": verified_constraints,
        "assumptions": assumptions,
        "risks": risks,
        "open_decisions": open_decisions,
    }


def _merge_activation(new_activation: dict[str, Any]) -> dict[str, Any]:
    status = clean_string(new_activation.get("status", "")).lower()
    if status not in ACTIVATION_STATUS_VALUES:
        status = "idle"
    scope = clean_string(new_activation.get("scope", "")).lower()
    if scope not in ACTIVATION_SCOPE_VALUES:
        scope = "single"
    return {
        "status": status,
        "scope": scope,
        "evidence": clean_string(new_activation.get("evidence", "")),
        "updated_at": clean_string(new_activation.get("updated_at", "")),
    }


def _merge_progress(new_progress: dict[str, Any]) -> dict[str, Any]:
    latest_checkpoint = clean_string(new_progress.get("latest_checkpoint", ""))
    checkpoint_history = normalize_checkpoint_history(
        new_progress.get("checkpoint_history")
    )
    next_action = clean_string(new_progress.get("next_action", ""))
    completion_signal = clean_string(new_progress.get("completion_signal", ""))
    blocker = normalize_blocker(new_progress.get("blocker"))
    closure = normalize_closure(new_progress.get("closure"))
    return {
        "latest_checkpoint": latest_checkpoint,
        "checkpoint_history": checkpoint_history,
        "next_action": next_action,
        "completion_signal": completion_signal,
        "blocker": blocker,
        "closure": closure,
    }


def validate_loaded_state(state: object) -> Optional[str]:
    if not isinstance(state, dict):
        return "state file must contain a JSON object"

    legacy_keys = sorted(key for key in LEGACY_TOP_LEVEL_KEYS if key in state)
    if legacy_keys:
        return (
            "legacy state schema detected ("
            + ", ".join(legacy_keys)
            + "). This runtime does not auto-migrate old long-long-run state files. "
            + "Inspect the existing JSON and reconstruct the new runtime state explicitly."
        )

    runtime = state.get("runtime")
    if not isinstance(runtime, dict):
        return "state file is missing the runtime object"

    top_level_schema = state.get("schema_version")
    if top_level_schema not in (None, STATE_SCHEMA_VERSION):
        return (
            "legacy state schema version detected ("
            + clean_string(top_level_schema)
            + "). This runtime only accepts the current schema and does not auto-migrate old files."
        )

    runtime_schema = runtime.get("schema_version")
    if runtime_schema not in (None, STATE_SCHEMA_VERSION):
        return (
            "legacy runtime schema version detected ("
            + clean_string(runtime_schema)
            + "). This runtime only accepts the current schema and does not auto-migrate old files."
        )

    for key in ("contract", "thinking", "activation", "progress"):
        value = state.get(key)
        if value is not None and not isinstance(value, dict):
            return f"state file has an invalid {key} object"

    return None


def normalize_state(
    state: object,
    session_id_hint: str = "",
    project_root_hint: str = "",
) -> dict[str, Any]:
    session_id = session_id_hint
    project_root = clean_string(project_root_hint)

    if isinstance(state, dict):
        runtime = state.get("runtime")
        if isinstance(runtime, dict):
            session_id = clean_string(runtime.get("session_id", "")) or session_id
            project_root = clean_string(runtime.get("project_root", "")) or project_root
        if not project_root:
            project_root = clean_string(state.get("project_root", ""))

    normalized = default_state(
        session_id=session_id,
        project_root=project_root,
    )
    if not isinstance(state, dict):
        return normalized

    runtime_src = state.get("runtime")
    if not isinstance(runtime_src, dict):
        runtime_src = {}

    mode = clean_string(runtime_src.get("mode", "")).lower()
    if mode in MODE_VALUES:
        normalized["runtime"]["mode"] = mode

    normalized["runtime"]["session_id"] = (
        clean_string(runtime_src.get("session_id", "")) or session_id
    )
    normalized["runtime"]["project_root"] = (
        clean_string(runtime_src.get("project_root", "")) or project_root
    )
    normalized["runtime"]["created_at"] = (
        clean_string(runtime_src.get("created_at", ""))
        or normalized["runtime"]["created_at"]
    )
    normalized["runtime"]["updated_at"] = (
        clean_string(runtime_src.get("updated_at", ""))
        or normalized["runtime"]["updated_at"]
    )
    normalized["runtime"]["last_transition"] = clean_string(
        runtime_src.get("last_transition", "")
    )

    contract_src = state.get("contract")
    if not isinstance(contract_src, dict):
        contract_src = {}
    normalized["contract"] = _merge_contract(contract_src)

    thinking_src = state.get("thinking")
    if not isinstance(thinking_src, dict):
        thinking_src = {}
    normalized["thinking"] = _merge_thinking(thinking_src)

    activation_src = state.get("activation")
    if not isinstance(activation_src, dict):
        activation_src = {}
    normalized["activation"] = _merge_activation(activation_src)

    progress_src = state.get("progress")
    if not isinstance(progress_src, dict):
        progress_src = {}
    normalized["progress"] = _merge_progress(progress_src)

    return normalized


def load_state_with_error(
    path: Path, session_id_hint: str = "", project_root_hint: str = ""
) -> tuple[dict[str, Any], Optional[str]]:
    if not path.is_file():
        return default_state(
            session_id=session_id_hint, project_root=project_root_hint
        ), None
    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return (
            default_state(session_id=session_id_hint, project_root=project_root_hint),
            f"could not read state file: {exc}",
        )
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        return (
            default_state(session_id=session_id_hint, project_root=project_root_hint),
            f"state file contains invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}",
        )
    validation_error = validate_loaded_state(parsed)
    if validation_error:
        return (
            default_state(session_id=session_id_hint, project_root=project_root_hint),
            validation_error,
        )
    return normalize_state(
        parsed,
        session_id_hint=session_id_hint,
        project_root_hint=project_root_hint,
    ), None


def save_state(
    path: Path, state: dict[str, Any], transition: str = ""
) -> dict[str, Any]:
    normalized = normalize_state(state, session_id_hint=path.stem)
    runtime = normalized.setdefault("runtime", {})
    runtime["schema_version"] = STATE_SCHEMA_VERSION
    runtime["controller_version"] = CONTROLLER_VERSION
    runtime["skill"] = SKILL_NAME
    runtime["session_id"] = path.stem
    if not runtime.get("created_at"):
        runtime["created_at"] = now_iso()
    runtime["updated_at"] = now_iso()
    if transition:
        runtime["last_transition"] = transition

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp-{os.getpid()}"
    tmp_path.write_text(
        json.dumps(normalized, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp_path, path)
    return normalized
