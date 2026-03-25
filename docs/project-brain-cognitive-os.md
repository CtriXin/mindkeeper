# Project Brain / Cognitive OS 落地设计文档

## 1. 文档目标

这份文档定义一个超越 `memory.md`、`knowledge.md`、简单 `RAG` 与零散笔记系统的认知基础设施：

- 它不是“再做一个更大的知识库”
- 它也不是“把所有文档都向量化”
- 它的目标是构建一个面向全项目、全仓库、全任务生命周期的 `Project Brain`
- 在运行时，它表现为一个 `Cognitive OS`

核心能力不是“记住更多”，而是：

- 在任务发生时，知道当前真正相关的是什么
- 知道哪些信息只是资料，哪些已经可以成为决策依据
- 知道哪些规则过期、冲突、缺乏证据，不能直接拿来用
- 持续把项目中的原始材料沉淀成可执行的认知状态

一句话定义：

> `Project Brain` 是项目级认知底座；`Cognitive OS` 是它在任务时刻的运行时。

---

## 2. 为什么不能再停留在 markdown memory

传统方案通常是：

`query -> retrieve -> stuff context -> generate`

这类方案的问题不是“搜不到”，而是“搜到了也不一定能用对”。

典型问题：

- 原始资料、经验总结、操作规则、个人偏好混在一起
- 没有 `confidence`、`scope`、`expiry`，旧规则会污染新决策
- 没有冲突检测，只做相似度召回
- 没有任务态，系统不知道“当前到底在解决什么问题”
- 没有工作集管理，context 越积越厚，系统越来越钝
- 没有反思闭环，项目越做越多，但系统不会变聪明

所以这里要做的不是 `memory++`，而是范式切换：

`document retrieval -> belief-driven context compilation`

---

## 3. 升级后的总体定义

### 3.1 北极星

构建一个面向全项目的认知系统，让 agent、开发者、维护者在任何一个任务节点都能得到：

- 当前目标与优先级
- 已验证事实
- 可操作规则
- 风险约束
- 相关代码/文档/历史决策
- 反例、冲突与不确定性
- 当前最小必要 `Working Set`

### 3.2 最终形态

最终不是一个“知识文件夹”，而是一套三层体系：

1. `Evidence Plane`
   - 原始证据层
   - 来自代码、文档、commit、issue、chat、runbook、incident、PR、任务记录

2. `Belief Plane`
   - 认知抽象层
   - 把原始证据提炼为事实、规则、假设、约束、流程、风险、偏好、架构不变量

3. `Runtime Plane`
   - 运行时编译层
   - 在某个具体任务中，把合适的认知单元编译成当前上下文

可以把它理解成：

- `Evidence Plane` 解决“有哪些依据”
- `Belief Plane` 解决“这些依据意味着什么”
- `Runtime Plane` 解决“这次该拿哪些来判断和执行”

---

## 4. 系统核心原则

### 4.1 文件只是视图，不是唯一真相

`markdown` 文档仍然很重要，但应更多承担：

- 人类可读视图
- Review 入口
- 手工修订入口
- 导出物

而不是唯一的 canonical source。

更稳妥的做法是：

- 原始事件进入 `Event Ledger`
- 提炼结果进入 `Belief Ledger`
- 图关系进入 `Project Graph`
- 再生成适合人看的 `markdown views`

### 4.2 先保留证据，再形成结论

所有高价值结论都必须能追溯到证据：

- 这个约束来自哪个文档或讨论
- 这个偏好基于哪些历史交互
- 这个流程为何被认为有效
- 这条规则什么时候最后验证过

### 4.3 认知单元必须带边界

任何认知单元都应至少有：

- `type`
- `confidence`
- `scope`
- `source`
- `last_validated_at`
- `expiry` 或 `invalidates_when`

否则系统会变成“把历史噪音伪装成智慧”。

### 4.4 决策前必须有冲突检查

系统不该只找“最相关的信息”，还必须找：

- 与当前计划冲突的规则
- 与当前目标不一致的长期约束
- 证据不足但信心过高的判断
- 已经被新规则覆盖的旧经验

### 4.5 遗忘是核心能力

系统必须支持：

- `Decay`：长期无使用，权重下降
- `Supersede`：被新规则覆盖
- `Compress`：多条事件压缩成更高层模式
- `Archive`：退到冷存储

目标不是无限存，而是“长期保持清醒”。

---

## 5. 从“单库”升级为“分层项目脑”

