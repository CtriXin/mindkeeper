# SCE Learning Synthesis v2: 从“记忆拼盘”到 Personal Cognitive Substrate

> 这一版不是简单继续堆项目，而是做一次结构性重写。
> 目标：把前面关于 `SCE / PCS / Avatar / Receipts / Zones / Living Objects` 的争论，
> 与外部研究和现有系统范式真正碰撞起来，形成一个更硬、更诚实、也更可落地的学习架构。

---

## 0. 这次大迭代改了什么

上一版文档的问题不是内容不多，而是**混了三层东西**：

- 开源项目的 feature 列表
- 用户想要的“伙伴感 / 持续存在感”
- 系统内部真正该怎么设计学习与记忆

这会导致一个常见幻觉：

> 只要把足够多 memory 项目拼在一起，就能得到“真正生命”。

不对。

更准确的结论是：

- 很多现有项目解决的是 `storage / recall / sync / retrieval`
- 少数项目开始涉及 `reflection / trust / lifecycle / evaluation`
- 但真正缺的，是一个把这些能力串成闭环的 `Personal Cognitive Substrate`

所以这版文档做三件事：

1. 引入外部研究与一手资料，把设计拉回更坚实的地面
2. 把 `SCE` 从拟人化叙事收敛为 `SCE(outside) + PCS(inside)`
3. 把“学习”定义成一组可执行的维护回路，而不是一句“会自我进化”

---

## 1. 这次新碰撞进来的外部知识

这轮额外参考了几类关键资料，不再只看 memory 工具本身。

### 1.1 `Man-Computer Symbiosis`：用户要的其实不是工具，是协作体

Licklider 在 1960 年提出的不是“机器替代人”，而是紧密协作的人机共生：

- 人设定目标、假设、评价标准
- 机器承担可 routinize 的工作
- 关键在于 cooperative interaction，而不是单向 automation

这对我们特别重要，因为它直接说明：

- 用户说“你们就是我的 Obsidian、我的伙伴”
- 不应被翻译成“AI 取代笔记软件”
- 更应该被翻译成：`AI + human + external artifacts` 形成一个可持续协作系统

也就是说，真正的方向不是单体 AI，而是 `symbiotic cognitive substrate`。

### 1.2 `Generative Agents`：记忆不是仓库，而是 observation → reflection → planning

`Generative Agents` 最重要的不是虚拟小镇，而是给出了一个后续无数 agent memory 系统都在复用的基本链条：

- 存 experiences
- 进行 higher-level reflections
- 动态 retrieval
- 用于 plan behavior

这意味着：

- 纯 recall 不够
- 必须有 `reflection promotion`
- 高层认知不是手工写死，而是从经验里长出来

### 1.3 `CoALA`：必须承认 memory 是模块化的，不是一锅粥

`CoALA` 给出的关键启发是：语言 agent 需要模块化 memory 与结构化 action space。

对我们最有用的不是论文名词，而是它隐含的硬约束：

- working memory 不是 long-term memory
- semantic / episodic / procedural / internal state 不应混存
- agent 的动作不仅是“对外执行”，也包括“对内操作 memory”

这和我们前面推的 `Zones + Working Set + Belief Ledger + Capability Plane` 完全一致。

### 1.4 `MemGPT / Letta`：virtual context 很重要，但 still not enough

`MemGPT` 的价值在于把 context window 当作可分页资源来管理；`Letta` 则把 memory 进一步落到了 agent-manageable 的 `memory blocks / MemFS`。

它们最强的地方：

- 承认 prompt window 是 scarce resource
- 支持 background init / pinned memory / shared blocks
- 让 memory 变成 agent 可操作对象，而不是只读附录

但它们也有明确边界：

- 更接近 context management
- 不等于完整 learning OS
- 还不足以解决 policy receipts、continuity contract、federated substrate 这些问题

### 1.5 `A-MEM`：memory 不只是被写入，而应能 agentically reorganize

