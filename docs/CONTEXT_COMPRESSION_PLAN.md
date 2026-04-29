# Context 压缩系统 — 完整落地 Plan

> 版本：v1.0  
> 日期：2026-04-07  
> 状态：待实施

---

## 背景

- 用户每天遇到 Claude Code context 达到上限（1M token）
- 不想用 Context Gateway（担心隐私，怕数据外泄）
- 已有 MMS 本地运行在 127.0.0.1:63055
- 已有 BrainKeeper 做 distill 和 thread 存储

---

## 架构决策

### 核心原则（来自 4 模型讨论共识）

1. **MMS Bridge 保持无状态** — 只做路由和转发，不存压缩状态
2. **BrainKeeper 管理 Context** — 负责压缩决策和 summary 存储
3. **不修改原始对话** — 生成 immutable summary ID 供引用
4. **用户确认折叠** — 70% 阈值时提示，用户确认后压缩

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code                                                │
│  ANTHROPIC_BASE_URL = http://127.0.0.1:63055                │
│                                                             │
│  用户命令：/ctx-save, /ctx-status, /ctx-fold                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────────────┐
│  MMS Bridge (无状态)                                         │
│  - 模型路由                                                  │
│  - 请求转发                                                  │
│  - Token 计数 → BrainKeeper (后台异步)                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────────────┐
│  BrainKeeper Context Manager                                  │
│  - brain_context_status — 返回 token 使用率                   │
│  - brain_context_save — 后台预计算 summary                   │
│  - brain_context_fold — 用户确认后折叠                       │
│  - Shadow distill 持续运行                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: 手动存档命令（30 分钟）

**目标**：一键蒸馏当前状态 + 重置计数器，用户手动触发

**命令命名**（避免与官方 `/compact` 冲突）：
| 命令 | 功能 |
|------|------|
| `/ctx-save` | 蒸馏当前状态 + 重置计数器 |
| `/ctx-status` | 查看当前 token 使用率 |
| `/ctx-fold` | 折叠早期对话（Phase 4） |

### 1.1 创建 Skill 文件

**文件**：`~/.claude/skills/ctx-save`

```bash
#!/bin/bash
# /ctx-save — 蒸馏当前状态并重置 token 计数器
# 用法：/ctx-save

set -euo pipefail

# 调用 brain_checkpoint 蒸馏状态
echo " 正在蒸馏当前工作状态..."

# 通过 MCP 调用 brain_checkpoint
# 需要传入：repo, task, status 等参数
# 这里用简化版本，让 AI 自动填充

cat <<EOF
请运行以下 MCP 命令：

1. brain_checkpoint
   - repo: $(pwd)
   - task: 当前任务
   - status: 准备压缩 context

2. brain_token_reset
   - 重置计数器

完成后提示用户：
"✅ 已蒸馏到 thread: dst-xxxxx
💡 建议：运行 /clear 开始新对话，新 session 会自动恢复上下文"
EOF
```

### 1.2 创建 Skill 文件（增强版）

**文件**：`~/.claude/skills/ctx-status`

```bash
#!/bin/bash
# /ctx-status — 查看当前 token 使用状态

echo "📊 Token 使用状态"
echo "运行 brain_token_status 获取详细信息..."
```

### 1.3 修改 settings.json 添加技能

**文件**：`~/.claude/settings.json`

```json
{
  "skills": {
    "ctx-save": "~/.claude/skills/ctx-save",
    "ctx-status": "~/.claude/skills/ctx-status"
  }
}
```

### 1.4 验收标准

- [ ] `/ctx-save` 可用
- [ ] `/ctx-status` 显示状态
- [ ] 蒸馏后新 session 自动恢复

---

## Phase 2: BrainKeeper Context Manager（1-2 天）

**目标**：新增 3 个 MCP tool，支持后台预计算和用户确认

### 2.1 新增文件

**文件**：`brainkeeper/src/context-manager.ts`