如果目标是“全项目知识库”，最容易踩的坑是做成一个巨大的统一索引。更好的结构是四层脑：

### 5.1 `Global Brain`

跨项目稳定存在的内容：

- 通用工程原则
- 团队协作规则
- 常见 failure pattern
- 风格偏好
- 通用 playbook
- 通用评审准则

### 5.2 `Project Brain`

单个项目级内容：

- 项目目标
- 业务领域模型
- 架构边界
- 模块职责
- 关键依赖
- 运行与发布流程
- 术语表
- 历史 ADR 与重要 tradeoff
- 项目级禁区与不变量

### 5.3 `Thread Capsule`

某次任务、分支、Bug、需求、incident 的活动认知包：

- 当前目标
- 当前假设
- 涉及文件
- 临时发现
- 当前风险
- 未决问题
- 下一步动作

### 5.4 `Artifact Lens`

面向具体资产的局部视图：

- 单个仓库
- 单个模块
- 单个服务
- 单个接口
- 单个文档
- 单个类/函数

这四层之间不是简单包含关系，而是通过 graph 连接：

- `Global Brain` 提供通用原则
- `Project Brain` 提供项目语义
- `Thread Capsule` 提供当前任务态
- `Artifact Lens` 提供局部精确信息

运行时通过 `Context Compiler` 进行拼装。

---

## 6. 认知对象模型

### 6.1 不再只有 memory，至少拆成 8 类对象

1. `Fact`
   - 已验证事实
   - 例：某服务监听端口、某模块 owner、某流程入口

2. `Belief`
   - 带置信度的判断
   - 例：某类问题通常由配置漂移导致

3. `Constraint`
   - 不得违反的规则
   - 例：上线前必须经过某验证；新增依赖前需明确告知

4. `Procedure`
   - 可复用步骤
   - 例：排查登录异常的 7 步流程

5. `Decision`
   - 已做出的选择与理由
   - 例：为什么放弃某方案，为什么采用某架构

6. `Intent`
   - 当前阶段目标或长期方向
   - 例：本季度优先稳定性而非功能扩张

7. `Risk`
   - 已知风险模式
   - 例：某模块改动容易引发 session 泄漏

8. `Reflection`
   - 从任务复盘得到的规律
   - 例：遇到用户说“不是这个问题”时必须先重构 framing

### 6.2 每个对象都应带标准元数据

```yaml
id: belief.project.routing.order
kind: belief
title: Source resolution order should remain stable
statement: Default source/model resolution order should not be changed silently
scope:
  project: multi-model-switch
  surfaces:
    - launcher
    - routing
    - bridge
confidence: 0.91
source_refs:
  - docs/AGENT_GUARDRAILS.md
  - AGENTS.md
status: active
last_validated_at: 2026-03-25
invalidates_when:
  - config schema changed with approved migration
owners:
  - codex
  - human
```

### 6.3 决策必须支持证据链

```yaml
decision:
  id: decision.use_belief_graph_over_plain_rag
  summary: Use Belief Graph as first-class layer instead of plain markdown retrieval
  rationale:
    - plain retrieval cannot express scope or conflict
    - project knowledge requires runtime compilation, not file dumping
  supporting_evidence:
    - incident.misleading_old_rule
    - reflection.context_overload
  counterpoints:
    - higher implementation complexity
  status: proposed
```

---

## 7. 升级版总体架构

### 7.1 架构概览

```text
Sources
  |- code repos
  |- markdown/docs
  |- issues / PRs / commits
  |- chat logs / handoff notes
  |- runbooks / incidents
  |- local task plans
  v
Ingestion Layer
  |- collectors
  |- parsers
  |- change detectors
  |- event normalizers
  v
Storage Layer
  |- Event Ledger        (append-only raw events)
  |- Belief Ledger       (curated cognitive units)
  |- Project Graph       (entities + relations)
  |- Search Index        (keyword / semantic / structural)
  v
Reasoning Layer
  |- Task Classifier
  |- Salience Scorer
  |- Context Compiler
  |- Contradiction Engine
  |- Working Set Manager
  |- Reflection Distiller
  v
Interfaces
  |- CLI / TUI
  |- Agent SDK
  |- markdown views
  |- review dashboard
```

### 7.2 为什么是四存储，不是一库打天下

`Event Ledger`
- 保存原始事实流
- 优势是可追溯、可重放、适合审计

`Belief Ledger`
- 保存提炼后的认知结果
- 优势是可修正、可比较、可降噪

`Project Graph`
- 保存实体及关系
- 优势是知道“谁跟谁有关”

