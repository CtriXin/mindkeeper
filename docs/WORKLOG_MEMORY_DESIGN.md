# Worklog Memory Design

> 目标：让 MindKeeper 不只会 `distill`，还会持续记录工作片段、允许 LLM 自主沉淀，并在需要时同步到 `issue-tracking`，同时不和 `gbrain-memory` 冲突。

> 结论先行：
> `fragment/worklog`、`LLM 自主总结`、`distill/checkpoint` 不是冲突关系，而是三层不同粒度的记忆。
> 正确关系是：
> `fragment` 负责累计事实，
> `reflection` 负责局部总结，
> `distill` 负责阶段压缩。

---

## 1. 要解决的问题

当前只有 `brain_checkpoint` / `distill` 时，会遇到 4 个问题：

1. `distill` 频率不够高
   - 很多工作片段还没到“值得 checkpoint”的阶段，但如果不记，换 session 就会丢。
2. `distill` 天生是压缩
   - 它适合保留高密度结论，不适合保存每一段 debug / 探索 / 尝试。
3. LLM 的工作过程没有 durable 落点
   - 开发、探索、debug、修复做完一段后，没有“这一段到底做了什么”的稳定承载层。
4. `issue-tracking` 不是实时状态机
   - 它适合 human-readable archive / evidence，不适合承接每一步内部执行态。

所以设计目标不是“让 distill 更大”，而是补齐：

- 小步留痕
- 局部总结
- 阶段压缩
- 外部归档

---

## 2. 五层模型

### 2.1 Live Context

这是当前对话窗口里的即时上下文。

- 来源：msg / tool output / 当前思考
- 特征：易失、可随时 `clear`
- 作用：支持当下推理

这一层不可靠，不能当长期记忆。

### 2.2 Fragment / Worklog

这是最小 durable 单元，记录“刚才这一段做了什么”。

- 例子：
  - 定位到 401 根因
  - 发现 token cache 没清
  - 补了 auth.ts 的 reset 逻辑
  - 本地 build 通过
- 特征：
  - append-only
  - 粒度小
  - 尽量事实化
- 作用：
  - 防止 session 中途 clear 后丢失细节
  - 给后续 `reflection` / `distill` 提供原材料

### 2.3 Reflection / Auto Summary

这是 LLM 对最近 fragments 的局部总结，不直接替代 fragments。

- 来源：
  - 手动触发
  - LLM 自主触发
  - 阈值触发
- 特征：
  - 针对最近一段，不是整条任务链最终结论
  - 必须引用或绑定 source fragments
  - 不能覆盖原 fragment
- 作用：
  - 在 token 紧张时减少恢复成本
  - 给下一个 LLM 一个更高密度的“最近发生了什么”

### 2.4 Distill / Checkpoint

这是阶段性压缩快照。

- 单位：一个 `dst-*` thread snapshot
- 特征：
  - immutable
  - 高密度
  - 面向跨 session 恢复
- 作用：
  - 把一个阶段收成最小可恢复状态
  - 作为 `bootstrap` 的主恢复入口

### 2.5 Archive / Promotion

这一层不参与即时执行，只做外部沉淀。

- `issue-tracking`
  - 存 raw record、evidence、human-readable archive
- `recipe`
  - 存稳定可复用的 project / tool 经验
- `gbrain-memory`
  - 存长期用户偏好、稳定行为模式

---

## 3. 三者为什么不冲突

### Fragment 和 Distill 不冲突

- `fragment` 记录过程
- `distill` 压缩阶段

如果只有 `distill`，中间很多内容会丢。
如果只有 `fragment`，恢复成本会越来越高。

所以关系是：

`fragment -> reflection -> distill`

不是互斥，而是逐层 compaction。

### LLM 自主总结 和 Distill 不冲突

`LLM 自主总结` 应该写成 `reflection`，不是直接改 `distill`。

原因：

- `reflection` 是局部、可多次追加的
- `distill` 是阶段、不可随意改写的

如果把 LLM 自主总结直接写成 `distill`，会让 checkpoint 失去“阶段边界”。

### MindKeeper 和 issue-tracking 不冲突

- MindKeeper 是执行态 memory substrate
- issue-tracking 是 archive / evidence sink

前者是运行时连续性，后者是对外留档。

### MindKeeper 和 gbrain-memory 不冲突

- MindKeeper 记 task continuity
- gbrain-memory 记 stable profile / preference

MindKeeper 的 fragment / distill 可以成为 gbrain-memory 的原材料之一，但不应直接等价。

---

## 4. 统一对象模型

### 4.1 Thread Chain

