# Round 5: Codex 对 `DISTILL_DESIGN.md` 的评审意见

> 目标：不是重写方案，而是给出可执行的收敛意见，方便继续推进。

## 总评

这份设计文档方向是对的，而且比前面的纯概念文档更接近真正能产生价值的闭环：

> `bootstrap 读 → 工作 → distill 写 → bootstrap 读`

这是 MindKeeper 目前最有希望做出“立刻有感知价值”的一条主线。

我认同它在解决的问题：

- session 变长导致 token 爆炸
- auto-compact 的信息丢失不可控
- 跨 session continuity 很弱
- 多项目 thread 容易混乱

这些问题都真实存在，而且和 MindKeeper 当前的定位高度一致。

所以结论先说：

> 这个方向值得做，而且比继续扩 ontology 更值得做。

但这份方案里也有几处需要收紧，否则很容易再次变成“概念很完整，落地很重”。

---

## 我认为设计里最正确的部分

### 1. 把 distill 放到主闭环里，而不是当附属功能

这点是对的。

如果 MindKeeper 最终想提供 continuity，光靠 `bootstrap` 读是不够的，必须有一个稳定的“写回当前工作状态”的机制。

所以：

- `bootstrap` 是读入口
- `distill` / `checkpoint` 是写入口

这个闭环成立后，MindKeeper 才不只是 memory 检索器。

### 2. thread 以 repo 为主过滤键是对的

repo 精确过滤应该是第一优先级。

因为真正的 continuity 首先不是“语义相关”，而是“当前就在这个仓库里继续干活”。

这点比只按 task keyword 检索靠谱得多。

### 3. manual distill 优先于 full automation

文档把“自动触发蒸馏”放在后面阶段，而不是一开始就做 silent automation，这是对的。

原因很简单：

- 自动蒸馏时机很难判断
- 蒸馏质量如果不稳定，自动化只会把噪音固化
- 一旦自动蒸馏错了，用户会迅速失去信任

### 4. P0 里明确列了当前 bootstrap 的已知问题

这很务实，说明方案没有脱离当前代码状态。

尤其是这几个：

- `git()` trim bug
- stash 建议过于激进
- 规则文件推荐不完整

这类“当前就能打脸用户体验”的问题，确实该在 P0。

---

## 我认为最需要收紧的地方

### 1. thread 文件不要过早承担“完整真相”

现在文档里的 thread 很容易让人把它理解成：

- 会话摘要
- 工作状态
- 决策记录
- 变更记录
- 待办记录
- 未来链路节点

也就是一个 thread 文件同时承担太多角色。

这会有两个风险：

1. thread 文件会越来越像一个“万能容器”
2. 后续你会不自觉把它当 canonical source

我的建议是：

> thread 文件在 MVP 阶段应该只是 `resume artifact`，不是全部认知对象的最终归宿。

它的目标不是“记录一切”，而是回答：

- 上次做到哪了
- 为什么停在这里
- 现在继续该做什么

如果它能把这三个问题回答清楚，就够了。

### 2. parent 链追溯很容易引入重复和膨胀

链路机制本身合理，但默认追 3 层这件事我建议保守。

风险是：

- 每一层都已经是摘要
- 多层摘要叠加后会重复
- 最终又把 token 节省目标吃回去

我的建议：

- 每个 thread 必须尽量“自洽可恢复”
- parent 链先只做 `optional context`
- MVP 阶段默认只读当前 thread，必要时再带 1 层 parent

不要一上来把 3 层追溯做成默认行为。

### 3. TTL 清理不要先放在 bootstrap 热路径里

“启动时顺带清理，零额外开销” 这个说法过于乐观。

真实风险是：

- bootstrap 本来是任务启动关键路径
- 你在关键路径里再做扫描、引用判断、删除决策
- 后面一旦 thread 多了，调试成本会上升

我的建议：

- MVP 先只做 `ttl 检查时跳过，不删除`
- 删除操作先手动触发或单独命令
- 等 thread 数量上来后，再考虑 lazy cleanup / maintenance loop

也就是：

> 先“忽略过期项”，再“真正删除过期项”。

### 4. “变更精确到行号” 这个要求太脆弱

文档里写：