`Search Index`
- 提供快速定位能力
- 只是辅助层，不是主认知层

---

## 8. 关键模块设计

### 8.1 Source Adapters

负责从各类项目资产中提取证据。

首批建议覆盖：

- Git 仓库：代码、commit、branch、tag、diff
- 文档：`README`、`docs/`、`ADR`、`runbook`
- 项目协作物：`issue`、`PR`、release notes
- 本地 agent 文件：`AGENTS.md`、`.ai/plan`、handoff 文档
- 运行记录：测试结果、故障记录、操作日志

输出统一为 `Event`：

```yaml
event:
  id: event.commit.abc123
  kind: commit
  project: agents-brain
  occurred_at: 2026-03-25T10:00:00+08:00
  actor: xin
  artifact_ref: repo://agents-brain
  summary: add initial Project Brain architecture doc
  payload:
    files_changed:
      - docs/project-brain-cognitive-os.md
```

### 8.2 Normalization Pipeline

职责：

- 统一不同来源的 schema
- 提取实体、主题、模块、owner、风险信号
- 切分成可追踪认知单元
- 建立跨源关系

例如：

- 从一个 `PR` 中提取 `Decision` 与 `Risk`
- 从一次 incident 复盘中提取 `Procedure` 与 `Constraint`
- 从多次交互中提取 `Preference` 与 `Reflection`

### 8.3 Belief Distiller

把高频、重复、稳定的事件压缩成带置信度的认知对象。

处理链建议为：

`events -> observations -> patterns -> beliefs -> policies`

其中最关键的一步是不要直接“总结全文”，而是：

- 先抽 observation
- 再做 pattern clustering
- 再决定是否晋升为 belief 或 policy

### 8.4 Project Graph

图里至少要有这些节点：

- `Project`
- `Repo`
- `Module`
- `Doc`
- `Decision`
- `Constraint`
- `Procedure`
- `Risk`
- `Owner`
- `Thread`
- `Incident`
- `Task`

关系至少包括：

- `depends_on`
- `owned_by`
- `documented_in`
- `decided_by`
- `constrained_by`
- `supersedes`
- `contradicts`
- `derived_from`
- `relevant_to`
- `triggered_by`

### 8.5 Context Compiler

这是整套系统最核心的模块。

输入不是简单 query，而是：

- 当前任务描述
- 当前仓库 / 模块 / 文件位置
- 最近交互
- 当前分支或任务线程
- 激活的项目约束
- 用户或团队偏好

输出是一个严格预算化的 `Working Set`：

```yaml
working_set:
  task_type: design_doc
  primary_goal: define project-level cognitive knowledge system
  active_constraints:
    - document should be actionable, not slogan-heavy
    - project knowledge must be traceable and updateable
  verified_facts:
    - target repo is currently empty
  active_beliefs:
    - markdown should be view layer, not sole source of truth
  related_artifacts:
    - docs/project-brain-cognitive-os.md
  open_questions:
    - should storage start with sqlite or postgres
  risks:
    - overengineering before first real ingestion pipeline
  next_actions:
    - create doc scaffold
    - define canonical object schema
```

### 8.6 Contradiction Engine

该模块在输出上下文前进行反证检索。

检查内容：

- 是否有同 scope 下的新规则覆盖旧规则
- 是否有高 `confidence` 的反例
- 是否有只适用于别的项目/模块的经验被误用
- 是否有过期知识被重新激活
- 当前计划是否触碰 protected surface

它的目标不是“更全面”，而是“降低高代价误判”。

### 8.7 Working Set Manager

管理运行时预算，防止上下文失控。

建议默认预算：

- `goal`: 1-3
- `constraints`: 3-7
- `verified_facts`: 5-12
- `beliefs`: 3-8
- `risks`: 1-5
- `open_questions`: 1-5
- `artifacts`: 3-10

超过预算时：

- 合并重复项
- 提升抽象层级
- 把背景降级为摘要
- 把冷门历史移出 active set

### 8.8 Reflection Distiller

任务结束后输出结构化反思，而不是只留聊天记录。

模板建议：

```yaml
reflection:
  task: draft_project_brain_doc
  succeeded_because:
    - started from architecture instead of raw storage details
  mistakes_avoided:
    - did not reduce system to markdown note store
  reusable_patterns:
    - use layered brain model for project-scale knowledge systems
  new_beliefs:
    - empty repos should start from canonical schemas and views together
  updates_needed:
    - create initial repo scaffold after doc review
```

