#!/bin/bash
# Claude SessionStart hook: hint the latest resumable thread for current repo.
set -euo pipefail

resolve_real_home() {
  if [[ "${ORIGINAL_HOME:-}" != "" ]]; then
    echo "$ORIGINAL_HOME"
  elif [[ "${REAL_HOME:-}" != "" ]]; then
    echo "$REAL_HOME"
  elif [[ "$HOME" == *"/.config/mms/claude-gateway/"* ]]; then
    echo "${HOME%%/.config/mms/claude-gateway/*}"
  else
    echo "$HOME"
  fi
}

REAL_HOME="$(resolve_real_home)"
THREADS_DIR="$REAL_HOME/.sce/threads"

[ -d "$THREADS_DIR" ] || exit 0

INPUT_JSON="$(cat 2>/dev/null || true)"

REAL_HOME="$REAL_HOME" THREADS_DIR="$THREADS_DIR" INPUT_JSON="$INPUT_JSON" python3 - <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path


def parse_frontmatter(path: Path) -> dict[str, str]:
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return {}
    if not content.startswith("---"):
        return {}
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}
    meta: dict[str, str] = {}
    for raw in parts[1].splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip()
    return meta


def extract_status(path: Path) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return ""
    for idx, line in enumerate(lines):
        if line.strip().startswith("## 当前状态"):
            for follow in lines[idx + 1:]:
                text = follow.strip()
                if not text:
                    continue
                if text.startswith("## "):
                    return ""
                return text
    return ""


def resolve_repo(cwd: str) -> str:
    if not cwd:
        return ""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip() or cwd
    except Exception:
        return cwd


def is_same_repo(current_repo: str, thread_repo: str) -> bool:
    if not current_repo or not thread_repo:
        return False
    current_repo = os.path.realpath(current_repo)
    thread_repo = os.path.realpath(thread_repo)
    if current_repo == thread_repo:
        return True
    sep = os.sep
    return current_repo.startswith(thread_repo + sep)


def thread_created_at(path: Path, meta: dict[str, str]) -> float:
    created = meta.get("created", "").strip()
    if created:
        try:
            normalized = created.replace("Z", "+00:00")
            from datetime import datetime
            return datetime.fromisoformat(normalized).timestamp()
        except Exception:
            pass
    return path.stat().st_mtime


try:
    payload = json.loads(os.environ.get("INPUT_JSON", "") or "{}")
except Exception:
    payload = {}

cwd = str(payload.get("cwd") or os.getcwd())
current_repo = resolve_repo(cwd)
threads_dir = Path(os.environ["THREADS_DIR"])

best: tuple[float, dict[str, str], Path] | None = None
for path in threads_dir.glob("*.md"):
    meta = parse_frontmatter(path)
    if not meta:
        continue
    if meta.get("resumed"):
        continue
    if not is_same_repo(current_repo, meta.get("repo", "")):
        continue
    created_at = thread_created_at(path, meta)
    item = (created_at, meta, path)
    if best is None or item[0] > best[0]:
        best = item

if best is None:
    sys.exit(0)

_, meta, path = best
thread_id = meta.get("id") or path.stem
task = meta.get("task") or thread_id
status = extract_status(path)

message_lines = [f"💡 发现上次进度：{thread_id} — {task}"]
if status:
    message_lines.append(f"状态：{status}")
message_lines.append(f"输入 /cr 恢复，或用 /cr {thread_id} 精确恢复")

print(json.dumps({"systemMessage": "\n".join(message_lines)}, ensure_ascii=False))
PY
