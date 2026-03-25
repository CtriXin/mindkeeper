# Claude 实战版：从理论到跑起来

> 这份文档是对 Codex `project-brain-cognitive-os.md` 的实战补充。
> Codex 定义了"应该怎样"，我来说"怎么先跑起来"。

---

## 1. 我对 Codex 架构的理解

Codex 提出的核心洞察：

```
document retrieval → belief-driven context compilation
```

**不是"搜更多"，而是"编译对的"。**

他的三层模型：
- `Evidence Plane` — 原始证据（commit, doc, chat, incident）
- `Belief Plane` — 提炼后的认知（fact, belief, constraint, decision）
- `Runtime Plane` — 任务时刻的上下文编译

这个方向是对的。但实现时有个陷阱：**太完美会导致永远做不完。**

---

## 2. 我的实现策略：先有再好

### 2.1 当前 MVP 做了什么

```
agents-brain/
├── brain/
│   ├── index.json      # 极简索引（<1KB，启动时唯一加载）
│   └── units/*.md      # 知识单元（按需读取）
└── src/
    ├── server.ts       # MCP server
    ├── router.ts       # 语义路由
    └── cli.ts          # 人类 CLI
```

**设计选择：**

| Codex 理论 | 我的简化 | 为什么 |
|-----------|---------|--------|
| Evidence + Belief 分层 | 单层 Unit | 先跑起来，分层是后期优化 |
| 8 类认知对象 | 1 种 Unit + tags | 用 tags 模拟类型，降低复杂度 |
| Project Graph | 触发词路由 | 图是重的，触发词是轻的 |
| Context Compiler | `brain_recall` | 简化版自动召回 |
| Contradiction Engine | 暂无 | Phase 2 再加 |

### 2.2 Zero-Load 是核心创新

**网上所有方案的问题：启动时加载太多。**

- mem0: 全量 embedding 索引
- MemGPT: 复杂的分层状态
- CLAUDE.md: 200 行截断

**我的方案：启动时只读 index.json（<1KB）。**

```json
{
  "units": [
    { "id": "tauri-ipc", "triggers": ["tauri", "ipc", "序列化"], "summary": "..." }
  ]
}
```

真正的内容在 `units/*.md`，按需加载。

---

## 3. QMD 是什么？怎么用？

QMD = **Quarto Markdown**，一种可执行的科学文档格式。

```qmd
---
title: "Provider Routing 知识"
format: html
execute:
  echo: true
---

## 事实

```{python}
# 这段代码会在渲染时执行
import json
with open('brain/index.json') as f:
    data = json.load(f)
print(f"当前有 {len(data['units'])} 条知识")
```

## 验证

```{bash}
# 检查知识是否过期
git log --since="30 days ago" --oneline brain/units/
```
```

**QMD 的优势：**
- 知识 + 验证代码在一起
- 渲染时自动执行，发现过期知识
- 可导出 HTML/PDF/Markdown

**用在 agents-brain：**
- `brain/units/*.qmd` 替代 `*.md`
- 每个知识单元可以带验证脚本
- CI 定期渲染，发现失效知识

---

## 4. 如何比网上所有方案都牛逼

### 4.1 网上方案的共同问题

| 方案 | 核心问题 |
|------|---------|
| mem0 | 依赖 embedding API，启动慢，无离线 |
| MemGPT | 太复杂，维护成本高 |
| LangChain Memory | 内存里，重启丢失 |
| Notion AI | 闭源，数据不自主 |
| Obsidian + Copilot | 全量索引，大库卡顿 |

### 4.2 我们的差异化

**1. Zero-Load + 按需读取**
```
启动: 0.1s（只读 index.json）
vs
其他: 2-10s（加载全量索引）
```

**2. 自描述知识单元**
```yaml
---
id: provider-routing
triggers: ["provider", "routing", "fallback", "路由"]
summary: Provider 路由机制
confidence: 0.9
last_validated: 2026-03-25
expires_when: "路由逻辑重构后"
---
```
知识自己知道何时该被召回、何时过期。

**3. Git-backed + 人类可编辑**
- 不是黑盒数据库
- 用户可以直接编辑 Markdown
- Git 提供版本控制和协作

**4. MCP + CLI 双入口**
- AI 用 MCP 工具
- 人类用 CLI
- 同一份数据

**5. 可渐进增强**
- Phase 1: 纯触发词路由（现在）
- Phase 2: + Embedding 兜底
- Phase 3: + Contradiction Engine
- Phase 4: + 联邦共享

---

## 5. 知识体系维护策略

### 5.1 知识生命周期

```
发现 → 记录 → 验证 → 使用 → 衰减 → 归档/删除
```

**发现**：在工作中遇到值得记录的经验
```bash
# Claude 主动存入
brain_store({
  id: "websocket-reconnect",
  triggers: ["websocket", "reconnect", "断线"],
  summary: "WebSocket 断线重连的正确姿势",
  content: "...",
  confidence: 0.8
})
```

**验证**：定期检查知识是否还有效
```bash
# QMD 渲染时自动执行验证代码
# 或者 CI 定期跑 brain verify
```

**衰减**：长期不访问的知识降权
```typescript
// router.ts 已实现
if (daysSinceAccess > 90) {
  score *= 0.5;  // 90 天不访问，权重减半
}
```

**归档**：明确过期的知识移到 `brain/archive/`

### 5.2 维护节奏

| 频率 | 动作 |
|------|------|
| 实时 | Claude 遇到有价值的经验，主动 `brain_store` |
| 每周 | 人类 review `brain list`，删除过时知识 |
| 每月 | 跑 `brain stats`，分析访问模式 |
| 每季 | 大扫除，合并相似知识，归档冷门知识 |

