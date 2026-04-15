# MindKeeper Token 监控与滑动窗口压缩

## 功能概述

MindKeeper 新增了轻量级 token 监控和滑动窗口压缩功能，用于：

1. **监控对话轮次** - 跟踪当前 session 的对话轮数
2. **自动警告** - 超过 50 轮时提示，超过 100 轮时自动建议压缩
3. **滑动窗口压缩** - 保留最近 N 轮对话，丢弃最早的
4. **异步 distill** - 后台调用国产模型做知识沉淀

## 新增 MCP Tools

| Tool | 功能 |
|------|------|
| `brain_token_status` | 查看当前 token 使用状态和对话轮次 |
| `brain_token_reset` | 重置 token 计数器（开始新 session） |

## 使用方法

### 1. 查看当前状态

```
/brain_token_status
```

输出示例：
```
**Token 监控状态**
Session: `sess-1712484000-abc1`
对话轮次：45/100 [████░░░░░░] 45%
估算 Token: ~12,500
已压缩次数：0
滑动窗口：30/60
```

### 2. 开始新 Session

```
/brain_token_reset
```

### 3. 配置阈值

编辑 `~/.sce/token-monitor-config.json`：

```json
{
  "turnWarning": 50,
  "turnCompress": 100,
  "windowSize": 30,
  "enableAsyncDistill": true,
  "distillModel": "kimi-k2.5"
}
```

## Hook 自动监控

安装 hook 后，每次发送 prompt 时自动计数：

```bash
# 安装 hook（全局）
cp /path/to/mindkeeper/hooks/token-monitor-hook.sh ~/.claude/hooks/

# 在 settings.json 中添加
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
    ]
  }
}
```

## 与 RTK 配合使用

| 工具 | 压缩对象 | 触发时机 |
|------|---------|---------|
| **RTK** | CLI 命令输出 | 每次执行命令 |
| **Token Monitor** | 对话轮次计数 | 每次用户发送 prompt |
| **Distill** | Session 知识沉淀 | 手动或 session 结束 |

## Codex 支持

在 Codex 的 `AGENTS.md` 中添加：

```markdown
## Token 监控

当对话超过 50 轮时，运行 `brain_token_status` 检查状态。
超过 100 轮时，建议运行 `brain_token_reset` 开始新 session。
```

## 滑动窗口压缩（开发中）

当超过阈值时，自动调用国产模型（kimi/glm/mimo）压缩早期对话：

```typescript
// 伪代码
if (turnCount > threshold) {
  const summary = await callModel({
    model: config.distillModel,
    prompt: `总结以下对话：${earlyHistory}`
  });
  // 替换早期对话为摘要
}
```

## 文件结构

```
mindkeeper/
├── src/
│   ├── token-monitor.ts    # Token 监控核心逻辑
│   ├── server.ts           # MCP server（新增 tool 注册）
│   └── handlers.ts         # Tool handlers
├── hooks/
│   └── token-monitor-hook.sh  # Claude Code hook
└── docs/
    └── TOKEN_MONITOR.md    # 本文档
```

## 成本估算

使用国产模型做异步 distill 的成本（按 100 轮对话压缩到 10 轮）：

| 模型 | 输入 tokens | 输出 tokens | 成本（约） |
|------|-----------|-----------|----------|
| kimi-k2.5 | ~10k | ~1k | ¥0.01 |
| glm-5-turbo | ~10k | ~1k | ¥0.005 |
| qwen3.5-plus | ~10k | ~1k | ¥0.008 |

相比 Context Gateway（需要独立服务），MMS 路由方案更轻量且零额外依赖。
