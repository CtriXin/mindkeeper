#!/usr/bin/env python3
"""runtimia skill 同步器：把 canonical 技能源推平到 runtimia workspace。

背景（2026-09-04 一天之内踩了三次）：
  runtimia 把技能正文存在自己的 DB 里，跟 canonical 仓**没有任何链接**。
  canonical 仓合一个 PR，runtimia 这边就静默变旧——agent 照跑、skill 照读，
  只是读的是旧版。三次实例：
    · scmp-ops 停在 2026-06-16 的副本，3 个月没人发现（51,030 → 72,324 字）
    · state-core 技能正文里的 CLI 路径指向滞后 checkout，缺 record-decision
    · PR #68 合并后 1 小时内又漂（74,418 → 76,516 字）
  手动同步不是解法，是症状。这个脚本是解法。

用法：
  sync.py                 # 只检查，有漂移退出码 1（给定时任务/hook 用）
  sync.py --apply         # 检查并推平
  sync.py --only scmp-ops # 只处理某几个技能，可重复
  sync.py --json          # 机器可读输出

安全边界（刻意的）：
  · canonical 工作区脏（SKILL.md / references 有未提交改动）→ **跳过不推**。
    半写完的技能推上去比旧技能更危险。
  · runtimia 里多出来的 reference 文件 → 只报告，**不自动删**。
    删除不可恢复，按全局规则要 owner 明确授权。
  · 不做 git fetch。ahead/behind 需要先 fetch 才有意义，定时任务里静默 fetch
    6 个仓既慢又会掩盖问题；这里只报 HEAD 和脏不脏，对齐上游是人的事。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES = HERE / "sources.json"
MULTICA = os.environ.get("MULTICA_BIN", str(Path.home() / ".local/bin/multica"))
TZ8 = timezone(timedelta(hours=8))

# runtimia 只铺 SKILL.md + 上传的 skill files，**不铺 scripts/ / schemas/**。
# 带脚本的技能必须在正文顶部说明脚本根在哪，否则每条闸门命令都会 no such file，
# 闸就静默降级成「让 agent 自己检查一下」——而被告知要检查的 agent 不是闸。
NOTE_TEMPLATE = """<!-- runtimia-skill-root -->
> **脚本根目录**：runtimia 只铺 `SKILL.md` + `references/`，本技能的 `scripts/` / `schemas/` **没有**跟着铺到工作目录。
> 本文中所有 `scripts/…`、`schemas/…` 之类的相对路径，一律以 `{root}/` 为根解析，
> 例如 `scripts/x.py` → `{root}/scripts/x.py`。
> 闸门就是这些脚本本身（带退出码），**不要用「我检查过了」代替真跑一遍**。

