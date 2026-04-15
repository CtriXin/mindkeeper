# Codex + MindKeeper Token 监控

## 安装

在 Codex 项目根目录运行：

```bash
# 1. 确保 MindKeeper MCP 已安装
# 如果没装，运行：
curl -fsSL https://raw.githubusercontent.com/CtriXin/mindkeeper/main/install.sh | bash

# 2. 配置 AGENTS.md
```

## AGENTS.md 配置

在 `AGENTS.md` 中添加：

```markdown
## Token 监控

当对话超过 50 轮时，运行 `brain_token_status` 检查状态。
超过 100 轮时，建议运行 `brain_token_reset` 开始新 session。

可用命令：
- `brain_token_status` - 查看当前 token 使用状态
- `brain_token_reset` - 重置计数器
- `brain_checkpoint` - 蒸馏当前工作状态
```

## 使用流程

```
1. 开始工作
   → Codex 自动调用 brain_bootstrap 恢复上下文

2. 对话进行中
   → 每次 prompt 自动计数（hook）
   → 超过 50 轮时收到警告

3. 超过 100 轮
   → 运行 brain_checkpoint 蒸馏状态
   → 运行 brain_token_reset 开始新 session

4. 新 session
   → brain_bootstrap 自动加载上次 thread
   → 无缝继续
```

## 与 RTK 配合

| 工具 | 作用 |
|------|------|
| RTK | 压缩 CLI 命令输出 |
| Token Monitor | 监控对话轮次 |
| Distill | 沉淀 session 知识 |

三者互补，互不冲突。
