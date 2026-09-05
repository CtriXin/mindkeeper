#!/bin/bash
# launchd 入口。刻意不用 launchd 的 StandardOutPath 直写：它只追加、不轮转，
# 半年后就是个几百 MB 的文件。这里自己截断。
set -uo pipefail
export TZ=Asia/Singapore
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/.local/state/runtimia-skill-sync"
LOG="$LOG_DIR/sync.log"
mkdir -p "$LOG_DIR"

# 超过 2MB 就只留后 1000 行，别让日志无限长
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 2097152 ]; then
  tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

{
  /usr/bin/python3 "$HERE/sync.py" "${@:---apply}" 2>&1
  echo "  ↳ 退出码 $?"
  echo
} >> "$LOG"