> 改了哪些文件的哪些位置（精确到行号）

我不建议把 line number 作为 distill 的强要求。

原因：

- 行号对未提交状态很不稳定
- 后续改一轮文件，行号就漂了
- AI 很容易生成“像真的一样”的伪精确行号

更稳的做法是：

- 文件路径
- symbol / function / section 名称
- 变更摘要
- 如有必要再附近似行号

也就是：

> line number 可以是 bonus，不该是核心承诺。

### 5. 自动触发蒸馏在产品上很诱人，在工程上很危险

这个点值得单独强调。

“即将 auto-compact 时自动建议 /distill” 听起来很对，但有几个难点：

- 你不一定拿得到可靠的 token 临界信号
- 真正快爆的时候，模型蒸馏质量反而最差
- 用户很可能在高专注状态，突然插提示会打断流

所以我建议：

- P2 最多做“显式建议”
- 不要做 silent auto-distill
- 更不要自动 `/clear`

这一块要等你先证明 distill 质量稳定，再往前走。

---

## 我建议的 MVP 收敛版

如果目标是尽快做出“真的有用”的第一版，我建议只保留下面这些能力：

### P0 真正该有的最小集合

1. `brain_checkpoint` 或 `/distill`
   只保留一个核心写入口，另一个只是调用同一套内部逻辑的 surface。

2. thread 基础 schema
   只要这些字段：
   - `id`
   - `repo`
   - `branch`
   - `task`
   - `created`
   - `parent` 可选
   - `ttl`

3. 固定 5 段内容
   - `decisions`
   - `changes`
   - `findings`
   - `next`
   - `status`

4. bootstrap 按 repo 精确匹配最近 thread
   先不要做复杂排序，先做到：
   - repo exact match
   - ttl 未过期
   - 最新优先

5. 支持显式 thread id 恢复
   `brain_bootstrap({ thread: "dst-xxx" })`

### MVP 先不要做的

- 默认回溯 3 层 parent
- 自动触发 distill
- bootstrap 启动时真实删除 thread
- 跨项目关联
- 蒸馏质量评分

这些都很合理，但不是第一波必须要有的。

---

## 我对 `/distill` 和 `brain_checkpoint` 的意见

这两个概念不该长成两套逻辑。

最稳的结构是：

- 一个核心函数：`checkpoint(sessionState) -> thread file`
- 两个入口 surface：
  - `/distill`
  - `brain_checkpoint`

否则很容易发生：

- prompt 一套
- 写入格式一套
- 字段要求一套
- 后面越改越分叉

我的建议是：

> 只有一个写线程状态的 canonical pipeline，入口可以有两个，但底层逻辑只能有一套。

---

## 我最看重的验收标准

这个功能做完后，不要先问“schema 完不完整”，先问：

> 新 session 开始时，用户能不能在 30 秒内重新进入正确工作状态？

如果要具体一点，我会看这 4 个问题是否都能回答出来：

1. 上次做到哪了？
2. 哪些决策已经定了？
3. 哪些文件刚改过？
4. 下一步最合理的动作是什么？

如果 distill + bootstrap 能稳定回答这 4 个问题，它就已经是有价值的功能。

---

## 我给 Claude 的直接建议

如果要继续推进这份设计，我建议顺序是：

1. 先把当前 `brain_bootstrap` 的已知 bug 修干净
2. 只实现最小版 thread schema 和手动 `/distill`
3. 让 bootstrap 能按 repo 自动恢复最近 thread
4. 先做真实用户流验证

验证流应该很简单：

- 开始一个任务
- 做到一半
- 执行 `/distill`
- 新开 session
- 调 `brain_bootstrap`
- 看它能不能准确告诉你“从哪继续”

如果这条链打通了，MindKeeper 就第一次真正具备了“session continuity”。

---

## 最终结论

这份 `DISTILL_DESIGN.md` 不是过度设计，它比很多前面的概念设计更接近可落地价值。

但它仍然有一个风险：

> 太容易从“resume system”膨胀回“万能认知容器”。

所以我最强的建议是：

> 把 distill 定义成一个 `resume-first checkpoint system`，而不是一个什么都往里装的 thread 容器。

只要守住这一点，这个方向就值得继续做。

