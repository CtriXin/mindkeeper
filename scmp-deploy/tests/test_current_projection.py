"""SCMP-01: `scmp_cli.py current` 默认脱敏。

secret fixture negative tests + 正常 snapshot 回归:
- stdout 永不含 Authorization/token/taskSpec/steps/script(即使 raw 里嵌套);
- lookup 所需 identity 字段(summary params、run name/uid、terminal condition、pod、image)不丢;
- --raw-output-file 落完整 raw(0600),stdout 只给路径。
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import stat
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

# committed scmp_cli.py 依赖两个不在 committed tree 的模块:
# - scmp_api.py 的 +268/-51 keychain 重构(CredentialError/resolve_scmp_credentials 等)未提交
# - scmp_auth.py 被根 .gitignore 的 `scmp-deploy/` 规则吞掉,从未被 track
# 两者都是 SCMP-DEPLOY-01 item 2 的裁决范围,不属于 SCMP-01。
# 这里注入 stub 让 scmp_cli 可导入;本卡测的是 current 投影/脱敏,不触碰 auth 逻辑。
import types  # noqa: E402

_scmp_api_stub = types.ModuleType("scmp_api")
for _name in (
    "default_config_path", "default_token_path", "keychain_service_name",
    "load_token_file", "save_scmp_config", "save_token_file",
):
    setattr(_scmp_api_stub, _name, lambda *a, **k: "")
for _name in ("keychain_set_password", "ensure_daily_token"):
    setattr(_scmp_api_stub, _name, lambda *a, **k: None)
_scmp_api_stub.SCMPApi = object
_scmp_api_stub.CredentialError = type("CredentialError", (Exception,), {})
_scmp_api_stub.LoginError = type("LoginError", (Exception,), {})
_scmp_api_stub.redact_secret = lambda value, **k: "[REDACTED]"
_scmp_api_stub.resolve_scmp_credentials = lambda *a, **k: ("", "")
_scmp_api_stub.login_and_get_token = lambda *a, **k: ""

_scmp_auth_stub = types.ModuleType("scmp_auth")
_scmp_auth_stub.add_auth_subcommands = lambda sub, base_url: None

sys.modules.setdefault("scmp_api", _scmp_api_stub)
sys.modules.setdefault("scmp_auth", _scmp_auth_stub)

import scmp_cli  # noqa: E402

SECRET_AUTH = "Bearer abc123SECRETtoken789"
SECRET_PASSWORD = "p@ssw0rd-leak-9"
SECRET_WEBHOOK = "https://hooks.example.com/services/T000/secret-webhook-token"


def make_raw_result(*, with_secrets: bool = True) -> dict:
    script = "echo deploy\n"
    message = "step deploy completed"
    webhook = ""
    if with_secrets:
        script = (
            f"curl -H 'Authorization: {SECRET_AUTH}' "
            f"--password {SECRET_PASSWORD} {SECRET_WEBHOOK}\n"
        )
        message = f"step failed: Authorization: {SECRET_AUTH}"
        webhook = SECRET_WEBHOOK
    return {
        "metadata": {
            "name": "pipe-run-001",
            "uid": "uid-123",
            "namespace": "ci",
            "creationTimestamp": "2026-08-19T01:00:00Z",
            "labels": {
                "tekton.dev/pipeline": "pipe",
                "service": "svc",
                "webhook_token": "label-secret-should-be-dropped",
            },
        },
        "spec": {
            "pipelineRef": {"name": "pipe"},
            "params": [
                {"name": "Env", "value": "prod"},
                {"name": "branch", "value": "release/1.2.3"},
                {"name": "version", "value": "1.2.3"},
                {"name": "tag", "value": ""},
                {"name": "DEPLOY", "value": "true"},
                {"name": "revision", "value": "abc1234"},
            ],
            "taskSpec": {
                "steps": [
                    {"name": "deploy", "image": "registry.example.com/x:1.2.3", "script": script}
                ]
            },
        },
        "status": {
            "startTime": "2026-08-19T01:00:01Z",
            "completionTime": "2026-08-19T01:05:01Z",
            "conditions": [
                {
                    "type": "Succeeded",
                    "status": "False",
                    "reason": "Failed",
                    "message": message,
                    "lastTransitionTime": "2026-08-19T01:05:01Z",
                }
            ],
            "taskRuns": {
                "pipe-run-001-deploy": {
                    "pipelineTaskName": "deploy",
                    "status": {
                        "podName": "pipe-run-001-deploy-pod",
                        "startTime": "2026-08-19T01:00:05Z",
                        "completionTime": "2026-08-19T01:05:00Z",
                        "conditions": [
                            {"type": "Succeeded", "status": "False", "reason": "Failed"}
                        ],
                        "steps": [
                            {
                                "name": "deploy",
                                "imageID": "registry.example.com/x@sha256:deadbeef",
                            }
                        ],
                        # 真实事故(walls.md 12:31):raw status.taskRuns.*.taskSpec.steps[].script
                        "taskSpec": {"steps": [{"script": f"bearer {SECRET_AUTH}"}]},
                    },
                }
            },
            "webhook": webhook,
        },
    }


class FakeResp:
    def __init__(self, body: dict):
        self.body = body


class FakeApi:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.token = token

    def get_json(self, path: str) -> FakeResp:
        return FakeResp({"code": 20000, "result": make_raw_result(with_secrets=True)})


def run_current(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *extra: str) -> str:
    monkeypatch.setattr(scmp_cli, "SCMPApi", FakeApi)
    monkeypatch.setattr(scmp_cli, "_load_token_or_die", lambda token_file: "fake-token")
    raw_file = str(tmp_path / "raw.json") if "--raw-output-file" in extra else ""
    args = argparse.Namespace(
        token_file="unused",
        group="FE",
        project="fe",
        service="svc",
        pipeline="pipe",
        raw_output_file=raw_file,
    )
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        scmp_cli.current_cmd(args)
    return buf.getvalue()


FORBIDDEN = ("Authorization", "authorization", "taskSpec", "script", "steps", SECRET_AUTH.split()[-1], SECRET_PASSWORD, "secret-webhook-token", "label-secret-should-be-dropped", "bearer")


def test_secret_fixture_stdout_has_no_secret_or_taskspec(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out = run_current(monkeypatch, tmp_path)
    for needle in FORBIDDEN:
        assert needle not in out, f"stdout leaked {needle!r}"
    # 输出仍是可解析 JSON
    payload = json.loads(out)
    assert payload["schema"] == "scmp.current.v2"
    assert "raw" not in payload


def test_identity_fields_preserved(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    payload = json.loads(run_current(monkeypatch, tmp_path))
    summary = payload["summary"]
    assert summary["service"] == "svc"
    assert summary["pipeline"] == "pipe"
    assert summary["branch"] == "release/1.2.3"
    assert summary["version"] == "1.2.3"
    assert summary["Env"] == "prod"
    assert summary["DEPLOY"] == "true"
    assert summary["revision"] == "abc1234"

    projection = payload["projection"]
    assert projection["run"]["name"] == "pipe-run-001"
    assert projection["run"]["uid"] == "uid-123"
    assert projection["pipelineRef"]["name"] == "pipe"
    assert projection["terminal"][0]["reason"] == "Failed"
    assert projection["terminal"][0]["status"] == "False"
    assert projection["tasks"][0]["pod"] == "pipe-run-001-deploy-pod"
    assert projection["tasks"][0]["pipelineTaskName"] == "deploy"
    assert projection["tasks"][0]["condition"]["reason"] == "Failed"
    assert projection["started_at"] == "2026-08-19T01:00:01Z"
    assert projection["completed_at"] == "2026-08-19T01:05:01Z"
    assert projection["images"] == ["registry.example.com/x@sha256:deadbeef"]


def test_condition_message_is_redacted(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    payload = json.loads(run_current(monkeypatch, tmp_path))
    message = payload["projection"]["terminal"][0]["message"]
    assert SECRET_AUTH.split()[-1] not in message
    assert "Authorization" not in message
    assert "<redacted>" in message


def test_raw_output_file_full_fidelity_and_0600(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out = run_current(monkeypatch, tmp_path, "--raw-output-file")
    payload = json.loads(out)
    raw_path = Path(payload["raw_path"])
    assert raw_path.is_file()
    mode = stat.S_IMODE(os.stat(raw_path).st_mode)
    assert mode == 0o600, f"raw file mode {oct(mode)} != 0o600"
    # raw 文件是全量(含 secret),它是私有 evidence
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    assert SECRET_AUTH in json.dumps(raw, ensure_ascii=False)
    assert "taskSpec" in json.dumps(raw)
    # 但 stdout 仍干净,只给路径
    for needle in FORBIDDEN:
        assert needle not in out, f"stdout leaked {needle!r}"
    assert payload["raw_policy"]


def test_normal_snapshot_projection_shape(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """正常 snapshot 回归:projection 键结构稳定(lookup 消费方契约)。"""
    payload = json.loads(run_current(monkeypatch, tmp_path))
    assert set(payload["projection"].keys()) == {
        "run", "pipelineRef", "terminal", "started_at", "completed_at", "tasks", "images",
    }
    assert set(payload["projection"]["run"].keys()) == {"name", "uid", "namespace", "created", "labels"}
    assert set(payload["summary"].keys()) == {
        "service", "pipeline", "Env", "branch", "tag", "version", "DEPLOY", "revision",
    }