```typescript
/**
 * context-manager.ts — Context 压缩管理
 *
 * 功能：
 * 1. 接收 token 计数，判断是否超过阈值
 * 2. 后台调用便宜模型做 summary
 * 3. 存储 summary 到 thread
 * 4. 返回 summary ID 供引用
 */

import { estimateTokens } from './token-monitor.js';
import { checkpoint } from './distill.js';

// 配置
const THRESHOLD_WARNING = 0.70;  // 70% 触发警告
const THRESHOLD_COMPACT = 0.85;  // 85% 强制建议
const COMPRESS_ROUNDS = 10;      // 每次压缩 10 轮

export interface ContextStatus {
  tokenCount: number;
  tokenLimit: number;
  usagePercent: number;
  shouldWarn: boolean;
  shouldCompact: boolean;
  summaryId?: string;
}

export function checkContext(tokenCount: number, sessionId: string): ContextStatus {
  const tokenLimit = 1000000;  // 1M
  const usagePercent = tokenCount / tokenLimit;

  return {
    tokenCount,
    tokenLimit,
    usagePercent,
    shouldWarn: usagePercent >= THRESHOLD_WARNING,
    shouldCompact: usagePercent >= THRESHOLD_COMPACT,
  };
}

export async function computeSummary(
  messages: Array<{ role: string; content: string }>,
  sessionId: string
): Promise<{ summaryId: string; compressedTokens: number }> {
  // 提取前 N 轮对话
  const toCompress = messages.slice(0, COMPRESS_ROUNDS * 2);  // user+assistant 成对

  // 调用便宜模型总结
  const summary = await callCheapModel({
    model: 'kimi-k2.5',
    messages: [{
      role: 'user',
      content: `总结以下对话，保留关键决策、文件引用、约束条件：\n${formatMessages(toCompress)}`
    }]
  });

  // 写入 BrainKeeper thread
  const result = checkpoint({
    repo: process.cwd(),
    task: `Context 压缩 — ${sessionId}`,
    status: `已压缩 ${COMPRESS_ROUNDS} 轮对话`,
    findings: [summary],
    decisions: [],
    changes: [],
    next: [],
  });

  return {
    summaryId: result.threadId,
    compressedTokens: estimateTokens(formatMessages(toCompress)),
  };
}

async function callCheapModel(params: any): Promise<string> {
  // 调用 MMS 路由的便宜模型
  const response = await fetch('http://127.0.0.1:63055/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = await response.json();
  return data.choices[0].message.content;
}

function formatMessages(messages: Array<{ role: string; content: string }>): string {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n---\n');
}
```

### 2.2 新增 MCP Tools

**文件**：`brainkeeper/src/server.ts`

新增 tool 定义：

```typescript
const CONTEXT_TOOLS = [
  {
    name: 'brain_context_status',
    description: '查看当前 context 使用率和压缩建议',
    inputSchema: {
      type: 'object',
      properties: {
        tokenCount: { type: 'number', description: '当前 token 数' },
      },
    },
  },
  {
    name: 'brain_context_save',
    description: '后台预计算 context summary，返回 summary ID',
    inputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'string', description: 'JSON array of messages' },
        sessionId: { type: 'string', description: 'Session ID' },
      },
    },
  },
  {
    name: 'brain_context_fold',
    description: '用户确认后折叠早期对话，替换为 summary',
    inputSchema: {
      type: 'object',
      properties: {
        summaryId: { type: 'string', description: 'Summary ID from brain_context_save' },
        rounds: { type: 'number', description: '折叠多少轮对话' },
      },
    },
  },
];
```

### 2.3 新增 Handler

**文件**：`brainkeeper/src/handlers.ts`

```typescript
export function handleContextStatus(args: Record<string, unknown>): ToolResponse {
  const tokenCount = Number(args.tokenCount) || 0;
  const status = checkContext(tokenCount, 'session');

  const icons = {
    safe: '🟢',
    warn: '🟡',
    compact: '🔴',
  };

  const icon = status.shouldCompact ? icons.compact : status.shouldWarn ? icons.warn : icons.safe;

  return ok(
    `${icon} Context 使用率：${(status.usagePercent * 100).toFixed(1)}%\n` +
    `Token: ${status.tokenCount.toLocaleString()} / ${status.tokenLimit.toLocaleString()}\n` +
    `${status.shouldWarn ? '💡 建议运行 /ctx-save 压缩' : ''}` +
    `${status.shouldCompact ? '⚠️ 立即压缩，否则可能达到上限' : ''}`
  );
}

export async function handleContextSave(args: Record<string, unknown>): Promise<ToolResponse> {
  const messages = JSON.parse(String(args.messages));
  const sessionId = String(args.sessionId);

  const result = await computeSummary(messages, sessionId);

  return ok(
    `✅ 已预计算 summary: ${result.summaryId}\n` +
    `压缩 ${COMPRESS_ROUNDS} 轮对话，节省 ~${result.compressedTokens.toLocaleString()} tokens\n` +
    `运行 /ctx-fold 确认折叠`
  );
}

export function handleContextFold(args: Record<string, unknown>): ToolResponse {
  const summaryId = String(args.summaryId);
  const rounds = Number(args.rounds) || COMPRESS_ROUNDS;

  // 返回折叠指令，让 AI 知道如何修改 messages
  return ok(
    `✅ 已折叠 ${rounds} 轮对话\n` +
    `Summary ID: ${summaryId}\n` +
    `新 session 启动时运行 brain_bootstrap 恢复上下文`
  );
}
```