每条任务链不是单个 `dst-*`，而是一条 `root` 链。

```text
root = dst-0415-abcd12

dst-0415-abcd12   # 第一阶段 snapshot
  └── dst-0415-efgh34
        └── dst-0416-ijkl56
```

规则：

- 每个 checkpoint 都有自己的 `id`
- 同一任务链共享一个 `root`
- `parent` 表示上一个 snapshot
- `root` 表示整条链的稳定身份

### 4.2 Fragment Record

建议最终 schema：

```ts
interface FragmentRecord {
  id: string;
  rootId: string;
  threadId: string;
  repo: string;
  task: string;
  branch?: string;
  cli?: string;
  model?: string;
  kind: 'dev' | 'explore' | 'debug' | 'fix' | 'verify' | 'note' | 'reflect';
  source: 'human' | 'agent' | 'auto';
  created: string;
  summary: string;
  decisions: string[];
  changes: string[];
  findings: string[];
  next: string[];
  issueRef?: string;
  sourceFragmentIds?: string[];
}
```

当前已实现的是精简子集：

- `rootId`
- `threadId`
- `kind`
- `summary`
- `decisions / changes / findings / next`

### 4.3 Reflection Record

最终不需要单独文件格式，可以先作为特殊 `fragment(kind=reflect)`：

- `source = auto`
- `sourceFragmentIds = [...]`

这样存储层更简单，恢复逻辑也统一。

### 4.4 Distill Snapshot

保持当前 `dst-*` 文件格式，但补充语义：

- `id`：当前 snapshot
- `root`：整条链
- `parent`：上一个 snapshot

它不是工作日志，而是阶段 capsule。

---

## 5. 存储布局

建议完整布局：

```text
~/.sce/
├── threads/
│   └── dst-*.md
├── fragments/
│   └── <root>.jsonl
├── boards/
├── brain/
└── issue-links/
    └── <root>.json
```

说明：

- `threads/`
  - immutable checkpoints
- `fragments/<root>.jsonl`
  - append-only worklog
- `issue-links/<root>.json`
  - 记录这条任务链映射到哪个 `issue slug`

---

## 6. 写入策略

### 6.1 什么时候写 fragment

下列时机都应该允许写 `fragment`：

- 做完一段 debug
- 确认一个根因
- 改完一组文件
- 跑完一轮验证
- 发现一个重要坑点
- 准备 `clear` 但还不想 `distill`
- 从一个子任务切到另一个子任务前

标准不是“任务完成”，而是“这段内容值得下次恢复时看到”。

### 6.2 什么时候写 reflection

建议触发条件：

- 最近新增 fragments >= 3 条
- 最近一次 fragment 后经过一段 idle 时间
- 检测到 token 压力上升
- 用户显式要求“总结一下刚才这段”

### 6.3 什么时候写 distill

建议触发条件：

- 一个阶段结束
- 即将 clear / compact / 切 session
- 子任务完成，准备进入下一阶段
- token 接近阈值

原则：

- `fragment` 高频
- `reflection` 中频
- `distill` 低频

---

## 7. LLM 自主沉淀的设计约束

用户提出的关键诉求是：

> 不仅仅 distill 能存储，LLM 自己也应该能把一些内容总结沉淀下来。

这可以做，但必须守 4 条规则：

1. **append-only**
   - 只能追加，不能静默改旧记录。
2. **事实先于总结**
   - 先有 fragment，再有 reflection。
3. **总结不能替代原始片段**
   - reflection 只是高密度视图，不是 source of truth。
4. **自动沉淀要可审计**
   - 每条 auto reflection 必须带 `sourceFragmentIds`。

这样做之后，LLM 自主沉淀不会和 `distill` 冲突，反而会给 `distill` 提供更好的素材。

---

## 8. 恢复算法

`brain_bootstrap` 的完整恢复顺序应该是：

1. 找主 snapshot
   - 按 `repo + task + branch + recency`
2. 取当前 `root`
3. 读取最近 fragments
   - 默认最近 3-5 条
4. 如果存在 recent reflections
   - 优先展示 1-2 条 reflection
   - 再附最近 1-2 条关键 fragment
5. 显示 snapshot 中的
   - `当前状态`
   - `待续`
   - `关键决策`
6. 如果有 `issueRef`
   - 显示 issue slug / archive 路径

### 恢复优先级

恢复时不要把全部历史塞回 prompt。

建议 token 预算：

- 主 snapshot：必带
- 最近 reflections：优先
- 最近 fragments：少量附带
- 更老的 fragments：按需展开

---

## 9. issue-tracking 同步层