---

## 9. 全项目知识库的“全”到底指什么

这里的“全项目”不建议理解为“把所有文件都收进来”，而应理解为覆盖完整的项目认知闭环：

### 9.1 纵向全生命周期

- 立项
- 设计
- 开发
- Debug
- 测试
- 发布
- 运维
- 复盘
- 迭代

### 9.2 横向全资产类型

- 代码
- 文档
- 配置
- 流程
- 会话
- 决策
- 复盘
- 故障
- owner 关系
- 术语与领域模型

### 9.3 决策全链路

对于一个结论，理想状态下都能回答：

- 谁提出的
- 为什么提出
- 基于什么证据
- 适用于哪里
- 与什么冲突
- 何时失效
- 被什么取代

真正的全项目知识库不是更大，而是更可问责、更可追踪。

---

## 10. 推荐的仓库落地结构

建议 `agents-brain` 仓库从一开始就分清“源数据、认知数据、视图、运行时”。

```text
agents-brain/
  README.md
  docs/
    project-brain-cognitive-os.md
    architecture/
    playbooks/
    adr/
  brain/
    schemas/
      event.schema.json
      belief.schema.json
      decision.schema.json
      reflection.schema.json
    ledgers/
      events/
      beliefs/
      reflections/
    views/
      global/
      projects/
      threads/
    graph/
      entities.jsonl
      relations.jsonl
  runtime/
    compilers/
    policies/
    prompts/
  adapters/
    git/
    docs/
    issues/
    chat/
  scripts/
    ingest/
    distill/
    compile/
    verify/
  examples/
    working-set.sample.yaml
    belief.sample.yaml
```

说明：

- `docs/` 给人看
- `brain/ledgers` 给系统留痕
- `brain/views` 给人机共读
- `runtime/` 负责在任务时刻编译上下文
- `adapters/` 负责接各种项目源
- `scripts/` 负责把流程跑起来

---

## 11. 实现策略：先做“可运行最小脑”，再做“大统一平台”

### Phase 1：MVP（1-2 周）

目标：先证明系统能在真实任务中比 `memory.md` 更稳。

交付：

- 定义 canonical object schema
- 建立 `Event Ledger` 与 `Belief Ledger` 的最小目录结构
- 实现一个本地 `Context Compiler`
- 支持从 `docs/`、`AGENTS.md`、近期任务文件中编译 `Working Set`
- 生成人类可读的 `project view`

成功标准：

- 对同一个任务，编译出的上下文明显优于手工拼接文档
- 能明确区分 `fact / constraint / belief / risk`

### Phase 2：Project Brain（2-4 周）

目标：把单次编译升级为项目持续认知。

交付：

- 接入 Git 变更
- 接入 `ADR` / runbook / issue / PR
- 构建初版 `Project Graph`
- 加入 `Contradiction Engine`
- 加入 `Reflection Distiller`

成功标准：

- 能从项目历史中自动识别关键规则与过期规则
- 能在任务前输出风险和反例

### Phase 3：Multi-Project Brain（4-8 周）

目标：支持跨项目迁移与共享知识。

交付：

- `Global Brain` 与 `Project Brain` 分层
- 跨项目 procedure 复用
- 通用 failure pattern 库
- `scope-aware` 编译与过滤
- 支持跨仓库查询与引用

成功标准：

- 能复用通用经验，但不会错误污染当前项目
- 新项目能从已有经验快速冷启动

### Phase 4：Operational OS（8 周+）

目标：真正形成项目认知操作系统。

交付：

- `Working Set Manager` 自动预算控制
- `Belief Revision` 机制
- `Decay / Supersede / Archive` 策略
- Review dashboard
- Agent SDK / CLI 接口

成功标准：

- 系统开始体现“自己会更新认知状态”的能力
- 不再依赖人工维护单个总文档

---

## 12. 技术选型建议

### 12.1 初期不要一上来就重数据库

建议启动顺序：

1. `JSONL + markdown views + filesystem`
2. `SQLite` 作为本地索引与查询层
3. 当多项目、多用户、多进程协作出现后再考虑 `Postgres`

原因：

- 前期最难的是 schema、流程、边界，不是吞吐量
- 太早上复杂存储会掩盖真正的问题
- 先把认知模型做对，比把 infra 做大更重要

### 12.2 搜索是辅助，不是主体

建议并行保留三种检索：

- `keyword search`
- `semantic search`
- `structural graph traversal`

优先级建议：

`constraint / decision / graph relation > semantic similarity`