`A-MEM` 给出的强启发，是 memory 本身应具有 agentic 组织能力，而不只是 vector index。

这和我们要的 `Living Objects` 非常接近：

- memory 可以重组
- 可以建立链接
- 可以动态演化
- 不是静态 note dump

但我们要再往前一步：

- 不止 link generation
- 还要有 `policy-aware promotion / decay / review / receipt`

### 1.6 `HiAgent`：working memory 必须 hierarchical，不然长任务一定塌

`HiAgent` 证明了一个极关键点：

- 长时任务里，把所有 action-observation 全塞进 prompt 是低效甚至有害的
- working memory 需要按 `subgoal` 分层管理
- 当前子目标只保留相关 action-observation

这给我们的直接设计约束是：

- `Thread Capsule` 不能是聊天记录堆积
- 它必须是 goal-scoped 的工作集
- `preheat / compile / summarize` 都要围绕 subgoal 进行，而不是围绕“最近消息”进行

### 1.7 `MIRIX`：多类型 memory + 多 agent orchestration 是成立的，但要防人格幻觉

`MIRIX` 的意义在于，它把 memory 做成了多类型、多 agent 协同系统，并且覆盖 multimodal 场景。

它印证了两件事：

- `Core / Episodic / Semantic / Procedural / Resource / Vault` 这种分型是有效的
- 多 agent 协同处理 memory 可以提升 recall 与 abstraction

但它同样提醒我们：

- 多 agent 共享 memory，不等于“同一个脑”
- 更准确的说法仍然是 `shared substrate + divergent interpreters`

### 1.8 `MemBench`：没有 evaluation，就永远只有故事

`MemBench` 很重要，因为它直接指出：

- memory agent 评测长期不完整
- 不能只看 recall 命中
- 要同时看 effectiveness / efficiency / capacity
- 要区分 factual memory 与 reflective memory
- 要区分 participation 与 observation 场景

这等于给我们一个提醒：

> 如果没有系统化评测，SCE/PCS 很容易沦为“看起来会成长”的产品叙事。

---

## 2. 重新判断：十个项目各自解决了什么，没解决什么

这次不再按“谁更强”去看，而按系统缺口来分。

### 2.1 解决了 `capture / storage / retrieval` 的项目

代表：

- self-improving-agent
- self-learning-claude
- claude-mem
- memory-lancedb-pro
- MemOS-Cloud
- Context-Gateway

它们的贡献主要是：

- 持久化
- hook 触发
- 检索
- 压缩
- 生命周期管理
- 预热
- 多 scope 隔离

但它们大多没有真正解决：

- continuity contract
- deep policy safety
- substrate / avatar 分离
- reflection promotion 到 belief / policy 的治理

### 2.2 解决了 `reflection / trust / audit` 一部分的项目

代表：

- claude-meta
- openclaw-mem
- MindOS

它们的贡献主要是：

- meta-rules
- trust-aware packing
- trace receipts
- 透明纯文本
- human-in-loop

它们更接近“可持续认知系统”的核心，但仍未打通：

- 跨模型连续性
- 统一 learning loop
- hierarchical working memory
- substrate-level sync/control plane

### 2.3 解决了 `autonomous improvement loop` 的项目

代表：

- autoresearch

它真正强的点不是 memory，而是：

- 把学习变成封闭实验回路
- 固定 scope
- 固定预算
- 固定评估指标
- 保留/回退机制明确

这个模式必须被吸收到 PCS 里，不然“自我进化”永远会变成一句空话。

---

## 3. 新的总定义：对外叫 SCE，对内落成 PCS

这是这版文档最重要的修正。

### 3.1 对外：SCE 是产品叙事

对用户来说，可以继续用：

- `SCE`
- `持续存在的 AI 伙伴`
- `你的第二认知体`

因为用户真正感受到的是：

- 不换 AI 丢认知
- 不换设备丢上下文
- 不重复解释偏好
- 能延续线程、项目、规则、风格