### 2.4 验收标准

- [ ] `brain_context_status` 返回使用率
- [ ] `brain_context_save` 后台计算 summary
- [ ] `brain_context_fold` 返回折叠指令

---

## Phase 3: MMS Bridge 信号注入（1 天）

**目标**：MMS 转发请求时，附加 summary ID

### 3.1 修改 Handler

**文件**：`mms-bridge/src/handler.ts`

```typescript
async function handleRequest(req: Request) {
  const messages = req.body.messages;
  const tokenCount = estimateTokens(messages);
  const sessionId = req.sessionId;

  // 发送 token 计数到 BrainKeeper
  const summaryId = await fetchBrainKeeperStatus(tokenCount, sessionId);

  // 如果有 summary，附加到请求
  if (summaryId) {
    messages.push({
      role: 'system',
      content: `[context:summary=${summaryId}]`
    });
  }

  return forwardToAPI(messages);
}

async function fetchBrainKeeperStatus(tokenCount: number, sessionId: string): Promise<string | null> {
  try {
    const response = await fetch('http://127.0.0.1:63056/context/check', {
      method: 'POST',
      body: JSON.stringify({ tokenCount, sessionId }),
    });
    const data = await response.json();
    return data.summaryId || null;
  } catch {
    return null;  // 失败不影响转发
  }
}
```

### 3.2 验收标准

- [ ] Token 计数发送到 BrainKeeper
- [ ] Summary ID 附加到请求
- [ ] 失败不影响正常转发

---

## Phase 4: 用户确认 UI（1 天）

**目标**：Hook 输出警告和确认提示

### 4.1 修改 Hook

**文件**：`~/.claude/hooks/token-monitor-hook.sh`

```bash
#!/bin/bash
# Token Monitor Hook — 增强版

# ... 现有逻辑 ...

if [ "$TURN_COUNT" -ge "$TURN_COMPRESS" ]; then
  cat >&2 <<EOF

⚡ **Context 压缩警告**
对话轮次：$TURN_COUNT/$TURN_COMPRESS
Token 使用率：${TOKEN_PERCENT}%

已预计算摘要：${SUMMARY_ID}
运行 /ctx-fold 确认折叠，或继续工作

EOF
fi
```

### 4.2 验收标准

- [ ] 70% 时显示警告
- [ ] 85% 时显示强制建议
- [ ] 提示 /ctx-fold 命令

---

## 时间线

| 阶段 | 时间 | 依赖 |
|------|------|------|
| **Phase 1** | 今天 (30 分钟) | 无 |
| **Phase 2** | 明天 (1-2 天) | Phase 1 |
| **Phase 3** | 后天 (1 天) | Phase 2 |
| **Phase 4** | 大后天 (1 天) | Phase 3 |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Summary 质量差 | 高 | 中 | 可配置压缩轮数，保守起步 |
| 后台调用阻塞 | 中 | 高 | 用 detached: true 确保异步 |
| MMS 崩溃 | 低 | 高 | 压缩逻辑独立进程 |
| 用户不确认 | 中 | 低 | 85% 时强制提示 |

---

## 下一步

**立即开始 Phase 1**：

```bash
# 1. 创建 skill 文件
mkdir -p ~/.claude/skills
edit ~/.claude/skills/ctx-save

# 2. 修改 settings.json
edit ~/.claude/settings.json

# 3. 测试
/ctx-save
```
