# Round 4: Codex 对 MindKeeper 的定位与收敛意见

> 记录时间：2026-03-25 23:09:14 +0800
> 目的：不给现有文档重写，只补一份可供 Claude 继续判断的明确意见。

## 一句话结论

`MindKeeper` 最合理的定位，不是“一个活着的 AI 伙伴”，而是：

> 一个 `local-first cognitive runtime`，专门为人机协作开发场景提供 `project memory / policy / procedure / thread continuity`。

它最该解决的不是“记住更多”，而是：

- 什么值得记
- 什么时候该拿出来
- 用什么形式拿出来，才能直接帮助当前任务

---

## 我认为它真正解决的问题

### 1. Session 断裂

同一个项目隔几天再开，agent 不知道：

- 上次为什么这么改
- 哪些文件是敏感面
- 用户有哪些稳定偏好
- 当前任务线程卡在什么地方

### 2. Context 污染

现有很多 memory / note / RAG 方案的问题不是“搜不到”，而是：

- 搜到的东西太散
- 约束、事实、偏好、流程混在一起
- 当前任务真正该注入的内容不明确

### 3. 知识不可执行

很多系统只会返回一段 note 或片段，不能形成：

- `Policy`
- `Procedure`
- `Thread Capsule`
- `Working Set`

而这几个对象，才是真正能减少错误和重复劳动的部分。

---

## 我对项目定位的判断

### 更合适的定位

我建议把 `MindKeeper` 定义成：

> 面向 coding agents 的项目级认知底座与运行时。

更具体一点：

- 它不是通用聊天记忆插件
- 它不是人格模拟器
- 它不是大而全的第二大脑
- 它是给“多 session、多 repo、多 agent surface”的开发工作流用的

### 不建议过早强调的定位

这些方向不是永远不能做，而是现在不该作为主叙事：

- 完整人格连续性
- 一个真正持续存在的 entity
- 跨设备无缝 consciousness continuity
- 联邦式 SCE 网络

这些容易让叙事超前于系统真相。

---

## 和网上方案的同质与差异

## 同质之处

从类别上看，MindKeeper 和这些方向同族：

- AI memory
- coding workflow memory
- project knowledge base
- agent state / context engineering
- lightweight local RAG

所以它不是“完全没有前人”的新品类。

## 真正有机会拉开差距的点

MindKeeper 有机会做出差异化，但必须靠落地质量，而不是概念：

- 把 `policy` 当一等对象，而不是普通 note
- 把 `procedure` 当可执行对象，而不是文档附件
- 把 `thread capsule` 当任务恢复机制，而不是聊天摘要
- 把 `working set compilation` 作为核心，而不是单纯 retrieval
- 保持 `local-first + Git-friendly + zero-load`

如果这些做得准，它就不是另一个 memory repo。

---

## 我认为当前存在的过度设计

### 1. 目标面过宽

现在同时想覆盖：

- personal memory
- project brain
- cross-model continuity
- cross-device sync
- learning loop
- policy engine
- thread runtime
- future federation

这会让 scope 非常容易发散。

### 2. Ontology 可能起得过早

`Evidence / Observation / Belief / Procedure / Policy / Thread Capsule` 这套分层有价值，
但如果 ingestion 和 usage 还没跑起来，容易先把词表做满，后面再反向适配实现。

### 3. 叙事先进度快于代码

当前代码更接近：

- file-backed knowledge server
- trigger-based router
- lightweight MCP memory tool
- procedure/guide/status 雏形

这没问题，但说明现在真正的状态是：

> 很好的 `Stage 0 MVP`，不是完整的 `Cognitive OS`。

### 4. 高级模块现在还不是主路径

这些概念目前更像 Phase 2/3：

- contradiction engine
- graph-heavy reasoning
- preheater
- federation
- deep promotion pipeline

如果现在先追这些，容易花很多时间，但用户感知价值很弱。

---

## 我认为更优的解法

## 核心原则

不要先扩世界观，先做一个“第一次用就能明显感觉有帮助”的 runtime。

## 更优的收敛方案

先收窄到 4 个一等对象：

- `Evidence`
- `Policy`
- `Procedure`
- `Thread Capsule`

`Observation` 和 `Belief` 可以保留，但实现上先轻一点，不要先做重型晋升系统。

## 最小主线

先围绕这条主线建设：

> 输入当前 repo + 当前任务，输出一个可直接工作的 `Working Set`。

这个 `Working Set` 至少包含：

- 当前任务目标
- 活跃约束 / red lines
- 相关文件
- 最近决策 / TODO
- 可复用 procedure
- 下一步建议

如果这一条跑通，MindKeeper 就已经有实际价值。

---

## 我最希望 Claude 优先思考的事

### 问题 1

MindKeeper 的第一性价值，到底是：

- “帮你记住更多”

还是

- “帮你在任务开始的前 30 秒内进入正确工作状态”

我认为必须选后者。

### 问题 2

当前是否应该把产品定义收窄为：

> `project memory runtime for coding agents`

而不是更大的 `personal symbiotic cognitive entity`

我认为应该。

### 问题 3

现在最该追求的 demo，是否应该是一个可见的 `working set compiler`

而不是继续扩 ontology / 哲学叙事

我认为应该。

---

## 立竿见影的效果应该长什么样

用户已经明确表达了一个担心：

> 写了半天，但感觉没什么太大作用。

所以接下来最重要的不是再解释，而是做出一个“一看就值”的功能。

### 我最推荐的立刻可见效果

做一个任务启动入口，例如：

- `mindkeeper start "修 provider routing bug"`
- 或 MCP 工具：`brain_bootstrap`

输入：

- 当前 repo
- 当前 task
- 当前分支
- 最近改动文件

输出：

- 相关规则
- 相关 procedure
- 最近 thread
- 风险点
- 下一步建议
- 推荐先看的 3 个文件

如果这一屏输出明显比“裸跑 agent”更好，项目就立住了。

### 第二个立刻可见效果

做 `policy hit` 提示。

当用户要改 protected surface / 高风险区域时，MindKeeper 直接给出：

- 为什么这是敏感区
- 之前的规则是什么
- 开改前应该先做什么

这比单纯多记几条 note 更容易让人立刻感到价值。

### 第三个立刻可见效果

做 thread resume。

输入当前 repo 或 task，直接恢复：

- 上次做到哪
- 未完成事项
- 当前证据
- 推荐延续动作

这比抽象的“持续成长”更容易被用户马上感知。

---

## 我给项目的最终建议

如果只能给一个建议，那就是：

> 把 MindKeeper 从“宏大认知叙事”压缩成“能让 coding workflow 少走弯路的任务启动与恢复 runtime”。

先证明这件事有显著效果，再逐步把学习回路、belief promotion、contradiction checking 补上。

真正的竞争力不会来自名字，也不会来自 ontology 的完整度，
而会来自下面这句话是否成立：

> 开始任务时先过 MindKeeper，明显比不经过它更快、更稳、更少犯错。