### 9.1 为什么不能直接自动写

MindKeeper 只知道：

- `repo`
- `task`
- `thread/root`

但它默认不知道：

- 这条链该写到哪个 `issue slug`

所以自动同步必须先解决映射问题。

### 9.2 正确做法

给任务链增加显式映射：

```json
{
  "rootId": "dst-0415-abcd12",
  "issue": "mindkeeper-fragment-memory-20260415",
  "project": "mindkeeper"
}
```

### 9.3 issue 中的固定区块

不要把 fragments 散写到任意 section，固定一个区块：

```markdown
## Mindkeeper Thread
- root: dst-0415-abcd12
- latest snapshot: dst-0415-efgh34

## Mindkeeper Fragments
- 2026-04-15 20:10 [debug] 定位 401 根因 → 补请求链日志
- 2026-04-15 20:18 [fix] 补 token 失效后的 cache reset → 回归登录态恢复

## Mindkeeper Reflections
- 最近两段工作已经把 auth 失效链路厘清，后续主要是补验证和收口。
```

### 9.4 同步策略

不要每写一条 fragment 就立刻刷 issue。

推荐策略：

- `fragment`
  - 只写 MindKeeper 本地
- `reflection`
  - 可选增量同步到 issue
- `checkpoint`
  - 默认同步 issue digest

也就是：

`MindKeeper = 主状态层`
`issue-tracking = 对外摘要层`

当前实现状态：

- 已实现 `brain_link_issue`
  - 显式绑定 `root -> project / issue slug`
- 已实现 `brain_sync_issue`
  - 手动把当前 thread chain 的 digest 写入 `issue.md` 固定区块
- 需要设置环境变量 `MINDKEEPER_ISSUE_TRACKING_ROOT`
- 还没有实现：
  - `checkpoint` 自动触发 issue sync
  - `reflection` 自动增量同步

---

## 10. 和 gbrain-memory 的关系

最终数据流应该是：

```text
live work
  -> fragment
  -> reflection
  -> checkpoint
  -> issue digest
  -> stable pattern extraction
  -> gbrain-memory
```

只有“重复出现且稳定”的模式，才进入 `gbrain-memory`，例如：

- 用户长期偏好简洁回答
- 常用 `PM2 / Playwright / issue-tracking`
- 常做 `TypeScript / Node / MCP`
- 某种 debug workflow 多次重复成功

不应该进入 `gbrain-memory` 的内容：

- 某次临时 debug 过程
- 单次 task 的 next steps
- 具体 issue 的零散片段

---

## 11. 工具设计

建议最终工具集：

### 已实现

- `brain_bootstrap`
- `brain_checkpoint`
- `brain_fragment`
- `brain_link_issue`
- `brain_sync_issue`

### 下一步应实现

- `brain_reflect`
  - 总结最近 fragments，产出 `kind=reflect`
- `sourceFragmentIds`
  - 让 reflection 显式绑定来源 fragments

### 未来可实现

- `brain_promote_profile`
  - 从多条 fragments / reflections 提炼 stable preference 到 `gbrain-memory`

---

## 12. 推荐工作流

### 工作中

```text
开始做事
  -> 遇到一个完整小段
  -> brain_fragment
  -> 继续做
```

### 一段做完

```text
最近已经积累了几条 fragment
  -> brain_reflect
  -> 写一条 auto summary
```

### 阶段结束 / 准备 clear

```text
brain_checkpoint
  -> 新的 dst-* snapshot
  -> 保留同一条 root
```

### 需要 human archive

```text
brain_sync_issue
  -> 更新 issue.md 的 Mindkeeper 区块
```

---

## 13. 实施顺序

### P0 已完成

- `root` thread chain
- `brain_fragment`
- `bootstrap` 展示最近 fragments

### P1 已完成

- `brain_link_issue`
- `brain_sync_issue`
- `issue-links/<root>.json`
- issue 固定区块输出

### P2 建议随后做

- `brain_reflect`
- auto reflection 触发条件
- `sourceFragmentIds`

### P3 再做

- stable pattern 提炼进 `gbrain-memory`
- recipe / profile promotion

---

## 14. 最终判断

你担心的点是对的：

- 只靠 `distill`，确实会丢一部分中间态
- 让 LLM 自己沉淀一些内容，也是对的

但正确做法不是把这两者混成一个动作，而是让它们各司其职：

- `fragment`：保细节
- `reflection`：保局部总结
- `distill`：保阶段恢复
- `issue`：保外部归档
- `gbrain-memory`：保长期稳定模式

这才是完整设计。