因为项目知识最怕“语义像，但上下文不对”。

### 12.3 LLM 负责提炼与编译，不负责伪造真相

LLM 适合：

- 抽取 observation
- 归纳 pattern
- 生成摘要视图
- 编译 `Working Set`
- 提供反思草稿

LLM 不应直接拥有：

- 无证据的事实落库权
- 无边界的规则提升权
- 静默覆盖旧规则的权限

---

## 13. 质量指标

这类系统不能只看“召回率”，更要看认知效果。

建议指标：

### 13.1 Runtime 质量

- `Working Set Precision`
  - 当前上下文中真正有用项的比例

- `Decision Support Coverage`
  - 做关键决策时，关键约束/反例是否进入上下文

- `Conflict Catch Rate`
  - 冲突规则被提前发现的比例

### 13.2 Knowledge 质量

- `Belief Freshness`
  - belief 最近一次验证时间的健康度

- `Traceability Rate`
  - 认知对象可回溯到证据的比例

- `Superseded Noise Ratio`
  - 已过期但仍被激活的知识占比

### 13.3 演化能力

- `Reflection Adoption Rate`
  - 反思中提炼出的模式被后续复用的比例

- `Cross-Project Reuse Accuracy`
  - 跨项目经验复用时不误伤当前项目的比例

---

## 14. 风险与防过度设计策略

### 风险 1：过早追求“大一统知识平台”

应对：

- 先服务一个真实项目
- 先让 `Context Compiler` 可用
- 先建立最小 schema，再扩展 source

### 风险 2：把总结当事实

应对：

- 所有提炼对象必须带 `source_refs`
- 高影响规则要求人工 Review
- belief 与 fact 严格分离

### 风险 3：知识无限膨胀

应对：

- 默认引入 `Decay / Supersede / Compress`
- 视图分层，不做一个超大总览
- 运行时严格预算

### 风险 4：跨项目知识误用

应对：

- 每个对象都要有 `scope`
- 编译时必须进行 scope filtering
- `Global Brain` 只收高稳定通用模式

### 风险 5：最后又退化成文档仓库

应对：

- 从第一天起就同时维护 ledger 和 view
- 文档不再承担唯一真相角色
- 任何运行时上下文都来自编译，不是手工复制粘贴

---

## 15. 建议的第一个真实闭环

如果现在就开始做，我建议第一条闭环不是“全量采集”，而是：

### 闭环目标

让系统能够为一个真实项目任务自动生成高质量 `Working Set`。

### 输入

- 当前任务描述
- 项目规则文件
- `docs/` 文档
- 最近 20 次关键变更
- 当前线程/分支笔记

### 输出

- 当前目标
- 当前约束
- 已验证事实
- 活跃 belief
- 相关 artifact
- 风险与冲突
- 建议下一步

### 为什么先做这个

因为这一步最容易直接验证价值：

- 是否减少跑偏
- 是否减少重复阅读
- 是否减少错用旧规则
- 是否让 agent 真正“更像理解项目”而不只是“更会搜项目”

---

## 16. 一套可以直接沿用的命名

如果要把这个体系产品化，推荐以下命名：

- 系统总名：`Project Brain`
- 运行时：`Cognitive OS`
- 证据账本：`Event Ledger`
- 信念账本：`Belief Ledger`
- 图层：`Project Graph`
- 编译器：`Context Compiler`
- 冲突引擎：`Contradiction Engine`
- 工作集管理：`Working Set Manager`
- 反思蒸馏器：`Reflection Distiller`
- 项目视图：`Project View`
- 线程胶囊：`Thread Capsule`

这套命名的好处是：

- 有系统感
- 有清晰分层
- 便于后续代码模块映射
- 不会把方案降维成“又一个笔记插件”

---

## 17. 最终结论

如果你要做的是“全项目知识库”，真正值得做的不是：

- 一个更大的 `memory.md`
- 一个更强的全文搜索
- 一个更花哨的向量索引

而是一个具备以下能力的项目认知系统：

- 以证据为底
- 以 belief 为中层抽象
- 以 runtime compilation 为实际入口
- 以冲突检测和遗忘机制保证长期质量
- 以 reflection 形成持续进化

最终它应该让 agent 在项目里具备三种能力：

- 看见项目：知道结构、资产、关系、历史
- 理解项目：知道哪些规则成立、哪些不成立、为什么
- 参与项目：在每次任务中拿到正确的最小认知包并持续自我更新

这才是超越 `memory.md` 的真正方向。
