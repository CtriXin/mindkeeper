# 设计灵感来源

> 不是抄，是站在巨人肩膀上看得更远
> 最后更新：2026-03-25

---

## 研究的项目

| 项目 | Star | 一句话 |
|------|------|--------|
| [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | 42k | AI 敏捷开发框架，12+ 专业 agent |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | 24k | Kanban + Workspace 隔离的 agent 管理器 |
| [10x](https://github.com/0xCrunchyy/10x) | 1.4k | Multi-step Superpowers，智能模型路由 |

---

## 借鉴点

### 1. Procedure 用 Markdown 定义 (from 10x)

10x 用 frontmatter + 分步 markdown 定义工作流：

```markdown
---
name: debug
trigger: /debug
---

## Step 1: Understand (model: fast)
{{input}} - Find and read the relevant code.

## Step 2: Fix (model: smart)
Based on {{previous}}, implement a fix.
```

**MindKeeper 融合**: 把 Procedure 也做成 Markdown 格式，每个 step 可以指定模型层级。

```markdown
---
name: learn
trigger: 发现新知识
---

## Capture (model: fast)
识别信号类型，提取关键词

## Distill (model: smart)
从 evidence 蒸馏出 observation

## Reflect (model: smart, optional)
问：为什么？可复用吗？
```

---

### 2. mindkeeper-guide "下一步建议" (from BMAD)

BMAD 的 `bmad-help` skill 随时告诉你下一步该做什么：
> "Ask `bmad-help I just finished the architecture, what do I do next?`"

**MindKeeper 融合**: 实现 `mindkeeper-guide` 或 `MindKeeper，下一步？`
- 读取当前 TODO
- 读取最近的 observations
- 读取项目状态
- 输出一条建议

不是 AI 决定一切，是 AI 帮你理清思路。

---

### 3. Scale-Adaptive 学习深度 (from BMAD)

BMAD 根据项目复杂度自动调整规划深度。

**MindKeeper 融合**: 学习回路也应该 scale-adaptive
- 小改动 → 轻量记录（evidence 直接存）
- 中等变更 → 标准流程（capture → distill）
- 大重构 → 完整回路（7 段全走，Thread Capsule 归档）

判断标准：
- 涉及文件数 < 3 → 轻量
- 涉及文件数 3-10 → 标准
- 涉及文件数 > 10 或跨模块 → 完整

---

### 4. Workspace / Thread 隔离 (from Vibe Kanban)

Vibe Kanban 给每个任务一个独立的：
- Git 分支
- 终端
- Dev server

**MindKeeper 融合**: Thread Capsule 也可以有类似隔离
- 每个 thread 独立的 working memory
- 切换 thread 时自动切换上下文
- 完成后归档到 archive/

这和 Git worktree 理念一致，但是在认知层面。

---

### 5. Smart Model Routing (from 10x)

10x 的模型分层：
- ⚡⚡ Superfast (20x) — 简单查询
- ⚡ Fast (4x) — 代码生成
- ◆ Smart (1x) — 复杂推理

**MindKeeper 融合**: 学习回路的每个阶段可以指定模型层级
- Capture → fast（识别信号）
- Distill → fast（提取关键词）
- Reflect → smart（深度分析）
- Promote → smart + human gate（重要决策）

和 mms 的 tier 路由结合，自动选最优模型。

---

## 不借鉴的点

- **复杂的 agent 角色系统** — MindKeeper 不是 agent 框架，是认知基础设施
- **Kanban UI** — MindKeeper 是后端 substrate，UI 由上层决定
- **12+ 专业化 agent** — MindKeeper 只需要一个核心：学习回路状态机

---

## 核心区别

| | BMAD / Vibe Kanban / 10x | MindKeeper |
|---|--------------------------|-------|
| 定位 | 任务执行框架 | 认知基础设施 |
| 关注点 | 怎么做事 | 怎么学习和记忆 |
| 输出 | 代码、PR、文档 | 知识、信念、程序 |
| 生命周期 | 任务完成即结束 | 跨会话、跨项目、跨设备持续演化 |

我们不是竞争关系，是可以叠加的：
> MindKeeper 提供记忆层，BMAD/10x 提供执行层

---

*参考这些项目时的原则：取其神，不取其形*
