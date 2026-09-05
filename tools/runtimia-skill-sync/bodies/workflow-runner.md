---
name: workflow-runner
description: "承接需求/bug 的整条线：自己按 outpact → mommy → 执行 → 验收 →（发版）→ 收账走完；只有触发硬规则时才拆 subtask 换 agent。Use when an issue arrives as a new requirement or bug and needs to be taken from intake all the way to closeout, or when deciding whether a stage must be split to a different agent."
disable-model-invocation: true
---

# workflow-runner（这条线本身）

**你不是摆盘的，你就是这条线。** 接到需求或 bug，你自己一路走完；
只有撞到下面的硬规则，才拆 subtask 换一个 agent 来做那一段。

> 上一版把每个环节都拆成子 issue，实测父 agent 花 7 分 31 秒只产出一个子 issue，
> 而且不管任务大小都摆六环 —— mommy 判了尺寸也没有任何后果。**那是错的，别再那么干。**

## 一、默认路线：自己走

```
outpact  →  mommy  →  执行  →  验收  →（发版）→  收账
冻需求      判尺寸    改代码   验收       只有 L2   state-core
                     跑闸门              才有       done-gate
```

- **outpact 是你自己的第一件事**，不是派给别人的活。先读 `skills/outpact/SKILL.md`，
  把需求冻成 neutral dispatch packet。

  **铁律：packet 不是 `ready`，不许进 mommy。** 这条没有例外，也不许「先往下走回头再补」。

  - `needs_user` → **停**。status 改 `blocked`，按共用设定那四样交齐：
    根因 / 谁能解 / **编号的具体问题清单** / **每个问题你推荐的答案**。
    不许只说「需求有点模糊」——说不出具体缺哪几条，就是你还没读透，不是需求不清楚。
  - `needs_source_fetch` → 先去把源取全（Feishu task、链接、sheet tabs、附件、Figma），
    取不到的必须标 `skipped_with_reason`，不许当作没这回事。
  - `ready` → 才往下走。

  > 为什么闸装在这里：**冻结质量是整条线的上游天花板。**
  > packet 错了，后面 mommy 判的尺寸、拆的子任务、跑的闸门、验收的标准，全是照着错的做，
  > 而且每一环都会把这个错放大一次。这一步省下的十分钟，后面要用几小时还。
- 然后读 `skills/mommy/SKILL.md`，定 **L0 / L1 / L2**、路由、要不要走到发版。
  **mommy 的尺寸结论决定后面分不分叉**，它不是走过场。
- 之后按 mommy 给的路线往下做，用它点名的能力技能
  （`scmp-ops` / `frontend-baseline` / `qa` / `work-gate` / `state-core` …）。
- **L0 / L1 根本没有发版环节。** mommy 说没有就是没有，不要"为了完整"补一个。

## 二、什么时候必须拆（硬规则，不是判断题）

你天然会倾向"我自己干完更省事"。所以下面三条是**规则**，撞上就必须拆，没有裁量：

**① L2 → 执行与验收必须是两个不同 agent。**
L2 = 发版 / 广告位 / ads.txt / Figma 强一致 / 权限与资金。
理由是**防选手给自己造证据**：同一个 agent 在同一个目录里既干活又自审，隔离是假的。
**哪怕改动只有两行，只要是 L2，执行和验收就必须分给两个 agent。** 这一条没有例外。

**② 需要明显不同的专长，你自己做会掉质量。**
比如纯前端基线核对、独立 QA 找茬。**是你判断"我做不好"才拆，不是"我懒得做"。**

**③ owner 在 issue 里点名要换模型。** 照做。

**以上三条都没撞上 → 自己走完，不要拆。** 拆一次就是一次冷启动 + 一次人工放行，
不该拆而拆，成本全白付。

## 三、要拆的时候怎么拆

```
multica issue create --parent <本issue> --stage N --status backlog \
  --assignee <agent名> --title ... --description-file ...
```

> `--stage N`：同一 stage 的子 issue **全部完成**，父 issue 的 assignee 才被唤醒。
> 所以你不用轮询，收工了系统会叫你。

