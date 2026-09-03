#!/usr/bin/env python3
"""
parse_301_message.py — 把转发来的飞书聊天原文，过滤成只含合法 301 规则的 redirects.txt。

为什么不能直接喂给 redirect-cli.py：
  scripts/redirect-cli.py 的 parse_batch_line() 末尾有一个兜底分支 ——
      parts = line.split()
      if len(parts) >= 2: return '301', normalize_domain(parts[0]), parts[1]
  任何「两个 token 用空格隔开」的行都会变成一条 301 规则。实测（2026-09-03）：
      '@宋鑫 新增需求~'        → ('301', '@宋鑫', '新增需求~')
      '这个域名有问题 麻烦看下'  → ('301', '这个域名有问题', '麻烦看下')
  转发来的聊天文本必然踩中。所以本脚本采用白名单：只认 + / - / 301: / restore: 开头，
  且源与目标都必须过域名正则；不合格整行丢弃并列入「被忽略行」清单供 owner 复核。

用法：
  python3 parse_301_message.py --in message.txt --out redirects.txt
  cat message.txt | python3 parse_301_message.py            # 只预览，不写文件
  python3 parse_301_message.py --in msg.txt --json          # 机器可读
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

# 域名：可带 http(s):// 前缀与尾斜杠，至少一个点，TLD 2+ 位
DOMAIN_RE = re.compile(
    r'^(?:https?://)?'
    r'((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})'
    r'(?:[/:?#].*)?$', re.I)

PREFIXES = ('+', '-', '301:', 'restore:')


# 飞书里域名是超链接，复制粘贴可能带出这些包裹形态
MD_LINK_RE = re.compile(r'^\[([^\]]+)\]\((?:[^)]*)\)$')      # [text](url)
ANGLE_RE = re.compile(r'^<(.+)>$')                             # <domain>


def unwrap(token: str) -> str:
    """剥掉飞书超链接粘贴带出来的包裹：markdown 链接、尖括号、首尾标点。"""
    t = (token or '').strip().strip('\u3000')                   # 含全角空格
    for _ in range(3):                                          # 可能嵌套
        m = MD_LINK_RE.match(t)
        if m:
            t = m.group(1).strip(); continue
        m = ANGLE_RE.match(t)
        if m:
            t = m.group(1).strip(); continue
        break
    return t.rstrip('.,;，。、')


def normalize(token: str) -> str | None:
    """通过域名校验则返回规范化域名（去协议、去路径、去包裹、小写），否则 None。"""
    m = DOMAIN_RE.match(unwrap(token))
    return m.group(1).lower() if m else None


def parse_line(raw: str):
    """→ (action, source, target, reason)。action 为 None 表示丢弃，reason 说明原因。"""
    line = raw.strip()
    if not line:
        return None, None, None, 'empty'
    if line.startswith('#'):
        return None, None, None, 'comment'
    if not line.startswith(PREFIXES):
        return None, None, None, 'no-prefix'          # 关键：不给兜底分支任何机会
    if '→' in line or '重定向到' in line or '取消 301' in line:
        # 预览输出被误当成输入喂回来。宁可整行丢弃并报出来，也不要写出半截规则。
        return None, None, None, 'looks-like-preview-output'

    if line.startswith('301:'):
        body, action = line[4:].strip(), '301'
    elif line.startswith('restore:'):
        body, action = line[8:].strip(), 'restore'
    elif line.startswith('+'):
        body, action = line[1:].strip(), '301'
    else:
        body, action = line[1:].strip(), 'restore'

    body = body.replace('->', ' ').replace('\u3000', ' ')
    parts = body.split()
    if not parts:
        return None, None, None, 'empty-body'

    src = normalize(parts[0])
    if not src:
        return None, None, None, f'bad-source:{parts[0][:30]!r}'

    # 行尾多余 token 必须报出来，不能静默吞掉 —— 飞书把消息压平后，
    # '@宋鑫 新增需求~' 会黏在最后一条规则后面。
    extra = parts[2:] if action == '301' else parts[1:]
    tail = ('ok+trailing:' + ' '.join(extra)[:40]) if extra else 'ok'

    if action == 'restore':
        return 'restore', src, None, tail

    if len(parts) < 2:
        return None, None, None, 'missing-target'
    dst = normalize(parts[1])
    if not dst:
        return None, None, None, f'bad-target:{parts[1][:30]!r}'
    if src == dst:
        return None, None, None, 'source-equals-target'
    return '301', src, dst, tail


def parse_message(text: str):
    rules, ignored, seen = [], [], set()
    for i, raw in enumerate(text.splitlines(), 1):
        action, src, dst, reason = parse_line(raw)
        if action is not None and reason.startswith('ok+trailing:'):
            ignored.append({'line': i, 'raw': reason.split(':', 1)[1],
                            'reason': 'trailing-dropped'})
        if action is None:
            if reason not in ('empty', 'comment'):
                ignored.append({'line': i, 'raw': raw.strip(), 'reason': reason})
            continue
        key = (action, src)
        if key in seen:
            ignored.append({'line': i, 'raw': raw.strip(), 'reason': 'duplicate'})
            continue
        seen.add(key)
        rules.append({'line': i, 'action': action, 'source': src, 'target': dst})
    return rules, ignored


def render_redirects(rules) -> str:
    out = ["# 由 parse_301_message.py 生成，仅含通过域名校验的规则", ""]
    out += [f"+{r['source']} {r['target']}" if r['action'] == '301' else f"-{r['source']}"
            for r in rules]
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--in', dest='infile', help='飞书原文文件；省略则读 stdin')
    ap.add_argument('--out', help='写出 redirects.txt 路径；省略则只预览')
    ap.add_argument('--json', action='store_true', help='输出 JSON')
    args = ap.parse_args()

    text = Path(args.infile).read_text(encoding='utf-8') if args.infile else sys.stdin.read()
    rules, ignored = parse_message(text)
    adds = [r for r in rules if r['action'] == '301']
    restores = [r for r in rules if r['action'] == 'restore']

    if args.json:
        print(json.dumps({'rules': rules, 'ignored': ignored,
                          'summary': {'add': len(adds), 'restore': len(restores),
                                      'ignored': len(ignored)}}, ensure_ascii=False, indent=2))
    else:
        print(f"新增 {len(adds)} 条 / 恢复 {len(restores)} 条 / 忽略 {len(ignored)} 行\n")
        # 预览刻意不用 "+src target" 的输入格式：这段文本会被复制来复制去，
        # 一旦被当成输入喂回去，'→' 会变成目标域名的一部分，写出
        # { to: 'https://→' } 这种坏规则（2026-09-03 真实发生过）。
        if adds:
            print("新增 301：")
            for r in adds:
                print(f"  [{r['source']}]  重定向到  [{r['target']}]")
        if restores:
            print("恢复：")
            for r in restores:
                print(f"  [{r['source']}]  取消 301")
        if ignored:
            print("\n被忽略的行（请确认没有误杀）：")
            for g in ignored:
                print(f"  L{g['line']:<3} [{g['reason']}] {g['raw'][:64]}")

    if args.out:
        Path(args.out).write_text(render_redirects(rules), encoding='utf-8')
        print(f"\n已写入 {args.out}（{len(rules)} 条规则）")
    return 0 if rules else 1


if __name__ == '__main__':
    raise SystemExit(main())
