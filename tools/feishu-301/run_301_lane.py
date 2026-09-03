#!/usr/bin/env python3
"""
run_301_lane.py — 301 车道：飞书原文 → 过滤 → 预览 / 执行 → 回执。

边界（来自 docs/KICKOFF-301-VIA-ELF-20260902.md §3，不许越）：
  * 执行永远留在 ~/ptc_301。本脚本只做「解析 + 触发 + 回执」，不复制业务逻辑。
  * 301 是生产行为：默认只出预览（--dry-run），owner 明确确认后才允许 --apply。
  * 不接发版链，不新增 gate。

用法：
  run_301_lane.py preview --in msg.txt              # 解析 + 预览，落一份 pending
  run_301_lane.py apply   --token <t>               # owner 确认后真跑
  run_301_lane.py status                            # 看当前 pending
"""
from __future__ import annotations
import argparse, hashlib, json, os, subprocess, sys, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from parse_301_message import parse_message, render_redirects  # noqa: E402

PTC = Path("/Users/xin/ptc_301")
STATE = HERE / ".state"
PENDING = STATE / "pending.json"
CN = ZoneInfo("Asia/Shanghai")


def now() -> str:
    return datetime.datetime.now(CN).strftime("%Y-%m-%d %H:%M:%S +08")


def cmd_preview(args) -> int:
    text = Path(args.infile).read_text(encoding="utf-8") if args.infile else sys.stdin.read()
    rules, ignored = parse_message(text)
    if not rules:
        print("没有解析出任何合法规则，不生成 pending。")
        if ignored:
            print("被忽略的行：")
            for g in ignored:
                print(f"  L{g['line']} [{g['reason']}] {g['raw'][:70]}")
        return 1

    token = hashlib.sha1((json.dumps(rules, sort_keys=True) + now()).encode()).hexdigest()[:8]
    STATE.mkdir(parents=True, exist_ok=True)
    PENDING.write_text(json.dumps(
        {"token": token, "created_at": now(), "rules": rules, "ignored": ignored,
         "source_text": text}, ensure_ascii=False, indent=2), encoding="utf-8")

    adds = [r for r in rules if r["action"] == "301"]
    res = [r for r in rules if r["action"] == "restore"]
    print(f"【301 变更预览】token={token}   {now()}")
    print(f"新增 {len(adds)} 条 / 恢复 {len(res)} 条 / 忽略 {len(ignored)} 行\n")
    for r in adds:
        print(f"  +{r['source']} → {r['target']}")
    for r in res:
        print(f"  -{r['source']}")
    if ignored:
        print("\n被忽略的行（确认没有误杀）：")
        for g in ignored:
            print(f"  L{g['line']} [{g['reason']}] {g['raw'][:70]}")
    print(f"\n确认执行请回复：确认 {token}")
    return 0


def cmd_apply(args) -> int:
    if not PENDING.exists():
        print("没有待确认的变更。先跑 preview。", file=sys.stderr)
        return 2
    p = json.loads(PENDING.read_text(encoding="utf-8"))
    if args.token != p["token"]:
        print(f"token 不匹配：待确认的是 {p['token']}，收到 {args.token}", file=sys.stderr)
        return 2

    target = PTC / "scripts" / "redirects.txt"
    if target.exists():
        bak = target.with_suffix(f".txt.bak-{datetime.datetime.now(CN):%Y%m%d%H%M%S}")
        bak.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"已备份原 redirects.txt → {bak}")
    target.write_text(render_redirects(p["rules"]), encoding="utf-8")
    print(f"已写入 {target}（{len(p['rules'])} 条）")

    cmd = [sys.executable, "scripts/redirect-cli.py", "run"]
    if args.dry_run:
        cmd.append("--dry-run")
    print(f"\n执行：{' '.join(cmd)}  (cwd={PTC})\n" + "=" * 60)
    r = subprocess.run(cmd, cwd=PTC, capture_output=True, text=True, timeout=1800)
    out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
    print(out[-4000:])
    print("=" * 60)
    print(f"exit code = {r.returncode}   {now()}")

    p["applied_at"] = now()
    p["exit_code"] = r.returncode
    p["dry_run"] = bool(args.dry_run)
    (STATE / f"applied-{p['token']}.json").write_text(
        json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")
    if not args.dry_run and r.returncode == 0:
        PENDING.unlink(missing_ok=True)
    # 失败必须如实报错，不吞异常
    return r.returncode


def cmd_status(_args) -> int:
    if not PENDING.exists():
        print("无待确认变更。")
        return 0
    p = json.loads(PENDING.read_text(encoding="utf-8"))
    print(f"token={p['token']}  创建于 {p['created_at']}  规则 {len(p['rules'])} 条")
    for r in p["rules"]:
        print(f"  {'+' if r['action']=='301' else '-'}{r['source']}"
              + (f" → {r['target']}" if r.get('target') else ""))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("preview"); p1.add_argument("--in", dest="infile"); p1.set_defaults(fn=cmd_preview)
    p2 = sub.add_parser("apply"); p2.add_argument("--token", required=True)
    p2.add_argument("--dry-run", action="store_true"); p2.set_defaults(fn=cmd_apply)
    p3 = sub.add_parser("status"); p3.set_defaults(fn=cmd_status)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