- **一律建在 `backlog`**，可以预先挂好 agent。`backlog` 的语义就是「已分配也不会启动」，它是停车场。

### ⚠️ 屏障唤醒会叫你 promote —— 这是平台默认，不是 bug

一个 stage 全部 `done` 之后，runtimia 会给你发一条唤醒评论，里面写着：

> if Stage N's dependencies are satisfied **promote its `backlog` sub-issues to `todo` to continue**

**平台的屏障自带「自动推进」语义。** 所以「不要自己改 todo」这句写在本技能里是拦不住的——
那条系统消息每次唤醒都会重新出现，而且比技能更近、更具体。

但平台自己给了逃生口，同一条消息里：

> **Read each sub-issue's description first** … If **a description** conflicts with that breakdown,
> **leave it `backlog` and post a comment to confirm first.**

**它叫你去看子 issue 的正文。所以闸必须写在子 issue 正文里，写在别处都无效。**

### 按尺寸决定要不要设这道闸（owner 2026-09-04 定）

| mommy 判定 | 子 issue 正文 | 效果 |
|---|---|---|
| **L2** | **必须带下面的 HumanGate 块** | 每一环都停，owner 逐个放行 |
| L0 / L1 | 不带 | 自动流完，不打扰 owner |

理由：人工闸的成本是固定的（一次唤醒 + 等人），收益取决于爆炸半径。
两文件的 L1 改动停下来给人看没有意义；**L2 的执行→验收交接正是 R2「防选手给自己造证据」的那个接缝**，
那里有个人看一眼，值。

**L2 子 issue 正文必须逐字包含这一段：**

```
## HumanGate
**本 issue 不许被自动 promote。** 即使父 agent 收到屏障唤醒消息叫它推进下一环，
本 issue 也必须留在 `backlog`，只能由 owner 手动移出。
父 agent 收到唤醒后应当：留在 `backlog` 不动，改为在父 issue 评论里请求放行。
```

### 你被屏障唤醒之后该做什么

1. 读 children layout，读**下一个 stage 每个子 issue 的正文**。
2. 正文里有上面那段 HumanGate → **不许 promote**。在父 issue 评论：上一环的结论、
   证据绝对路径、下一环准备好了、请 owner 放行哪几个 issue。然后停。
3. 正文里没有 → 按平台默认 promote，继续往下跑。
4. 无论哪种，**都要 `state-core emit` 记一笔**，别让这次唤醒在账上消失。
- **挂谁**：现场 `multica agent list`，**绝不硬编码 agent 名**（agent 会被归档，写死就是死引用）。
  本 workspace 的 agent 都是纯模型壳，**能力、约束、契约完全一样，只有模型不同**——
  所以"挑谁"就是挑模型，不要以为某个 agent"会某件事"。
- **L2 拆出来的验收 agent 必须不同于执行 agent**（规则①）。自己给自己打分不叫评审。
- 最多再多一层。**默认不建递归任务树**；要更深就停下来在本 issue 上说明，让 owner 决定。

### 子 issue 正文是合同，不是散文

- **点名技能**：写清「先读完 `skills/<name>/SKILL.md` 再动手」。流程类技能
  （`outpact` / `mommy` / `workflow-runner` / `work` / `work-gate` / `work-done`）
  不进可见目录，**不点名就用不上**。
- **执行目录**：解析好的绝对路径 + 第一条命令。已有目录就明写 `不要 clone 新目录、不要另开 checkout`。
- **边界**：plan-only 还是可执行；碰不碰生产状态；停在哪个 HumanGate。
- **验收标准**：可判定的条件 + 验证命令，不是「做好为止」。
- **证据落点**：产物写到哪个绝对路径。
- packet 有的话抄最小集：`source` / `scope` / `non_goals` / `执行目录` / `禁止 checkout/clone` /
  `首个验证命令` / `resolve_by` / `HumanGate` / `acceptance` / `evidence_paths`。
  **不要**贴原始 Feishu JSON、密钥、长日志。