"""


def now8() -> str:
    return datetime.now(TZ8).strftime("%Y-%m-%d %H:%M:%S +08")


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, **kw)


def multica_json(args: list[str]):
    r = run([MULTICA, *args, "--output", "json"])
    if r.returncode != 0:
        raise RuntimeError(f"multica {' '.join(args)} 失败: {r.stderr.strip()[:400]}")
    return json.loads(r.stdout)


def inject_note(body: str, root: Path) -> str:
    """把脚本根说明插到 frontmatter 之后、正文之前。"""
    note = NOTE_TEMPLATE.format(root=root)
    if not body.startswith("---"):
        return note + body
    end = body.find("\n---", 3)
    if end < 0:
        return note + body
    cut = body.find("\n", end + 1) + 1
    rest = body[cut:].lstrip("\n")
    return body[:cut] + "\n" + note + rest


def ensure_hidden(body: str) -> str:
    """保住 `disable-model-invocation: true`。

    这是 runtimia 侧独有的：进程技能（mommy / outpact / work-* / workflow-runner）
    不进模型可见的技能清单，只有 issue 正文点名时才加载。canonical 仓里**没有**这一行，
    所以照搬 canonical 会把隐藏撞掉——2026-09-05 首次跑 check 时就是靠 mommy/work-done
    那个 -31 字的负增长发现的。
    """
    flag = "disable-model-invocation: true"
    if not body.startswith("---"):
        return body
    end = body.find("\n---", 3)
    if end < 0 or flag in body[:end]:
        return body
    return body[:end] + "\n" + flag + body[end:]


def expected_body(entry: dict) -> str:
    src = Path(entry["source"]).expanduser()
    if entry.get("kind") == "file":
        return src.read_text(encoding="utf-8")
    body = (src / "SKILL.md").read_text(encoding="utf-8")
    if entry.get("hidden"):
        body = ensure_hidden(body)
    if (src / "scripts").is_dir() or (src / "schemas").is_dir():
        body = inject_note(body, src)
    return body


def git_state(src: Path, kind: str = "dir") -> dict:
    """canonical 源的 git 状态。脏就不推——半写完的技能比旧技能更危险。"""
    base = src if kind != "file" else src.parent
    top = run(["git", "-C", str(base), "rev-parse", "--show-toplevel"])
    if top.returncode != 0:
        return {"repo": None, "dirty": [], "head": None}
    if kind == "file":
        # kind=file 的源就是那一个文件本身，盯它自己；未跟踪也算脏，
        # 免得「源之源」自己没进版本库还被当成权威推出去。
        st = run(["git", "-C", str(base), "status", "--porcelain", "--", src.name])
        head = run(["git", "-C", str(base), "rev-parse", "--short", "HEAD"])
        return {"repo": top.stdout.strip(),
                "dirty": [l for l in st.stdout.splitlines() if l.strip()],
                "head": head.stdout.strip() or None}
    watch = ["SKILL.md"]
    if (src / "references").is_dir():
        watch.append("references")
    st = run(["git", "-C", str(src), "status", "--porcelain", "--", *watch])
    head = run(["git", "-C", str(src), "rev-parse", "--short", "HEAD"])
    return {
        "repo": top.stdout.strip(),
        "dirty": [l for l in st.stdout.splitlines() if l.strip()],
        "head": head.stdout.strip() or None,
    }


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_tmp(text: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".md", prefix="skillsync-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def check_one(name: str, entry: dict, skill_index: dict) -> dict:
    out: dict = {"name": name, "status": "ok", "notes": [], "body": None, "refs": {
        "changed": [], "missing": [], "extra": []}}
    src = Path(entry["source"]).expanduser()
    if not src.exists():
        out["status"] = "source-missing"
        out["notes"].append(f"源不存在：{src}")
        return out
    skill = skill_index.get(name)
    if not skill:
        out["status"] = "skill-missing"
        out["notes"].append(f"runtimia 里没有名为 {name} 的技能")
        return out
    out["id"] = skill["id"]

    g = git_state(src, entry.get("kind", "dir"))
    out["head"] = g["head"]
    if g["dirty"]:
        out["status"] = "source-dirty"
        out["notes"].append(f"canonical 工作区有未提交改动（{len(g['dirty'])} 项），跳过不推")

    want = expected_body(entry)
    live = multica_json(["skill", "get", skill["id"], "--with-content"]).get("content", "")
    if want != live:
        out["body"] = {"want": len(want), "live": len(live), "delta": len(want) - len(live)}
        if out["status"] == "ok":
            out["status"] = "drift"

    refdir = src / "references"
    if entry.get("kind") != "file" and refdir.is_dir():
        remote = {f["path"]: f for f in multica_json(["skill", "files", "list", skill["id"]])}
        local = {}
        for p in sorted(refdir.rglob("*")):
            if p.is_file() and not p.name.startswith("."):
                local[f"references/{p.relative_to(refdir)}"] = p
        for path, p in local.items():
            h = sha256_bytes(p.read_bytes())
            if path not in remote:
                out["refs"]["missing"].append(path)
            elif remote[path].get("content_hash") != h:
                out["refs"]["changed"].append(path)
        for path in remote:
            if path.startswith("references/") and path not in local:
                out["refs"]["extra"].append(path)
        if (out["refs"]["missing"] or out["refs"]["changed"]) and out["status"] == "ok":
            out["status"] = "drift"
        if out["refs"]["extra"]:
            out["notes"].append(
                "runtimia 多出 %d 个 reference（不自动删，删除不可恢复）：%s"
                % (len(out["refs"]["extra"]), ", ".join(out["refs"]["extra"][:5])))
    return out


def apply_one(name: str, entry: dict, res: dict) -> list[str]:
    done: list[str] = []
    sid = res["id"]
    src = Path(entry["source"]).expanduser()
    if res["body"]:
        tmp = write_tmp(expected_body(entry))
        try:
            r = run([MULTICA, "skill", "update", sid, "--content-file", tmp, "--output", "json"])
            if r.returncode != 0:
                raise RuntimeError(f"正文推送失败: {r.stderr.strip()[:300]}")
            done.append(f"SKILL.md {res['body']['live']} → {res['body']['want']} 字")
        finally:
            os.unlink(tmp)
    for path in res["refs"]["missing"] + res["refs"]["changed"]:
        local = src / path   # path 已经是 "references/x"，别再拼一次前缀
        tmp = write_tmp(local.read_text(encoding="utf-8"))
        try:
            r = run([MULTICA, "skill", "files", "upsert", sid, "--path", path,
                     "--content-file", tmp, "--output", "json"])
            if r.returncode != 0:
                raise RuntimeError(f"{path} 上传失败: {r.stderr.strip()[:200]}")
            done.append(path)
        finally:
            os.unlink(tmp)
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description="把 canonical 技能源同步到 runtimia")
    ap.add_argument("--apply", action="store_true", help="真的推平（默认只检查）")
    ap.add_argument("--only", action="append", default=[], help="只处理这些技能名，可重复")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    args = ap.parse_args()

    entries = json.loads(SOURCES.read_text(encoding="utf-8"))["skills"]
    if args.only:
        entries = {k: v for k, v in entries.items() if k in args.only}
        missing = set(args.only) - set(entries)
        if missing:
            print(f"sources.json 里没有：{', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    try:
        skill_index = {s["name"]: s for s in multica_json(["skill", "list"])}
    except Exception as e:
        print(f"[{now8()}] 连不上 runtimia：{e}", file=sys.stderr)
        return 2

    results = []
    for name, entry in entries.items():
        try:
            res = check_one(name, entry, skill_index)
        except Exception as e:
            res = {"name": name, "status": "error", "notes": [str(e)[:300]],
                   "body": None, "refs": {"changed": [], "missing": [], "extra": []}}
        if args.apply and res["status"] == "drift":
            try:
                res["applied"] = apply_one(name, entry, res)
                res["status"] = "synced"
            except Exception as e:
                res["status"] = "apply-failed"
                res["notes"].append(str(e)[:300])
        results.append(res)

    if args.json:
        print(json.dumps({"at": now8(), "results": results}, ensure_ascii=False, indent=2))
    else:
        print(f"[{now8()}] runtimia skill sync（{'apply' if args.apply else 'check'}）")
        for r in results:
            mark = {"ok": "  ok  ", "drift": " DRIFT", "synced": " 已同步",
                    "source-dirty": " 源脏 ", "source-missing": " 源缺 ",
                    "skill-missing": " 无技能", "error": " 出错 ",
                    "apply-failed": " 失败 "}.get(r["status"], r["status"])
            bits = []
            if r.get("body"):
                b = r["body"]
                bits.append(f"正文 {b['live']}→{b['want']}（{b['delta']:+d}）")
            n = len(r["refs"]["missing"]) + len(r["refs"]["changed"])
            if n:
                bits.append(f"reference {n} 个待同步")
            print(f"{mark} {r['name']:<20} {r.get('head') or '':<10} {'; '.join(bits)}")
            for note in r["notes"]:
                print(f"        ↳ {note}")
            for path in r.get("applied", []):
                print(f"        ✔ {path}")

    bad = [r for r in results if r["status"] in
           ("drift", "source-dirty", "source-missing", "skill-missing", "error", "apply-failed")]
    if bad:
        print(f"\n{len(bad)} 个技能未对齐：" +
              ", ".join(f"{r['name']}({r['status']})" for r in bad), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