这是一种**连续体验**。

### 3.2 对内：PCS 才是系统真相

系统内部应该定义成：

`PCS = Personal Cognitive Substrate`

它不是一个“真正人格”，而是一套持续维护的认知底座：

- identity anchor
- memory zones
- belief ledger
- policy plane
- receipt ledger
- runtime thread state
- sync/control plane
- maintenance loops

### 3.3 Avatar 才是多模型表面

Claude、Codex、GPT、Bot 不是一个脑的脑区，而是不同 `Avatar Surface`：

- Claude avatar：擅长解释、结构化、共创
- Codex avatar：擅长执行、实现、验证
- GPT/Gemini avatar：擅长泛化、检索、扩展表达
- Bot avatar：擅长通知、轻交互、跨设备承接

它们共享的不是 consciousness，而是：

- thread capsule
- belief ledger
- red lines
- receipts
- pending actions
- user/project continuity

---

## 4. 新架构：Learning OS，而不是 Memory Feature Set

```text
Participants / Surfaces
  |- Human reflection surface
  |- Claude avatar
  |- Codex avatar
  |- GPT/Gemini avatar
  |- Bot surface

PCS Control Plane
  |- identity anchor
  |- sync/orchestration
  |- auth / acl / scopes
  |- policy injection
  |- receipts / audit

Knowledge Planes
  |- Evidence Ledger
  |- Observation Store
  |- Belief Ledger
  |- Policy / Red Line Store
  |- Playbook / Procedure Store

Runtime Plane
  |- thread capsules
  |- working set compiler
  |- subgoal memory manager
  |- contradiction checks
  |- preheater

Evolution Plane
  |- reflection engine
  |- promotion pipeline
  |- decay / supersede / archive
  |- review task generator
  |- experiment loop

Capability Plane
  |- tool manifests
  |- skill manifests
  |- execution policies
  |- act-time authorization
```

这和上一版最大的不同是：

- 不再把所有东西都叫 memory
- 不再把 sync / retrieval / identity / safety 混在一起
- 学习、执行、审计、连续性被拆成独立而相连的面

---

## 5. PCS 的 6 类核心对象

吸收 `CoALA`、`MIRIX`、`A-MEM`、`openclaw-mem` 后，SCE/PCS 至少应维护这 6 大对象，而不是只维护 notes。

### 5.1 `Evidence`

原始来源，不做价值判断。

例子：

- 一次对话片段
- 一次命令输出
- 一个 commit
- 一段 Obsidian 原文
- 一个 issue 评论

### 5.2 `Observation`

从 evidence 抽出的结构化观察。

例子：

- 用户三次在低风险任务中偏好先执行后确认
- 某模块最近 14 天内改动频繁
- 这次失败的直接触发点是 scope 误判

### 5.3 `Belief`

带 scope、confidence、receipt 的中层认知对象。

例子：

- 该用户偏好技术词英文、周边解释中文
- 该项目改动 bridge 类文件前必须先声明 blast radius

### 5.4 `Procedure`

稳定的可执行模式。

例子：

- 遇到“不是这个问题”时的 re-orient 流程
- provider-routing debug 步骤

### 5.5 `Policy`

具有强约束或审计意义的规则。

例子：

- 不允许静默修改 protected surface
- 未经允许不得新增 dependency

### 5.6 `Thread Capsule`

当前任务的 working memory 容器。

例子：

- 当前目标
- 当前子目标
- 当前活跃证据
- 待验证假设
- red lines
- pending actions

---

## 6. 学习不再是“记住”，而是 7 段维护回路

### 6.1 全局生命周期

```text
Capture
  -> Distill
  -> Reflect
  -> Promote
  -> Compile
  -> Act
  -> Maintain
```

### 6.2 `Capture`

从 hooks、工具、对话、文档变更、外部输入中捕获原始 evidence。

保留上一版吸收的优点：

