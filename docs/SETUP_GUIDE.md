# RTK + BrainKeeper Token Monitor 完整配置指南

## 快速开始（3 分钟）

### 步骤 1: 安装 RTK（Token 压缩）

```bash
# 安装 RTK
brew install rtk

# 安装全局 hook
rtk init -g --auto-patch
```

**效果**：`cat file.txt` 自动重写成 `rtk read file.txt`，节省 60-90% CLI token。

---

### 步骤 2: 安装 BrainKeeper Token Monitor（对话轮次监控）

```bash
# 构建 BrainKeeper
cd ~/auto-skills/CtriXin-repo/brainkeeper
npm run build

# 复制 hook 到全局
cp hooks/token-monitor-hook.sh ~/.claude/hooks/
```

**效果**：每次发送 prompt 自动计数，超过 50 轮警告，超过 100 轮建议压缩。

---

### 步骤 3: 配置 settings.json

在 `~/.claude/settings.json` 中添加：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hooks/token-monitor-hook.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/xin/.claude/hooks/rtk-rewrite.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 使用方式

### 日常流程

```
1. 开始工作
   → 自动计数开始

2. 对话进行中
   → 每次 prompt 自动 +1
   → 50 轮时收到警告

3. 收到警告后
   → 运行 brain_token_status 查看状态
   → 或继续工作

4. 超过 100 轮
   → 运行 brain_checkpoint 蒸馏状态
   → 运行 brain_token_reset 开始新 session
```

### 命令速查

| 命令 | 功能 |
|------|------|
| `brain_token_status` | 查看当前状态 |
| `brain_token_reset` | 重置计数器 |
| `brain_checkpoint` | 蒸馏工作状态 |
| `rtk gain` | 查看 RTK 节省统计 |
| `rtk session` | 查看 RTK 采用率 |

---

## Codex 支持

在 Codex 项目的 `AGENTS.md` 中添加：

```markdown
## Token 监控

可用命令：
- `brain_token_status` - 查看状态
- `brain_token_reset` - 重置计数器
- `brain_checkpoint` - 蒸馏状态

超过 50 轮时警告，超过 100 轮时建议压缩。
```

---

## 配置自定义

### 调整阈值

编辑 `~/.sce/token-monitor-config.json`：

```json
{
  "turnWarning": 50,
  "turnCompress": 100,
  "windowSize": 30
}
```

### 调整 RTK 规则

编辑 `~/.config/mms/claude-gateway/s/30412/Library/Application Support/rtk/filters.toml`

---

## 预期效果

| 工具 | 节省幅度 |
|------|---------|
| RTK | CLI 输出减少 60-90% |
| Token Monitor | 防止 session 无限增长 |
| Distill | 跨 session 知识保留 |

**综合效果**：长 session 成本降低 50%+，且保持上下文连续性。

---

## 故障排查

### Hook 不工作

```bash
# 检查 RTK hook
ls -la ~/.claude/hooks/rtk-rewrite.sh

# 检查 Token Monitor hook
ls -la ~/.claude/hooks/token-monitor-hook.sh

# 测试 RTK
rtk rewrite "git status"  # 应输出 rtk git status

# 测试 Token Monitor
bash ~/.claude/hooks/token-monitor-hook.sh  # 应无输出（首次）
```

### BrainKeeper MCP 不响应

```bash
# 重启 Claude Code
# 检查 MCP 配置
cat ~/.claude/.mcp.json
```

---

## 成本对比

| 方案 | 成本 | 延迟 | 依赖 |
|------|------|------|------|
| RTK | 免费 | 无 | 无 |
| Token Monitor | 免费 | 无 | 无 |
| Context Gateway | $10/月 | 低 | 外部服务 |
| MMS + 国产模型 | ¥0.01/次 | 中 | MMS |

**推荐**：RTK + Token Monitor 作为基础，必要时用 MMS + 国产模型做异步 distill。