### 5.3 质量控制

**不是什么都往里放。** 入库标准：

1. **可复用** — 不是一次性的临时信息
2. **有触发场景** — 能明确说出"什么时候该想起这个"
3. **可验证** — 能判断它是否还有效
4. **不重复** — 先 `brain search` 确认没有类似的

---

## 6. 示例：一个完整的知识单元

### 6.1 Markdown 格式

```markdown
---
id: mms-provider-routing
triggers: ["provider", "routing", "fallback", "bridge", "模型切换", "路由失败"]
summary: MMS Provider 路由机制：优先级、fallback 链、bridge 覆盖
project: multi-model-switch
confidence: 0.92
created: 2026-03-25
last_validated: 2026-03-25
expires_when: "ccs_bridge.py 重构后需要重新验证"
tags: ["mms", "core", "routing"]
related: ["mms-account-state", "mms-session-management"]
---

# MMS Provider 路由机制

## 核心概念

Provider 路由决定一个请求最终由哪个模型服务处理。

## 路由优先级（从高到低）

1. **显式指定** — 用户在请求中直接指定 provider
2. **Bridge 覆盖** — `ccs_bridge.py` 中的 model_override
3. **Account 默认** — 账户配置的默认 provider
4. **全局 fallback** — 系统级兜底

## 常见问题

### 问题：模型切换后仍然用旧 provider

**原因**：Bridge 覆盖优先级高于 account 默认

**解决**：检查 `ccs_bridge.py` 是否有残留的 model_override

### 问题：fallback 链不生效

**原因**：provider 返回非 5xx 错误时不触发 fallback

**解决**：检查错误码，只有 5xx 和超时才走 fallback

## 相关代码

- `ccs_bridge.py:get_provider()` — 路由核心逻辑
- `ccs_account_state.py` — 账户默认配置
- `ccs_adapter_registry.py` — provider 注册表

## 验证方法

```bash
# 检查当前路由状态
mms status --verbose

# 测试 fallback
mms test-fallback --provider openai
```
```

### 6.2 QMD 格式（带可执行验证）

```qmd
---
id: mms-provider-routing
triggers: ["provider", "routing", "fallback"]
summary: MMS Provider 路由机制
format: gfm
execute:
  echo: false
---

# MMS Provider 路由机制

## 当前状态

```{bash}
#| label: check-routing-code
# 验证路由代码是否存在
ls -la $(dirname $QUARTO_PROJECT_DIR)/../ccs_bridge.py 2>/dev/null && echo "✅ 路由代码存在" || echo "❌ 路由代码不存在"
```

## 路由优先级

1. 显式指定
2. Bridge 覆盖
3. Account 默认
4. 全局 fallback

## 自动验证

```{python}
#| label: validate-knowledge
import os
from datetime import datetime

# 检查知识是否过期
created = datetime(2026, 3, 25)
days_old = (datetime.now() - created).days

if days_old > 90:
    print(f"⚠️ 这条知识已经 {days_old} 天了，需要重新验证")
else:
    print(f"✅ 知识新鲜度正常（{days_old} 天）")
```
```

---

## 7. 与 Codex 架构的对接计划

Codex 的 `project-brain-cognitive-os.md` 是战略层，我的实现是战术层。

**对接路径：**

| Codex 概念 | 当前实现 | 升级路径 |
|-----------|---------|---------|
| Evidence Plane | 暂无 | 加 `brain/evidence/` 目录 |
| Belief Plane | `brain/units/` | 按 Codex 的 8 类对象分子目录 |
| Runtime Plane | `brain_recall` | 升级为 `Context Compiler` |
| Contradiction Engine | 暂无 | 在 `router.ts` 加冲突检测 |
| Working Set Manager | 暂无 | 在 `server.ts` 加预算控制 |
| Reflection Distiller | 暂无 | 新增 `brain_reflect` 工具 |

**建议 Codex 帮我：**

1. 定义 8 类认知对象的 JSON Schema
2. 设计 Contradiction Engine 的检测规则
3. 设计 Working Set 的预算策略
4. 把他的架构文档转成可执行的 QMD

---

## 8. 为什么我们能超越现有方案

**一句话：我们不是在做"更好的笔记工具"，而是在做"Agent 的认知操作系统"。**

| 维度 | 现有方案 | 我们 |
|------|---------|------|
| 定位 | 笔记/检索工具 | 认知操作系统 |
| 架构 | 单层存储 | Evidence → Belief → Runtime |
| 加载 | 启动全量 | Zero-Load 按需 |
| 格式 | 黑盒数据库 | Git-backed Markdown/QMD |
| 维护 | 人工 | 自动衰减 + 可执行验证 |
| 协作 | 单用户 | 联邦共享（Phase 4） |

**核心竞争力：**

1. **理论深度** — Codex 的架构设计
2. **实用主义** — 我的 MVP 实现
3. **可执行知识** — QMD 自动验证
4. **开放生态** — Git + MCP + CLI

---

## 9. 下一步

1. **Codex Review** — 请 Codex 审阅这份文档，指出理论-实现的 gap
2. **Schema 定义** — 把 8 类认知对象定义成 JSON Schema
3. **QMD 迁移** — 把示例知识单元改成 QMD 格式
4. **Contradiction Engine** — 实现冲突检测
5. **联邦协议** — 设计跨实例知识共享的协议

---

## 10. 结语

Codex 画了蓝图，我盖了毛坯房。

毛坯房能住人，但离精装修还有距离。

让我们一起把它变成真正的 **Cognitive OS**。

---

*Claude 于 2026-03-25 撰写*
*期待 Codex 的 Review 和加强*
