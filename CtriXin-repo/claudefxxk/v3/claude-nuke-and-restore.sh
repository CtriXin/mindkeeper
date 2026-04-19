#!/bin/bash
# ============================================================================
# Claude 完全隔离 + 指纹重置脚本 v3（最终版）
# 目标: 让 Claude 不认识这台电脑
# 修复:
#   - TIMESTAMP 正确定义
#   - Python hook 路径修复用 shlex.split
#   - 不用 find $HOME，改用明确路径列表
#   - 每大类可选执行
#   - 完全隔离导向
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# DRY_RUN=1: 只打印 destructive 命令，不实际执行
DRY_RUN=${DRY_RUN:-0}
if [ "$DRY_RUN" = "1" ]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}🔍 DRY-RUN 模式: 所有 destructive 命令只打印不执行${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
fi

dry() {
    if [ "$DRY_RUN" = "1" ]; then
        echo -e "${BLUE}[DRY-RUN]${NC} $*"
        return 0
    else
        "$@"
    fi
}

# P0: $HOME 虚拟化检测 — 必须在真实终端运行
REAL_HOME=$(eval echo "~$(whoami)")
if [ "$HOME" != "$REAL_HOME" ]; then
    echo -e "${RED}❌ 错误: \$HOME 被虚拟化${NC}"
    echo -e "${YELLOW}   当前 \$HOME: $HOME${NC}"
    echo -e "${YELLOW}   真实 home:   $REAL_HOME${NC}"
    echo -e "${YELLOW}   此脚本必须在真实终端运行，不能在 Claude/MMS session 内执行。${NC}"
    exit 1
fi

SAFE_ZONE="$HOME/claude_safe_zone"
CODEX_BF="$HOME/claude_safe_zone/codex-safe-zone-backfill-20260418"
# P0: 找到最新的 backup-run 目录（backup-missing-to-safe-zone.sh 的输出）
LATEST_BACKUP=$(ls -dt "$SAFE_ZONE"/backup-run-* 2>/dev/null | head -1)
if [ -z "$LATEST_BACKUP" ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️ 未找到 backup-run-* 目录${NC}"
    echo -e "${YELLOW}   建议先运行: ./backup-missing-to-safe-zone.sh${NC}"
    # P0: 列出 safe_zone 顶层实际缺失的资产
    MISSING_ASSETS=""
    [ ! -d "$SAFE_ZONE/plugins" ] && MISSING_ASSETS="$MISSING_ASSETS plugins"
    [ ! -f "$SAFE_ZONE/settings.local.json" ] && MISSING_ASSETS="$MISSING_ASSETS settings.local.json"
    [ ! -f "$SAFE_ZONE/RTK.md" ] && MISSING_ASSETS="$MISSING_ASSETS RTK.md"
    [ ! -d "$SAFE_ZONE/skills" ] && MISSING_ASSETS="$MISSING_ASSETS skills"
    if [ -n "$MISSING_ASSETS" ]; then
        echo -e "${RED}   以下资产在 safe_zone 顶层也不存在，恢复阶段将完全缺失:${NC}"
        echo -e "${RED}   $MISSING_ASSETS${NC}"
    fi
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    read -p "仍要继续? [y/N]: " NO_BACKUP_CONTINUE
    [ "$NO_BACKUP_CONTINUE" != "y" ] && [ "$NO_BACKUP_CONTINUE" != "Y" ] && exit 1
fi

echo -e "${RED}"
echo "========================================"
echo "  Claude 完全隔离 + 指纹重置 v3"
echo "========================================"
echo -e "${NC}"
echo "目标: 让 Claude 不认识这台电脑"
echo ""
echo "前置要求:"
echo "  ✅ 已在 Anthropic/MMS 仪表板撤销 Token"
echo "  ✅ git repo 已 push"
echo "  ✅ 已运行 backup-missing-to-safe-zone.sh"
echo ""

read -p "输入 [ISOLATE] 开始: " CONFIRM
[ "$CONFIRM" != "ISOLATE" ] && echo "已取消" && exit 0

[ ! -d "$SAFE_ZONE" ] && echo -e "${RED}❌ safe_zone 不存在${NC}" && exit 1

CODEX_EXISTS=false
[ -d "$CODEX_BF" ] && CODEX_EXISTS=true

# P1: 在阶段 2 删除 ~/.claude.json 之前快照 userID，供阶段 16 对比
OLD_USERID=""
if [ -f "$HOME/.claude.json" ]; then
    OLD_USERID=$(python3 -c "import json; d=json.load(open('$HOME/.claude.json')); print(d.get('userID',''))" 2>/dev/null || echo "")
fi

# ============================================================================
# 阶段 0: 前置确认
# ============================================================================
echo ""
echo "========================================"
echo "阶段 0: 前置确认"
echo "========================================"

# P3: 依赖前置检查
echo "[0.0] 依赖检查..."
command -v python3 >/dev/null 2>&1 || { echo -e "${RED}❌ 缺少 python3，阶段 17.6 需要它${NC}"; exit 1; }
echo "  ✓ python3 可用"

# 备份验证
echo ""
echo "[0.1] 备份验证..."
echo "  （备份说明: 每次运行 backup-missing-to-safe-zone.sh 会新增一个 backup-run-YYYYMMDD-HHMMSS/ 目录，不会删除旧备份）"
if [ -n "$LATEST_BACKUP" ]; then
    BACKUP_TIME=$(stat -f "%Sm" "$LATEST_BACKUP" 2>/dev/null || echo "未知")
    echo "  ✓ 找到备份: $(basename "$LATEST_BACKUP")"
    echo "    创建时间: $BACKUP_TIME"
    echo "    内容:"
    [ -f "$LATEST_BACKUP/CLAUDE.md" ] && echo "      ✓ CLAUDE.md"
    [ -d "$LATEST_BACKUP/plugins" ] && echo "      ✓ plugins/"
    [ -f "$LATEST_BACKUP/settings-current-session-sanitized.json" ] && echo "      ✓ settings-current-session-sanitized.json"
    [ -f "$LATEST_BACKUP/settings.local.json" ] && echo "      ✓ settings.local.json"
    [ -d "$LATEST_BACKUP/skills-entity" ] && echo "      ✓ skills-entity/"
    [ -f "$LATEST_BACKUP/skills.symlink-map.txt" ] && echo "      ✓ skills.symlink-map.txt"
    [ -f "$LATEST_BACKUP/RTK.md" ] || echo "      ⊘ RTK.md（缺失，不影响执行）"
    read -p "  这是你的最新备份吗? [y=继续/n=重新备份]: " BACKUP_CONFIRM
    if [ "$BACKUP_CONFIRM" = "n" ] || [ "$BACKUP_CONFIRM" = "N" ]; then
        echo "  → 请重新运行 ./backup-missing-to-safe-zone.sh 后再执行本脚本"
        exit 1
    fi
else
    echo -e "  ${RED}❌ 未找到 backup-run-* 目录${NC}"
    if [ "$DRY_RUN" = "1" ]; then
        echo -e "  ${BLUE}[DRY-RUN]${NC} 跳过自动备份，继续流程"
    else
        echo "  将自动执行备份脚本..."
        SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
        "$SCRIPT_DIR/backup-missing-to-safe-zone.sh"
        LATEST_BACKUP=$(ls -dt "$SAFE_ZONE"/backup-run-* 2>/dev/null | head -1)
        if [ -z "$LATEST_BACKUP" ]; then
            echo -e "${RED}❌ 备份失败，退出${NC}"
            exit 1
        fi
        echo "  ✓ 备份完成: $(basename "$LATEST_BACKUP")"
    fi
fi

echo ""
echo "[0.2] API key 检查..."
echo "  如果你用过 Claude API key（类似 sk-xxx 的密钥），建议先删除。"
echo "  只用过浏览器 OAuth 登录的用户没有 API key，直接选 y。"
read -p "  是否已删除 Claude API key（或没有 API key）? [y/N]: " TOKEN_OK
[ "$TOKEN_OK" != "y" ] && [ "$TOKEN_OK" != "Y" ] && exit 1

AGENT_IM_DIR="$HOME/auto-skills/CtriXin-repo/agent-im"
DIRTY_COUNT=0
if [ -d "$AGENT_IM_DIR/.git" ]; then
    DIRTY_COUNT=$(cd "$AGENT_IM_DIR" && git status --short 2>/dev/null | wc -l | tr -d ' ')
    [ "$DIRTY_COUNT" -gt 0 ] && echo -e "${YELLOW}⚠️ agent-im 有 $DIRTY_COUNT 个未提交修改${NC}"
fi

echo "[0.3] 关键 repo 检查..."
for repo in \
    "$HOME/auto-skills/CtriXin-repo/multi-model-switch" \
    "$HOME/auto-skills/CtriXin-repo/agent-im" \
    "$HOME/auto-skills/CtriXin-repo/mindkeeper"
do
    [ ! -d "$repo" ] && echo -e "${YELLOW}⚠ $repo 不存在${NC}"
done

# ============================================================================
# 阶段 1: 杀进程
# ============================================================================
echo ""
echo "========================================"
echo "阶段 1: 杀进程"
echo "========================================"
# 精确匹配进程名，避免误杀含 claude 的其他进程（如 codex-watcher）
# MMS 工作保存确认 + 进程展示
echo ""
echo "[0.4] 进程检查 & MMS 工作保存确认..."
echo "  ──────────────────────────────"

# 检查进程是否是 MMS 子进程
is_mms_child() {
    local pid=$1
    local p=$pid
    while [ -n "$p" ] && [ "$p" != "1" ]; do
        local ppid=$(ps -p "$p" -o ppid= 2>/dev/null | tr -d ' ')
        local pname=$(ps -p "$ppid" -o comm= 2>/dev/null | tr -d ' ')
        if [ "$pname" = "mms" ]; then
            return 0
        fi
        p=$ppid
    done
    return 1
}

# --- Claude CLI (claude) ---
CL_PIDS=$(pgrep -x "claude" 2>/dev/null) || true
CL_INDEP=0
CL_MMS=0
for cpid in $CL_PIDS; do
    [ -z "$cpid" ] && continue
    if is_mms_child "$cpid"; then
        CL_MMS=$((CL_MMS + 1))
    else
        CL_INDEP=$((CL_INDEP + 1))
    fi
done

if [ "$CL_INDEP" -gt 0 ]; then
    echo "  • 独立 Claude CLI: $CL_INDEP 个 [阶段1会被终止]"
    for cpid in $CL_PIDS; do
        [ -z "$cpid" ] && continue
        if ! is_mms_child "$cpid"; then
            ctt=$(ps -p "$cpid" -o tty= 2>/dev/null | tr -d ' ')
            args=$(ps -p "$cpid" -o args= 2>/dev/null | head -c 70)
            echo "      PID $cpid (terminal: $ctt)"
            echo "        └─ $args"
        fi
    done
fi
if [ "$CL_MMS" -gt 0 ]; then
    echo "  • MMS 启动的 Claude/Codex CLI: $CL_MMS 个 [阶段1会被终止]"
    for cpid in $CL_PIDS; do
        [ -z "$cpid" ] && continue
        if is_mms_child "$cpid"; then
            ctt=$(ps -p "$cpid" -o tty= 2>/dev/null | tr -d ' ')
            args=$(ps -p "$cpid" -o args= 2>/dev/null | head -c 70)
            echo "      PID $cpid (terminal: $ctt) [MMS子进程]"
            echo "        └─ $args"
        fi
    done
fi

# --- claude-code ---
CC_PIDS=$(pgrep -x "claude-code" 2>/dev/null) || true
CC_INDEP=0
CC_MMS=0
for cpid in $CC_PIDS; do
    [ -z "$cpid" ] && continue
    if is_mms_child "$cpid"; then
        CC_MMS=$((CC_MMS + 1))
    else
        CC_INDEP=$((CC_INDEP + 1))
    fi
done
if [ "$CC_INDEP" -gt 0 ]; then
    echo "  • 独立 claude-code: $CC_INDEP 个 [阶段1会被终止]"
    for cpid in $CC_PIDS; do
        [ -z "$cpid" ] && continue
        if ! is_mms_child "$cpid"; then
            ctt=$(ps -p "$cpid" -o tty= 2>/dev/null | tr -d ' ')
            args=$(ps -p "$cpid" -o args= 2>/dev/null | head -c 70)
            echo "      PID $cpid (terminal: $ctt)"
            echo "        └─ $args"
        fi
    done
fi
if [ "$CC_MMS" -gt 0 ]; then
    echo "  • MMS 启动的 claude-code: $CC_MMS 个 [阶段1会被终止]"
    for cpid in $CC_PIDS; do
        [ -z "$cpid" ] && continue
        if is_mms_child "$cpid"; then
            ctt=$(ps -p "$cpid" -o tty= 2>/dev/null | tr -d ' ')
            args=$(ps -p "$cpid" -o args= 2>/dev/null | head -c 70)
            echo "      PID $cpid (terminal: $ctt) [MMS子进程]"
            echo "        └─ $args"
        fi
    done
fi

# --- Claude Desktop ---
CD_COUNT=$(pgrep -x "Claude" 2>/dev/null | wc -l | tr -d ' ')
[ "$CD_COUNT" -gt 0 ] && echo "  • Claude Desktop: $CD_COUNT 个 [阶段1会被终止]"

# --- MMS 主进程 ---
MMS_COUNT=$(pgrep -f "mms$" 2>/dev/null | wc -l | tr -d ' ')
if [ "$MMS_COUNT" -gt 0 ]; then
    echo "  • MMS 主进程: $MMS_COUNT 个 [保留，不会被终止]"
    for mpid in $(pgrep -f "mms$" 2>/dev/null | tr '\n' ' '); do
        [ -z "$mpid" ] && continue
        mtt=$(ps -p "$mpid" -o tty= 2>/dev/null | tr -d ' ')
        [ -n "$mtt" ] && echo "      PID $mpid (terminal: $mtt)"
    done
fi

# --- Chrome ---
CHROME_COUNT=$(pgrep -x "Google Chrome" 2>/dev/null | wc -l | tr -d ' ')
[ "$CHROME_COUNT" -gt 0 ] && echo "  • Chrome: 正在运行（阶段 8 可选关闭）"

# 无进程提示
TOTAL_CLAUDE=$((CL_INDEP + CL_MMS + CC_INDEP + CC_MMS + CD_COUNT))
[ "$TOTAL_CLAUDE" -eq 0 ] && [ "$MMS_COUNT" -eq 0 ] && echo "  • 无 Claude/MMS 进程在运行"

echo "  ──────────────────────────────"
echo ""
echo "  ⚠️  阶段 1 会终止所有 Claude / claude / claude-code 进程（含 MMS 子进程）。"
echo "     MMS 主进程(mms)保留。MMS 配置(~/.config/mms/)保留。"
echo "     终止后可在 MMS 中重新连接/启动 session，不会丢失 MMS session 配置。"
read -p "  MMS 工作已保存? [y/N]: " MMS_SAVED
[ "$MMS_SAVED" != "y" ] && [ "$MMS_SAVED" != "Y" ] && exit 1

# 1) 先杀 Desktop App 子进程（必须在主进程之前，否则 pgrep 拿不到 PID）
for desktop_pid in $(pgrep -x "Claude" 2>/dev/null | tr '\n' ' '); do
    [ -z "$desktop_pid" ] && continue
    dry pkill -9 -P "$desktop_pid" 2>/dev/null || true
done

# 2) 再杀主进程
dry pkill -9 -x "Claude" 2>/dev/null || true
dry pkill -9 -x "claude" 2>/dev/null || true
dry pkill -9 -x "claude-code" 2>/dev/null || true

# 3) 兜底：按路径匹配 CLI 进程（避免误杀 hive 等含 "claude" 的进程）
dry pkill -9 -f "\.local/bin/claude" 2>/dev/null || true
dry pkill -9 -f "claude-code/dist" 2>/dev/null || true

echo "  ✓ 已终止"
sleep 2

# ============================================================================
# 阶段 2: 核心身份文件（必选）
# ============================================================================
echo ""
echo "========================================"
echo "阶段 2: 核心身份文件"
echo "========================================"
dry rm -f "$HOME/.claude.json" "$HOME/.claude.json.backup" "$HOME/.claude.json.backup."* "$HOME/.claude.json.bak"*
# 备份 .claude.bak 到项目目录后再清理
    BACKUP_DIR="$HOME/auto-skills/CtriXin-repo/claudefxxk/backups/backup-$TIMESTAMP"
    dry mkdir -p "$BACKUP_DIR"
    [ -d "$HOME/.claude.bak" ] && dry mv "$HOME/.claude.bak" "$BACKUP_DIR/" && echo "  → .claude.bak 已备份到 $BACKUP_DIR"
    dry rm -rf "$HOME/.claude"
    # P0: 精细化清理 ~/.cc-switch — 只删敏感数据（db/logs/backups），保留配置和 skills
    if [ -d "$HOME/.cc-switch" ]; then
        dry rm -rf "$HOME/.cc-switch/logs" "$HOME/.cc-switch/backups"
        dry rm -f "$HOME/.cc-switch/cc-switch.db" "$HOME/.cc-switch/cc-switch2.db"
        echo "  ✓ ~/.cc-switch 敏感数据已清除（保留 settings.json、skills、skills-review.md）"
    fi
echo "  ✓ ~/.claude.json / ~/.claude 已清除（.claude.bak 已备份）"

# ============================================================================
# 阶段 3: Keychain（必选）
# ============================================================================
echo ""
echo "========================================"
echo "阶段 3: Keychain 凭证"
echo "========================================"
for key in "Claude Safe Storage" "Claude Code-credentials" "Claude Code-credentials-e549de00" "claude-code" "claude-code-credentials"; do
    dry security delete-generic-password -s "$key" 2>/dev/null || true
    dry security delete-generic-password -s "$key" -a "Claude" 2>/dev/null || true
    dry security delete-generic-password -s "$key" -a "Claude Key" 2>/dev/null || true
    dry security delete-generic-password -s "$key" -a "xin" 2>/dev/null || true
    dry security delete-generic-password -s "$key" -a "unknown" 2>/dev/null || true
done
KC_RESIDUE=$(security dump-keychain 2>/dev/null | grep -ic "claude" || true)
[ -z "$KC_RESIDUE" ] && KC_RESIDUE=0
[ "$KC_RESIDUE" -gt 0 ] && echo -e "  ${YELLOW}⚠ Keychain 仍有 $KC_RESIDUE 条残留，请手动检查${NC}" || echo "  ✓ Keychain 已清理"

# ============================================================================
# 阶段 4-8: 可选大类（每类单独确认）
# ============================================================================

run_phase() {
    local num="$1" name="$2" desc="$3"
    echo ""
    echo "========================================"
    echo "阶段 $num: $name"
    echo "========================================"
    echo "$desc"
    read -p "执行? [y/N]: " OK
    [ "$OK" = "y" ] || [ "$OK" = "Y" ]
}

# --- 4: Desktop App ---
if run_phase "4" "Desktop App 数据" "删除 ~/Library/Application Support/Claude、Caches、HTTPStorages、Preferences"; then
    dry rm -rf "$HOME/Library/Application Support/Claude"
    dry rm -rf "$HOME/Library/Caches/com.anthropic.claudefordesktop"*
    dry rm -rf "$HOME/Library/HTTPStorages/com.anthropic.claudefordesktop"
    dry rm -f "$HOME/Library/Preferences/com.anthropic.claudefordesktop.plist"
    dry rm -f "$HOME/Library/Preferences/ByHost/com.anthropic.claudefordesktop.ShipIt"*.plist
    dry rm -rf "$HOME/Library/Logs/Claude"
    dry rm -rf "$HOME/Library/Saved Application State/com.anthropic.claudefordesktop.savedState"
    dry rm -rf "$HOME/Library/WebKit/com.anthropic.claudefordesktop"
    dry defaults delete com.anthropic.claudefordesktop 2>/dev/null || true
    echo "  ✓ Desktop App 数据已清除"
fi

# --- 5: CLI 安装物 ---
if run_phase "5" "CLI 安装物" "删除 ~/.local/share/claude、~/.local/bin/claude、npm figma-mcp"; then
    dry rm -f "$HOME/.local/bin/claude" "$HOME/.local/bin/claude.bak"*
    dry rm -rf "$HOME/.local/share/claude" "$HOME/.local/state/claude" "$HOME/.cache/claude"
    dry rm -rf "$HOME/Library/Caches/claude-cli-nodejs"
    dry npm uninstall -g claude-talk-to-figma-mcp 2>/dev/null || true
    echo "  ✓ CLI 安装物已清除"
fi

# --- 6: IDE 扩展 ---
if run_phase "6" "IDE 扩展" "删除 VS Code Claude 扩展、Zed ACP、Code logs"; then
    dry rm -rf "$HOME/.vscode/extensions/anthropic.claude-code-"*
    dry rm -rf "$HOME/Library/Application Support/Code/logs/"*/"window"*"/exthost/Anthropic.claude-code"
    dry rm -rf "$HOME/Library/Application Support/Code/CachedExtensionVSIXs/anthropic.claude-code-"*
    dry rm -rf "$HOME/Library/Application Support/Zed/external_agents/claude-code-acp"
    echo "  ✓ IDE 扩展已清除"
fi

# --- 7: MMS/MMC 网关层 ---
if run_phase "7" "MMS/MMC 网关层" "删除所有 session、account、gateway、backup、token_cache"; then
    for f in "$HOME/.config/mms/claude-gateway/s"/*/.claude.json; do [ -f "$f" ] && dry rm -f "$f"; done
    for d in "$HOME/.config/mms/claude-gateway/s"/*/.claude; do [ -d "$d" ] && dry rm -rf "$d"; done
    # P1: 只删 session 内的 Claude 状态目录，不动 bridge 元数据（.mms_slot.json 等）
    for sd in "$HOME/.config/mms/claude-gateway/s"/*; do
        [ -d "$sd" ] || continue
        dry rm -rf "$sd/.claude" 2>/dev/null || true
        dry rm -f "$sd/.claude.json" 2>/dev/null || true
    done
    dry rm -f "$HOME/.config/mms/claude-gateway/.claude.json"
    dry rm -rf "$HOME/.config/mms/claude-gateway/.claude"
    for ad in "$HOME/.config/mms/accounts/"*; do
        [ -d "$ad" ] || continue
        dry rm -f "$ad/.claude.json" 2>/dev/null || true
        dry rm -rf "$ad/.claude" 2>/dev/null || true
    done
    dry rm -rf "$HOME/.config/mms/accounts-archived" "$HOME/.config/mms-backups" "$HOME/.mms/token_cache"
    dry rm -f "$HOME/.config/mms/events/"*.jsonl "$HOME/.config/mms/config-audit.jsonl"
    for raw in "$HOME/.config/mms/projects"/*/claude/raw; do
        [ -d "$raw" ] || continue
        dry rm -rf "$raw/sessions" "$raw/transcripts" "$raw/file-history" 2>/dev/null || true
        dry rm -f "$raw/history.jsonl" 2>/dev/null || true
    done
    dry rm -f "$HOME/.config/mmc/accounts/default/.claude.json"
    dry rm -rf "$HOME/.config/mmc/accounts/default/.claude"
    echo "  ✓ MMS/MMC 已清除"
fi

# --- 8: 浏览器数据 ---
if run_phase "8" "浏览器数据" "删除 Chrome 各 Profile 中与 Claude 相关的 IndexedDB、Cookie、Local Storage（其他网站不受影响，清理后需重新 OAuth）"; then
    SKIP_CHROME=false
    # P1: 检查 Chrome 是否在运行
    if pgrep -x "Google Chrome" >/dev/null 2>&1; then
        echo -e "  ${YELLOW}⚠️ Google Chrome 正在运行${NC}"
        echo "  本阶段只会清理 Chrome 中与 Claude 相关的记录（Cookie/IndexedDB/Local Storage），"
        echo "  不会清除其他网站的登录状态。清理后需要重新 OAuth 登录 Claude。"
        echo ""
        echo "  选择:"
        echo "    [s] 跳过浏览器清理"
        echo "    [k] 自动关闭 Chrome 并清理"
        echo "    [回车] 我已手动退出 Chrome，继续清理"
        read -p "  请选择 [s/k/回车]: " CHROME_CHOICE
        if [ "$CHROME_CHOICE" = "s" ] || [ "$CHROME_CHOICE" = "S" ]; then
            echo "  ⊘ 跳过浏览器清理"
            SKIP_CHROME=true
        elif [ "$CHROME_CHOICE" = "k" ] || [ "$CHROME_CHOICE" = "K" ]; then
            echo "  → 正在关闭 Chrome..."
            dry pkill -9 -x "Google Chrome" 2>/dev/null || true
            sleep 2
            echo "  ✓ Chrome 已关闭，继续清理"
        else
            # 默认分支：用户说已手动退出，二次确认
            CHROME_STILL_RUNNING=$(pgrep -x "Google Chrome" 2>/dev/null | wc -l | tr -d ' ')
            if [ "$CHROME_STILL_RUNNING" -gt 0 ]; then
                echo -e "  ${YELLOW}⚠️  Chrome 似乎仍在运行（检测到 $CHROME_STILL_RUNNING 个进程）${NC}"
                echo "     建议先完全退出 Chrome（Cmd+Q），否则 Cookie 清理可能失败。"
                read -p "     已确认 Chrome 完全退出? [y/N]: " CHROME_CONFIRM
                if [ "$CHROME_CONFIRM" != "y" ] && [ "$CHROME_CONFIRM" != "Y" ]; then
                    echo "  ⊘ 跳过浏览器清理"
                    SKIP_CHROME=true
                fi
            fi
        fi
    fi
    if [ "$SKIP_CHROME" != true ]; then
        # P1: 检查 sqlite3 可用性
        SQLITE_AVAILABLE=false
        if command -v sqlite3 >/dev/null 2>&1; then
            SQLITE_AVAILABLE=true
        else
            echo -e "  ${YELLOW}⚠️ 未找到 sqlite3，跳过 Cookie 清理${NC}"
        fi
        CHROME_BASE="$HOME/Library/Application Support/Google/Chrome"
        if [ -d "$CHROME_BASE" ]; then
            for profile in "$CHROME_BASE/Default" "$CHROME_BASE/Profile "*; do
                [ -d "$profile" ] || continue
                dry find "$profile/IndexedDB" -name "*claude*" -type d -exec rm -rf {} + 2>/dev/null || true
                [ "$SQLITE_AVAILABLE" = true ] && dry sqlite3 "$profile/Cookies" "DELETE FROM cookies WHERE host_key LIKE '%claude.ai%' OR host_key LIKE '%anthropic.com%';" 2>/dev/null || true
                dry find "$profile/Local Storage" -name "*claude*" -delete 2>/dev/null || true
                dry find "$profile/Session Storage" -name "*claude*" -delete 2>/dev/null || true
            done
        fi
        dry find "$HOME/Library/Application Support/Google/Chrome" -name "com.anthropic.claude_browser_extension.json" -delete 2>/dev/null || true
        dry find "$HOME/Library/Application Support/com.openai.atlas" -name "*claude*" -type d -exec rm -rf {} + 2>/dev/null || true
        echo "  ✓ 浏览器已清理"
    fi
fi

# --- 9: /tmp ---
if run_phase "9" "/tmp 临时文件" "删除 /tmp/claude-501 等"; then
    dry rm -rf /tmp/claude-501
    dry rm -f /tmp/claude_doc.md /tmp/claude-ban-investigation.md /tmp/claude-socks-bridge.service.new
    dry rm -rf /tmp/hive-*-.claude /tmp/us-cpa-migrate-20260415
    dry find /tmp -maxdepth 1 -name "claude-*" -exec rm -rf {} + 2>/dev/null || true
    echo "  ✓ /tmp 已清理"
fi

# --- 10: 项目级 .claude/（明确路径，不用 find $HOME）---
if run_phase "10" "项目级 .claude/ 追踪数据" "删除已知项目中的 sessions/transcripts/file-history（明确路径列表）"; then
    # 只清理已知项目目录，不 find $HOME
    KNOWN_PROJECTS=(
        "$HOME/auto-skills"
        "$HOME/auto-skills/CtriXin-repo"
        "$HOME/game_center"
        "$HOME/game_robot"
        "$HOME/gamesnest-org"
        "$HOME/polymarket"
        "$HOME/rednote"
        "$HOME/keypool"
        "$HOME/knowledge-wiki"
        "$HOME/copy_calculator"
    "$HOME/Downloads"
    "$HOME/bs账号claude"
    )
    for base in "${KNOWN_PROJECTS[@]}"; do
        [ -d "$base" ] || continue
        dry find "$base" -maxdepth 3 -path "*/.claude/sessions" -type d -exec rm -rf {} + 2>/dev/null || true
        dry find "$base" -maxdepth 3 -path "*/.claude/transcripts" -type d -exec rm -rf {} + 2>/dev/null || true
        dry find "$base" -maxdepth 3 -path "*/.claude/file-history" -type d -exec rm -rf {} + 2>/dev/null || true
        dry find "$base" -maxdepth 3 -name "history.jsonl" -path "*/.claude/*" -delete 2>/dev/null || true
    done
    echo "  ✓ 已知项目中的追踪数据已清理"
fi

# --- 11: Desktop App 本体 + URL Handler ---
if run_phase "11" "Desktop App 本体" "删除 /Applications/Claude.app 和 URL Handler"; then
    dry rm -rf "/Applications/Claude.app" "$HOME/Applications/Claude Code URL Handler.app"
    echo "  ✓ Desktop App 已删除"
fi

# --- 12: shell history ---
if run_phase "12" "shell history" "清理 .zsh_history / .bash_history 中的 claude 记录（best-effort）"; then
    echo -e "  ${YELLOW}⚠️ 注意：此操作只修改 .zsh_history / .bash_history 文件，不会关闭当前窗口${NC}"
    echo -e "  ${YELLOW}   但建议先关闭其他 Terminal/zsh 窗口，避免 concurrent write${NC}"
    read -p "  确认已关闭? [回车=继续]: " _
    dry cp "$HOME/.zsh_history" "$HOME/.zsh_history.backup-$TIMESTAMP" 2>/dev/null || true
    dry cp "$HOME/.bash_history" "$HOME/.bash_history.backup-$TIMESTAMP" 2>/dev/null || true
    # LC_ALL=C 保证非 ASCII 字符不乱码（bash 无法 flush 其他 zsh session，best-effort）
    if [ "$DRY_RUN" != "1" ]; then
        if LC_ALL=C grep -iv "claude" "$HOME/.zsh_history" > "$HOME/.zsh_history.tmp" 2>/dev/null; then
            dry mv "$HOME/.zsh_history.tmp" "$HOME/.zsh_history"
        else
            dry rm -f "$HOME/.zsh_history.tmp"
        fi
        if LC_ALL=C grep -iv "claude" "$HOME/.bash_history" > "$HOME/.bash_history.tmp" 2>/dev/null; then
            dry mv "$HOME/.bash_history.tmp" "$HOME/.bash_history"
        else
            dry rm -f "$HOME/.bash_history.tmp"
        fi
    else
        echo -e "${BLUE}[DRY-RUN]${NC} grep 清理 .zsh_history / .bash_history（跳过，不创建 .tmp 文件）"
    fi
    echo "  ✓ history 已清理（best-effort，如有其他 zsh 存活可能写回）"
fi

# --- 13: .zshrc 中的 claude 函数 ---
if run_phase "13" ".zshrc 函数" "删除 claude_safe() / claudep() / ccp alias"; then
    dry cp "$HOME/.zshrc" "$HOME/.zshrc.backup-$TIMESTAMP"
    echo "  → .zshrc 已备份到 $HOME/.zshrc.backup-$TIMESTAMP"
    # P1: 按块删除（不能用 grep -v，会留下函数体残肢导致 syntax error）
    if [ "$DRY_RUN" != "1" ]; then
        awk '
            /^#* *claude_safe\(\)/ { skip_safe=1; next }
            skip_safe && /^#* *\}/ { skip_safe=0; next }
            skip_safe { next }
            /^claudep\(\)/ { skip_claudep=1; next }
            skip_claudep && /^\}/ { skip_claudep=0; next }
            skip_claudep { next }
            /^alias ccp=/ { next }
            { print }
        ' "$HOME/.zshrc" > "$HOME/.zshrc.tmp" && mv "$HOME/.zshrc.tmp" "$HOME/.zshrc"
    else
        echo -e "${BLUE}[DRY-RUN]${NC} awk 删除 .zshrc 中的 claude 函数"
    fi
    echo "  ✓ .zshrc 已清理"
fi

# --- 14: git config email ---
CURRENT_EMAIL=$(git config --global user.email 2>/dev/null | tr -cd '[:alnum:]@._-+' | head -c 100)
[ -z "$CURRENT_EMAIL" ] && CURRENT_EMAIL="未设置"
if run_phase "14" "git config email" "修改 git user.email（当前: $CURRENT_EMAIL）"; then
    echo "  推荐匿名地址: user-$(date +%Y%m%d)@example.com"
    read -p "输入新的 git user.email（直接回车=不改）: " NEW_EMAIL
    if [ -z "$NEW_EMAIL" ] || [ "$NEW_EMAIL" = "n" ] || [ "$NEW_EMAIL" = "N" ]; then
        echo "  ⊘ 跳过，保持当前 email: $CURRENT_EMAIL"
    else
        dry git config --global user.email "$NEW_EMAIL" && echo "  ✓ git email 已改为 $NEW_EMAIL"
    fi
fi

# ============================================================================
# 阶段 15: 重新安装 CLI
# ============================================================================
echo ""
echo "========================================"
echo "阶段 15: 重新安装 Claude Code CLI"
echo "========================================"
echo "  1) npm install -g @anthropic-ai/claude-code"
echo "  2) 跳过"
read -p "选择 [1/2]: " INSTALL
if [ "$INSTALL" = "1" ]; then
    dry npm install -g @anthropic-ai/claude-code || { echo -e "${RED}❌ npm install 失败${NC}"; exit 1; }
    echo "  ✓ npm 安装完成"
else
    echo "  ⊘ 跳过"
fi

# ============================================================================
# 阶段 16: 首次启动验证（强制）
# ============================================================================
echo ""
echo "========================================"
echo "阶段 16: 首次启动验证"
echo "========================================"

# 显示执行前保存的 userID（在阶段 2 删除 ~/.claude.json 之前已快照）
if [ -n "$OLD_USERID" ]; then
    echo "  执行前 userID: ${OLD_USERID:0:16}..."
else
    echo "  执行前 userID: 未记录（阶段2已清理或文件不存在）"
fi

echo ""
echo "请新开一个 Terminal 窗口，运行 'claude'，确认："
echo "  1. 必须弹出完整浏览器 OAuth 页面"
echo "  2. 如果直接进入聊天 = 清理失败"
echo "  3. ~/.claude.json 会生成新的 userID"
echo ""
echo "验证完成后回到此窗口回答："
read -p "已新开窗口运行 claude 并看到 OAuth 弹窗? [y/N]: " OAUTH_OK
[ "$OAUTH_OK" != "y" ] && [ "$OAUTH_OK" != "Y" ] && echo -e "${RED}⚠ 清理可能失败，请检查残留${NC}" && exit 1

# 自动对比 userID
echo ""
echo "  自动检查 ~/.claude.json userID 变化..."
if [ "$DRY_RUN" = "1" ]; then
    echo -e "  ${BLUE}[DRY-RUN]${NC} 跳过对比（DRY_RUN 未实际清理 ~/.claude.json）"
else
    if [ -f "$HOME/.claude.json" ]; then
        NEW_USERID=$(python3 -c "import json; d=json.load(open('$HOME/.claude.json')); print(d.get('userID',''))" 2>/dev/null || echo "")
        if [ -n "$NEW_USERID" ]; then
            if [ -n "$OLD_USERID" ] && [ "$NEW_USERID" = "$OLD_USERID" ]; then
                echo -e "  ${YELLOW}⚠️  userID 未变化 (${NEW_USERID:0:16}...) — 可能清理不完全${NC}"
                echo "    建议：检查 ~/.claude.json 残留、Keychain 未清、或浏览器 cookie 未清"
            else
                echo -e "  ${GREEN}✓ userID 已更新${NC}"
                [ -n "$OLD_USERID" ] && echo "    旧 ID: ${OLD_USERID:0:16}..."
                echo "    新 ID: ${NEW_USERID:0:16}..."
            fi
        else
            echo -e "  ${YELLOW}⚠️  ~/.claude.json 中未找到 userID${NC}"
        fi
    else
        echo -e "  ${YELLOW}⚠️  ~/.claude.json 不存在 — Claude 尚未生成身份文件${NC}"
    fi
fi

# ============================================================================
# 阶段 17: 恢复资产（白名单方式）
# ============================================================================
echo ""
echo "========================================"
echo "阶段 17: 恢复自定义资产"
echo "========================================"

# P0: 先确保 ~/.claude 目录存在（阶段 2 已删除）
dry mkdir -p "$HOME/.claude" "$HOME/.claude/plugins" "$HOME/.claude/skills" "$HOME/.claude/hooks" "$HOME/.claude/read-once"

# 17.1 CLAUDE.md — 优先从最新备份恢复，再 fallback
CLAUDE_SRC=""
for src in "$LATEST_BACKUP/CLAUDE.md" "$CODEX_BF/templates/CLAUDE.global.md" "$SAFE_ZONE/CLAUDE.md"; do
    [ -f "$src" ] && CLAUDE_SRC="$src" && break
done
if [ -n "$CLAUDE_SRC" ]; then
    dry cp "$CLAUDE_SRC" "$HOME/.claude/CLAUDE.md"
    echo "  ✓ CLAUDE.md (from $(basename $(dirname "$CLAUDE_SRC")))"
fi

# 17.2 Plugins
PLUGIN_SRC=""
for src in "$LATEST_BACKUP/plugins" "$SAFE_ZONE/plugins"; do
    [ -d "$src" ] && PLUGIN_SRC="$src" && break
done
if [ -n "$PLUGIN_SRC" ]; then
    dry mkdir -p "$HOME/.claude/plugins"
    if [ "$(ls -A "$PLUGIN_SRC" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
        dry cp -r "$PLUGIN_SRC/"* "$HOME/.claude/plugins/" 2>/dev/null || true
        echo "  ✓ Plugins"
    else
        echo -e "  ${YELLOW}⚠️ Plugins 源目录为空，跳过${NC}"
    fi
fi

# 17.3 Skills
dry mkdir -p "$HOME/.claude/skills"
for src in "$LATEST_BACKUP/skills-entity" "$SAFE_ZONE/skills" "$SAFE_ZONE/skills-bak-entities"; do
    if [ -d "$src" ] && [ "$(ls -A "$src" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
        dry cp -r "$src/"* "$HOME/.claude/skills/" 2>/dev/null || true
    fi
done
if [ "$CODEX_EXISTS" = true ] && [ -d "$CODEX_BF/entity-skills-from-claude-bak" ]; then
    if [ "$(ls -A "$CODEX_BF/entity-skills-from-claude-bak" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
        dry cp -r "$CODEX_BF/entity-skills-from-claude-bak/"* "$HOME/.claude/skills/" 2>/dev/null || true
    fi
fi
# symlink 重建 — 优先从最新备份读取 map（必须至少有一行非注释内容）
symlink_map_valid() { [ -f "$1" ] && grep -v '^[[:space:]]*#' "$1" 2>/dev/null | grep -q '[^[:space:]]'; }
SYMLINK_MAP=""
symlink_map_valid "$LATEST_BACKUP/skills.symlink-map.txt" && SYMLINK_MAP="$LATEST_BACKUP/skills.symlink-map.txt"
[ -z "$SYMLINK_MAP" ] && symlink_map_valid "$CODEX_BF/templates/skills.symlink-map.txt" && SYMLINK_MAP="$CODEX_BF/templates/skills.symlink-map.txt"
[ -z "$SYMLINK_MAP" ] && symlink_map_valid "$SAFE_ZONE/symlink-map-all.txt" && SYMLINK_MAP="$SAFE_ZONE/symlink-map-all.txt"
if [ -n "$SYMLINK_MAP" ]; then
    cd "$HOME/.claude/skills"
    while IFS= read -r line; do
        [[ "$line" =~ ^#.*$ ]] && continue
        [[ -z "$line" ]] && continue
        skill_name=$(echo "$line" | awk '{print $1}' | sed 's|/$||')
        target=$(echo "$line" | awk '{print $3}')
        [ -z "$skill_name" ] || [ -z "$target" ] && continue
        target="${target/#\~/$HOME}"
        [ ! -e "$skill_name" ] && dry ln -s "$target" "$skill_name" 2>/dev/null && echo "    ✓ symlink $skill_name"
    done < "$SYMLINK_MAP"
fi

# 17.4 Hooks
dry mkdir -p "$HOME/.claude/hooks" "$HOME/.claude/read-once"
if [ "$CODEX_EXISTS" = true ] && [ -d "$CODEX_BF/repo-hooks" ]; then
    for repo_dir in "$CODEX_BF/repo-hooks/"*; do
        [ -d "$repo_dir" ] || continue
        for f in "$repo_dir/"*.sh; do
            [ -f "$f" ] || continue
            basename=$(basename "$f")
            # read-once-*.sh → ~/.claude/read-once/*.sh（去掉 read-once- 前缀）
            if [[ "$basename" == read-once-* ]]; then
                target_name="${basename#read-once-}"
                dry cp "$f" "$HOME/.claude/read-once/$target_name"
            # claude-*.sh → ~/.claude/hooks/*.sh（去掉 claude- 前缀）
            elif [[ "$basename" == claude-* ]]; then
                target_name="${basename#claude-}"
                dry cp "$f" "$HOME/.claude/hooks/$target_name"
            else
                dry cp "$f" "$HOME/.claude/hooks/"
            fi
        done
    done
    echo "  ✓ Hooks (from Codex repo-hooks)"
else
    for f in "$SAFE_ZONE/hooks/"*.sh; do
        [ -f "$f" ] && dry cp "$f" "$HOME/.claude/hooks/"
    done
    for f in \
        "$HOME/auto-skills/CtriXin-repo/multi-model-switch/hooks/read-once-compact.sh" \
        "$HOME/auto-skills/CtriXin-repo/multi-model-switch/hooks/read-once-hook.sh"
    do
        [ -f "$f" ] && dry cp "$f" "$HOME/.claude/read-once/"
    done
    echo "  ✓ Hooks (from safe_zone + repo)"
fi

# 17.5 Settings.json（优先最新备份的脱敏版，再 fallback Codex 模板）
SETTINGS_JSON_SRC=""
for src in "$LATEST_BACKUP/settings-current-session-sanitized.json" "$CODEX_BF/templates/settings.whitelist.template.json"; do
    [ -f "$src" ] && SETTINGS_JSON_SRC="$src" && break
done
if [ -n "$SETTINGS_JSON_SRC" ]; then
    dry cp "$SETTINGS_JSON_SRC" "$HOME/.claude/settings.json"
    echo "  ✓ settings.json (from $(basename "$SETTINGS_JSON_SRC"))"
else
    # fallback 最小配置
    if [ "$DRY_RUN" != "1" ]; then
        cat > "$HOME/.claude/settings.json" << 'JSONEOF'
{
  "permissions": {
    "allow": ["Read", "Edit", "Write", "Bash(yarn *)", "Bash(npm *)", "Bash(node *)", "Bash(git *)", "Bash(ls *)", "Bash(cat *)", "Bash(find *)", "Bash(grep *)", "Bash(which *)", "Bash(chmod *)", "Bash(cd *)", "Bash(python3 *)", "Bash(rsync *)", "Skill(*)", "Agent(*)"],
    "deny": ["Bash(rm -rf /)*", "Bash(git push --force *)"],
    "defaultMode": "bypassPermissions"
  },
  "statusLine": {
    "type": "command",
    "command": "/bin/bash /Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh"
  },
  "hooks": {},
  "promptSuggestionEnabled": false,
  "skipDangerousModePermissionPrompt": true
}
JSONEOF
    else
        echo -e "${BLUE}[DRY-RUN]${NC} cat > ~/.claude/settings.json (fallback 最小配置)"
    fi
    echo "  ✓ settings.json (fallback 最小配置)"
fi

# 17.6 MCP
if [ "$CODEX_EXISTS" = true ] && [ -f "$CODEX_BF/templates/mcpServers-only.json" ]; then
    if [ "$DRY_RUN" != "1" ]; then
        python3 << MCPPY
import json, os
with open("$CODEX_BF/templates/mcpServers-only.json") as f:
    mcp = json.load(f)
with open(os.path.expanduser("~/.claude/settings.json")) as f:
    cfg = json.load(f)
cfg["mcpServers"] = mcp.get("mcpServers", {})
with open(os.path.expanduser("~/.claude/settings.json"), "w") as f:
    json.dump(cfg, f, indent=2)
print("  ✓ MCP (hive + mindkeeper)")
MCPPY
    else
        echo -e "${BLUE}[DRY-RUN]${NC} python3 注入 MCP servers 到 settings.json"
    fi
fi

# 17.7 settings.local.json
SETTINGS_LOCAL_SRC=""
for src in "$LATEST_BACKUP/settings.local.json" "$SAFE_ZONE/settings.local.json"; do
    [ -f "$src" ] && SETTINGS_LOCAL_SRC="$src" && break
done
if [ -n "$SETTINGS_LOCAL_SRC" ]; then
    dry cp "$SETTINGS_LOCAL_SRC" "$HOME/.claude/settings.local.json"
    echo "  ✓ settings.local.json"
fi

# P1: 恢复 .cc-switch/skills/（如果备份了）
# 注意：阶段 2 现在只删 .cc-switch 的敏感数据，不删整个目录，所以 skills 通常还在
# 这里只处理用户之前手动删过或想从备份恢复的情况
CC_SWITCH_SRC=""
for src in "$LATEST_BACKUP/cc-switch-skills" "$CODEX_BF/cc-switch-skills"; do
    [ -d "$src" ] && CC_SWITCH_SRC="$src" && break
done
if [ -n "$CC_SWITCH_SRC" ]; then
    # 如果 live 目录已存在且有内容，提示不覆盖
    if [ -d "$HOME/.cc-switch/skills" ] && [ "$(ls -A "$HOME/.cc-switch/skills" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
        echo -e "  ${YELLOW}⚠️ ~/.cc-switch/skills/ 已存在且非空，跳过覆盖${NC}"
    else
        dry mkdir -p "$HOME/.cc-switch/skills"
        [ "$(ls -A "$CC_SWITCH_SRC" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ] && dry cp -r "$CC_SWITCH_SRC/"* "$HOME/.cc-switch/skills/" 2>/dev/null || true
        echo "  ✓ .cc-switch/skills 已恢复"
    fi
fi

# P1: 恢复 .agents/skills/
AGENTS_SRC=""
for src in "$LATEST_BACKUP/agents-skills" "$CODEX_BF/agents-skills"; do
    [ -d "$src" ] && AGENTS_SRC="$src" && break
done
if [ -n "$AGENTS_SRC" ]; then
    if [ -d "$HOME/.agents/skills" ] && [ "$(ls -A "$HOME/.agents/skills" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ]; then
        echo -e "  ${YELLOW}⚠️ ~/.agents/skills/ 已存在且非空，跳过覆盖${NC}"
    else
        dry mkdir -p "$HOME/.agents/skills"
        [ "$(ls -A "$AGENTS_SRC" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ] && dry cp -r "$AGENTS_SRC/"* "$HOME/.agents/skills/" 2>/dev/null || true
        echo "  ✓ .agents/skills 已恢复"
    fi
fi

# P2: 恢复 RTK.md
RTK_SRC=""
for src in "$LATEST_BACKUP/RTK.md" "$SAFE_ZONE/RTK.md"; do
    [ -f "$src" ] && RTK_SRC="$src" && break
done
if [ -n "$RTK_SRC" ]; then
    dry cp "$RTK_SRC" "$HOME/.claude/RTK.md"
    echo "  ✓ RTK.md 已恢复"
fi

# ============================================================================
# 阶段 18: 最终验证
# ============================================================================
echo ""
echo "========================================"
echo "阶段 18: 最终验证"
echo "========================================"

PASS=0; FAIL=0
chk() { if eval "$1"; then echo -e "  ${GREEN}[✓]${NC} $2"; PASS=$((PASS+1)); else echo -e "  ${RED}[✗]${NC} $2"; FAIL=$((FAIL+1)); fi; }

chk "[ -f \"$HOME/.claude.json\" ]" "~/.claude.json 已生成"
chk "! security dump-keychain 2>/dev/null | grep -qi claude" "Keychain 无 Claude 残留"
chk "[ -d \"$HOME/.claude/hooks\" ] && ls \"$HOME/.claude/hooks/\"*.sh >/dev/null 2>&1" "Hooks 已恢复"
chk "[ -d \"$HOME/.claude/skills\" ] && [ \"\$(ls \"$HOME/.claude/skills/\" 2>/dev/null | wc -l | tr -d ' ')\" -gt 0 ]" "Skills 已恢复"
chk "grep -q statusLine \"$HOME/.claude/settings.json\" 2>/dev/null" "settings.json 含 statusLine"
chk "[ -f \"$HOME/.claude/CLAUDE.md\" ]" "CLAUDE.md 存在"
chk "! grep -q mms-bridge \"$HOME/.claude/settings.json\" 2>/dev/null" "settings.json 无旧 token"
chk "[ -d \"$HOME/.claude/plugins\" ] && [ \"\$(ls \"$HOME/.claude/plugins/\" 2>/dev/null | wc -l | tr -d ' ')\" -gt 0 ]" "Plugins 已恢复"
chk "[ -f \"$HOME/.claude/settings.local.json\" ]" "settings.local.json 存在"
chk "[ -d \"$HOME/.cc-switch/skills\" ]" ".cc-switch/skills 存在"
chk "[ -d \"$HOME/.agents/skills\" ] || [ ! -d \"$HOME/.agents\" ]" ".agents/skills 已处理"
# 遥测设置由用户自行决定，不强制检查
# chk "! grep -q DISABLE_NONESSENTIAL_TRAFFIC \"$HOME/.claude/settings.json\" 2>/dev/null" "未设置 DISABLE_NONESSENTIAL_TRAFFIC"
chk "[ ! -d \"$HOME/Library/Caches/com.anthropic.claudefordesktop\" ]" "Desktop 缓存已清除"

echo ""
echo "========================================"
echo -e "${GREEN}验证: $PASS 通过 / $FAIL 失败${NC}"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ 有 $FAIL 项验证未通过，脚本以非零状态退出${NC}"
    echo -e "${RED}   说明清理或恢复不完整，请检查上方 [✗] 项${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi

echo ""
echo "隔离完成。Claude 现在应该不认识这台电脑。"
echo ""