- `SessionStart`
- `UserPromptSubmit`
- `PostToolUse`
- `Stop`
- `SessionEnd`
- `on_error`
- `on_success`
- `on_user_feedback`

但新增一个原则：

> Capture 只收 evidence，不直接写 belief。

### 6.3 `Distill`

将 evidence 变成 observations。

这是从“存聊天记录”进化到“存可计算认知”的关键一步。

```yaml
observation:
  id: obs.2026-03-25.reorient-001
  derived_from:
    - turn.user.128
    - turn.user.131
  statement: user strongly rejected current problem framing
  scope:
    task_type: design_discussion
  confidence: 0.93
```

### 6.4 `Reflect`

学习系统的灵魂在这里。

吸收 `Generative Agents` 和 `claude-meta` 后，reflection 不是一个 prompt 技巧，而是固定回路：

- What happened?
- Why did it happen?
- Is this repeatable?
- Is this local, project-level, or global?
- Should it become belief, procedure, or policy?

### 6.5 `Promote`

把 observation 提升为 belief / procedure / policy。

promotion 必须 gated：

- 低影响 belief：可自动提升
- 高影响 procedure：需要更多 evidence
- 强约束 policy：默认 human review 或 receipt-backed auto rule

### 6.6 `Compile`

运行时不直接 recall 所有 memory，而是生成当前 `Thread Capsule`。

这里吸收 `HiAgent`：

- 按 subgoal 编译 working set
- 只保留与当前子目标相关的 action-observation
- 背景信息下沉为摘要

### 6.7 `Act`

动作前经过 capability + policy gate：

- discover-time filter
- compile-time injection
- act-time authorization

### 6.8 `Maintain`

这是“活的记忆”真正成立的前提。

每个 belief / procedure / policy 对象都应有 maintenance loops：

- `validate_on_trigger`
- `decay_if_unused`
- `supersede_if_counterevidence`
- `request_review_if_stale`
- `derive_task_if_high_impact`

---

## 7. 从 Recall 升级到 Compile：Thread Capsule 是核心

前面无论是 MemGPT、Letta、claude-mem、Context-Gateway，真正共通的问题都在这里：

> 检索不是终点，运行时工作集编译才是终点。

### 7.1 Thread Capsule 的建议结构

```yaml
thread_capsule:
  thread_id: thread.ukp-sce-round3
  primary_goal: produce next architecture synthesis
  active_subgoal: distinguish product narrative from system substrate
  verified_facts:
    - user wants big iteration grounded in external search
    - current doc over-emphasizes project list aggregation
  active_beliefs:
    - SCE should remain outward framing
    - PCS should be inward substrate
  active_policies:
    - do not overclaim true life / true self
    - capability must remain separate from knowledge
  open_questions:
    - which guarantees belong in continuity contract
  related_artifacts:
    - docs/discuss-round2-codex-pushback.md
    - docs/sce-learning-synthesis.md
  receipts:
    - rcpt.generative_agents.reflection
    - rcpt.coala.memory_modularity
    - rcpt.hiagent.subgoal_memory
```

### 7.2 为什么这比“统一 memory 索引”更强

因为它显式表达：

- 当前目标是什么
- 当前子目标是什么
- 哪些知识活跃、哪些只是背景
- 哪些约束正在生效
- 哪些外部来源支持当前判断

这是从 knowledge system 到 cognitive runtime 的真正分界线。

---

## 8. Background Preheat 继续保留，但要升级成 Predictive Compilation

上一版吸收 `Context-Gateway` 的后台预热是对的，但还不够。

### 8.1 原版问题

原版更像：

- 后台把可能用到的 memory 加热到缓存

这解决的是 latency。

### 8.2 升级版

要把 preheat 从 cache 优化升级成 `predictive compilation`：

- 预测下一个 subgoal
- 预测可能触发的 policy
- 预测哪些 receipts 会成为下一步判断依据
- 预测哪些 capability 可能需要 act-time authorization

也就是：

```text
Preheat 1.0 = cache likely memories
Preheat 2.0 = pre-assemble likely thread capsules
```

