#!/bin/bash
# MindKeeper + MMS Token Monitor Hook
# 在 UserPromptSubmit 时检查 token 使用状态，超过阈值自动建议压缩
#
# 安装方式：
# 1. 将此脚本放入 ~/.claude/hooks/ 或 MMS session 的 hooks/
# 2. 在 settings.json 中添加 UserPromptSubmit hook
#
# 功能：
# - 每次用户发送 prompt 时计数 +1
# - 超过 50 轮时警告
# - 超过 100 轮时自动建议 /distill 或调用 brain_token_reset

set -euo pipefail

resolve_real_home() {
  if [[ "$HOME" == *"/.config/mms/claude-gateway/"* ]]; then
    # MMS 环境，提取真实 HOME
    echo "${HOME%%/.config/mms/claude-gateway/*}"
  else
    echo "$HOME"
  fi
}

REAL_HOME="$(resolve_real_home)"
SCE_DIR="$REAL_HOME/.sce"
TOKEN_STATE="$SCE_DIR/token-state.json"

# 配置
TURN_WARNING=50
TURN_COMPRESS=100

# 如果 jq 不存在，静默退出
command -v jq &>/dev/null || exit 0

# 读取当前轮次
get_turn_count() {
  if [ ! -f "$TOKEN_STATE" ]; then
    echo "0"
    return
  fi
  jq -r '.turnCount // 0' "$TOKEN_STATE" 2>/dev/null || echo "0"
}

# 更新轮次 +1
increment_turn() {
  local current
  current=$(get_turn_count)
  local new=$((current + 1))

  mkdir -p "$SCE_DIR"

  if [ ! -f "$TOKEN_STATE" ]; then
    # 新建状态文件
    cat > "$TOKEN_STATE" <<EOF
{
  "sessionId": "sess-$(date +%s)-$$",
  "turnCount": $new,
  "estimatedTokens": 0,
  "lastReset": "$(date -Iseconds)",
  "compressedCount": 0,
  "history": []
}
EOF
  else
    # 更新轮次
    local tmp
    tmp=$(mktemp)
    jq --argjson n "$new" '.turnCount = $n' "$TOKEN_STATE" > "$tmp" && mv "$tmp" "$TOKEN_STATE"
  fi

  echo "$new"
}

# 主逻辑
TURN_COUNT=$(increment_turn)

# 检查是否需要警告或压缩
if [ "$TURN_COUNT" -ge "$TURN_COMPRESS" ]; then
  # 超过压缩阈值，输出警告到 stderr（Claude Code 会显示）
  cat >&2 <<EOF

⚡ **Token 监控警告**
对话轮次：$TURN_COUNT/$TURN_COMPRESS
建议：运行 \`/distill\` 或 \`brain_token_reset\` 开始新 session

EOF
elif [ "$TURN_COUNT" -ge "$TURN_WARNING" ]; then
  # 超过警告阈值
  cat >&2 <<EOF

⚡ **Token 监控提示**
对话轮次：$TURN_COUNT/$TURN_WARNING
建议：考虑运行 \`brain_token_status\` 查看状态

EOF
fi

exit 0