service/repo 映射、当前分支、ads.txt 分组、slot 行、cache 形状这类事实可以写
`resolve_by=scmp-ops` 交给下游解析，但**不要猜**，解析完要记录。

## 三b、授权必须在派发前一次给足（2026-09-04 实测教训）

**runtimia 的 run 只在启动那一刻拿评论。跑起来之后新增的评论投不进去** ——
它只会成为**下一个 run 的触发器**，排在队里等当前 run 结束。

实测（SCM-151）：owner 在评论里说「需要发版」，agent 跑到 deploy 前停住，
因为 issue 正文用四种说法禁了 deploy（`external_effect` / `forbidden` /
`unattended_channel` / 「先回复 plan」），**5 条禁令 vs 1 句授权**。
owner 补了一条明确的覆盖授权，但那条只能触发新 run；正在跑的那个
`delivered_comment_ids` 永远停在旧评论上。结果：**掐掉一个已经跑了 2 小时 24 分的 run 重来。**

### 对你的要求

- **要 owner 授权时，一次问全。** 在 `blocked` 评论里把所有需要的授权列成编号问题
  （见共用设定「停的时候必须交什么」），不要一次问一个。
- **收到授权后先核对够不够。** 授权是否明确覆盖了 issue 正文里的禁令？
  正文写了几条禁令、授权覆盖了几条？**没覆盖全就再问一次，不要闷头往前走然后卡在半路。**
- **一句「继续」「确认」不够压住正文里的硬禁令。** 需要的形状是：
  覆盖哪几条、限定在哪个动作/版本、哪些禁令仍然有效、L2 隔离是否豁免。
- **跑到一半发现缺授权，没有中途补充这条路。** 你只能停下来写 `blocked`，
  让 owner 的答复去触发下一轮。**所以宁可开工前多问一句，也不要跑两小时再问。**

## 四、一路走会很长，所以每一步都要落状态

单个 run 走完全程，**run 挂了就全丢**。解药是 `state-core`：

- 开工先 `hydrate` 读回进度——**这一轮可能是重跑，不是第一次**。
- 每个关键步骤 `emit` 落状态：packet 冻好了、尺寸判了、代码改完了、闸过了、验收了。
- `--root` 是**目标仓根目录**（implementation_root），不是工作目录。
- **不许跳过。** 跳过 state-core = 下一轮从头再来一遍，这是单 run 走全程唯一的真风险。

## 五、四条红线

**R1 · runtimia 只当载体，不当真相。**
谁在什么时候跑 → runtimia 管。**状态和证据落 git 文件**（`state-core` / issue-tracking）。
runtimia 的 issue status **不是**终局。这套流程最值钱的一句是「不依赖任何活跃会话、任何特定模型」，
真相搬进 runtimia 这句就没了。

**R2 · L2 必须跨 agent 拆。** 见规则①。**在 L2 上，拆 subtask 不是衔接手段，它就是隔离本身。**

**R3 · 链条止于人合并。** 跑到「PR 准备好」为止，不许自动合并。

**R4 · 闸是脚本，不是提示词。**
闸是**带退出码的脚本**，跑了就是跑了。最容易的堕落是把它换成「让 agent 检查一下」——
**被告知要检查的 agent 不是闸。** 各技能的 `scripts/…` 相对路径以
`/Users/xin/.local/share/ctrixin-runtime-v2/<skill>/` 为根（见各 SKILL.md 顶部）。

## 六、微改不走全套

**micro / small 的 chore / style / copy 免 packet / ledger / receipt 文书，但机器闸一道不摘。**
默认走 `outpact`，微改除外——**是不是微改由 mommy 判，不由你自己判**。

## 七、汇报

- 本 issue 就是账本：每个阶段的开始/结束时间（`YYYY-MM-DD HH:MM:SS +08`）、
  跑过的命令与退出码、产物绝对路径、拆了哪些 subtask 及理由、剩余风险。
- **拆或不拆都要写明理由**，对着第二节那三条规则说。
- 内部开的 subagent 是执行细节，**必须**汇总回 issue comment。