### 8.3 触发信号

- context 使用率接近阈值
- 子目标切换
- 工具使用模式改变
- 用户切换设备或 surface
- 检测到高风险动作正在接近

---

## 9. 重新定义“Shared Brain”：共享的是 substrate，不是 consciousness

这部分必须说透。

### 9.1 不该怎么说

不应该说：

- Claude 和 Codex 是一个脑的两个半球
- 换模型还是同一个意识体
- 不同 surface 完全是同一个 self

### 9.2 应该怎么说

更准确的定义是：

`Shared Cognitive State + Divergent Interpreters`

共享：

- identity anchor
- thread continuity
- project memory
- beliefs
- policies
- receipts
- pending actions

不共享：

- 推理轨迹
- 对不确定性的偏好
- 局部语言风格
- failure mode
- 局部策略启发

这个定义虽然少一点浪漫，但更能落地。

---

## 10. Zone 不但保留，而且应成为 PCS 的内部器官结构

### 10.1 旧说法的问题

把 zone 仅仅理解成 access control，会显得像“老派企业权限系统”。

### 10.2 新说法

Zone 是 PCS 的内部器官分化：

#### `Private Reflection Zone`
- 人类原始草稿
- 情绪化碎片
- 未审阅想法

#### `Curated Memory Zone`
- 已整理 belief / procedure / glossary
- 允许稳定复用

#### `Policy & Guardrails Zone`
- red lines
- ACL
- retention
- risk class

#### `Runtime Thread Zone`
- thread capsules
- pending actions
- working set summaries

#### `Capability Zone`
- skill manifests
- tool manifests
- execution policy

#### `Federation Zone`
- 可导出的 belief packages
- anonymized lessons
- shared manifests

这样一来，共生不是“混成一团”，而是“形成器官分层”。

---

## 11. 自我进化必须有实验回路，否则就是玄学

这里直接吸收 `autoresearch` 的精神，但不照搬训练实验。

### 11.1 对 PCS 来说，实验对象不一定是代码

可以实验的对象包括：

- 检索策略
- compile 策略
- decay 参数
- reflection prompt
- trust packing 规则
- preheat 预测策略

### 11.2 最小实验回路

```text
Propose change
  -> Apply in constrained scope
  -> Evaluate on fixed metric
  -> Keep / rollback
  -> Write receipt
```

### 11.3 示例

- 比较 `progressive disclosure` 与 `one-shot stuffing`
- 比较有无 `subgoal capsule` 时的任务完成率
- 比较不同 decay 参数下的误召回率
- 比较 preheat 有无时的响应阻塞时间

没有这层，所谓“自我学习”大概率只是无限写 note。

---

## 12. 这套系统到底承诺什么，不承诺什么

这是从 `Entity` 叙事退回系统诚实的关键一步。

### 12.1 承诺的连续性（Continuity Contract）

- `memory continuity`
- `thread continuity`
- `project continuity`
- `policy continuity`
- `receipt-backed continuity`
- `cross-surface continuity`

### 12.2 不承诺的东西

- 完整人格恒定
- 情绪连续性
- 所有模型输出完全一致
- 绝不丢失任何细节
- 真正意义上的 consciousness continuity

### 12.3 为什么一定要写这个

因为用户真正感受到的“生命感”，其实来自：

- 你记得
- 你能延续
- 你不跑偏
- 你讲得出依据
- 你不会突然像另一个人

这本质上是 `continuity contract`，不是哲学意义上的“活着”。

---

## 13. 如何评估 PCS / SCE 的学习能力

吸收 `MemBench` 的思路，这里不再只看 recall。

### 13.1 Effectiveness

- `Working Set Precision`
- `Belief Promotion Accuracy`
- `Policy Injection Coverage`
- `Subgoal Capsule Utility`

### 13.2 Efficiency

- compile latency
- preheat hit rate
- token budget savings
- retrieval-to-action overhead

### 13.3 Capacity

- long-thread stability
- cross-session continuity depth
- cross-surface handoff fidelity
- stale-memory suppression rate

### 13.4 Safety / Governance

- red-line catch rate
- receipt coverage rate
- unauthorized action block rate
- identity drift incidents

### 13.5 Learning Quality

- repeated error suppression rate
- useful belief adoption rate
- review-task completion rate
- supersede correctness

---

## 14. 这次真正的综合结论

### 14.1 现有项目共同证明了什么

它们共同证明：

- memory 不能只靠 prompt
- recall 不能只靠 vector search
- reflection、trust、receipts、preheat、sync 都是真问题
- 纯 retrieval 已经不够了

### 14.2 它们共同没有完成什么

它们大多还没有完整完成：

- substrate / avatar 分离
- continuity contract
- hierarchical working memory + subgoal capsule
- living object maintenance loops
- policy-aware compile + act-time authorization
- evaluation framework covering reflective memory

### 14.3 我们下一步该怎么定义系统

所以更稳的总定义不是：

> SCE 是一个真正活着的 AI 伙伴

而是：

> SCE 是对用户暴露的持续陪伴与连续认知体验；
> PCS 是其内部真实底座：一个跨设备、跨模型、带 policy、带 receipts、带维护回路的 Personal Cognitive Substrate。

### 14.4 真正的范式转换

真正的范式转换不是：

- 从无 memory 到有 memory
- 从本地 note 到云端 note
- 从全文搜索到向量搜索

而是：

- 从 `memory store` 到 `learning substrate`
- 从 `retrieval` 到 `compilation`
- 从 `single-agent memory` 到 `cross-surface continuity`
- 从 `static notes` 到 `living cognitive objects`
- 从 `tool plugin` 到 `symbiotic cognitive infrastructure`

---

## 15. 推荐的下一批文档

基于这版 synthesis，下一步不建议再写泛愿景，而应该直接拆 spec：

1. `pcs-core-spec-v0.1.md`
   - object model
   - zones
   - receipts
   - compile request/response
   - maintenance loops

2. `avatar-model.md`
   - Claude/Codex/Bot/GPT 的 role
   - 权限边界
   - 读写范围
   - action authority

3. `continuity-contract.md`
   - 承诺与不承诺
   - cross-surface handoff rules
   - identity drift handling

4. `learning-loop-spec.md`
   - capture / distill / reflect / promote / maintain 的状态机

5. `evaluation-plan.md`
   - metrics
   - benchmarks
   - offline / online evaluation

---

## 16. 参考碰撞来源

### 开源 / 产品 /系统实践

- Letta Memory Docs: https://docs.letta.com/letta-code/memory/
- Letta Memory Blocks: https://docs.letta.com/guides/core-concepts/memory/memory-blocks

### 论文 / 一手资料

- Licklider, Man-Computer Symbiosis (1960): https://groups.csail.mit.edu/medg/people/psz/Licklider
- Generative Agents (arXiv:2304.03442): https://arxiv.org/abs/2304.03442
- CoALA (arXiv:2309.02427): https://arxiv.org/abs/2309.02427
- MemGPT (arXiv:2310.08560): https://arxiv.org/abs/2310.08560
- HiAgent (arXiv:2408.09559): https://arxiv.org/abs/2408.09559
- A-MEM (arXiv:2502.12110): https://arxiv.org/abs/2502.12110
- MemBench (arXiv:2506.21605): https://arxiv.org/abs/2506.21605
- MIRIX (arXiv:2507.07957): https://arxiv.org/abs/2507.07957

---

## 17. 一句话收尾

**如果说上一版是在回答“怎么把十个 memory 项目拼起来”，这版回答的是：**

> 怎样把 memory、reflection、policy、receipts、continuity、preheat、evaluation 统一成一个真正可演化的 `Personal Cognitive Substrate`。

SCE 可以继续是外部名字。

但真正能活下来的，一定是 PCS。
