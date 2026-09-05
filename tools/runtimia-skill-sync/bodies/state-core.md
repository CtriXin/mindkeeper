# state-core（任务状态底座）

runtimia 的每次 rerun 都是**全新会话**：没有上一轮的对话记忆，workdir 也是新的空目录。
唯一能跨轮活下来的，是你主动写进 state-core 的状态。**不写，下一轮就得从头重来。**

state-core 是数据 + 契约 + 校验，不是 agent、不是 workflow。它只回答一个问题：
**这个任务此刻走到哪了、下一步该干什么。**

## root 就是目标仓根目录

```
CLI=/Users/xin/.local/share/ctrixin-runtime-v2/state-core/src/cli.py
ROOT=<implementation_root>        # 你这次要改的那个仓的根目录
```

> ⚠️ **只认这个路径。** `/Users/xin/auto-skills/CtriXin-repo/state-core` 是滞后副本，
> 实测停在 PR #70，**缺 `record-decision` 和 `gate-blockers`**（canonical 在 PR #89）。
> 走错副本，你会撞上「`record-decision` 命令不存在」——那正是 2026-09-02 事故里被修掉的那堵墙。

状态落在 `$ROOT/.state/<task-id>/`：`task-state.json`（当前状态）+ `events.jsonl`（追加事件，带 seq）。

**为什么是目标仓，不是某个集中目录**：目标仓是持久的，per-task workdir 是临时的。
状态绑在目标仓上，跨轮就天然活下来——不需要靠 issue 正文写死绝对路径来找回上一轮。

`$ROOT/.state/`（state-core 拥有）与 `$ROOT/.mommy/`（mommy 拥有）是**同级、不同 owner 的兄弟目录**，
不是包含关系。按 one-terminal-writer 原则：**谁都不许写对方的目录。**

如果 `implementation_root` 还没确定（比如刚接到任务、还没定位到仓），先定位再建档；
**不要**随便挑一个目录建档，那等于把状态写丢。

## 开工第一件事：先 hydrate，别急着干

```bash
python3 $CLI hydrate --task-id <ISSUE-KEY> --root $ROOT
```

- **有输出** → 这是 rerun。读 `phase` / `slots` / `blockers` / `next_action`，从 `next_action` 接着干，
  不要重做已完成的步骤。再看 `$ROOT/.state/<task-id>/events.jsonl` 拿到完整历史。
- **报 no task dir** → 这是第一轮，先建档：

```bash
python3 $CLI new --task-id <ISSUE-KEY> --intent "<一句话说清要做什么>" --kind <bug|feature|chore|review|decision|experiment|explore|record|requirement> --root $ROOT
```

`--kind` 是严格枚举，写错会被拒（注意是 `bug` 不是 `bugfix`）。

## 干活途中：每个不可重来的步骤都要 emit

```bash
python3 $CLI emit --task-id <ISSUE-KEY> --event <事件名> --status <ok|warn|fail|blocked> \
  --summary "<一句话>" --actor <你的模型名> --root $ROOT
```

至少在这些时刻 emit：建了 worktree、改了文件、跑了验证、推了分支、发了版。
判断标准很简单：**如果下一轮不知道这件事就会重做或做错，就必须 emit。**

## 卡住 / 推进 / 交接

```bash
python3 $CLI add-blocker    --task-id <K> --root $ROOT ...   # 卡住了，别沉默重试
python3 $CLI resolve-blocker --task-id <K> --root $ROOT ...
python3 $CLI advance        --task-id <K> --phase <阶段> --root $ROOT
python3 $CLI record-handoff --task-id <K> --hard-stop "<停在哪一步、为什么停>" --to <接手方> \
  --brief-ref <交接文档路径> --at <+08 时间> --by <你的模型名> --root $ROOT
python3 $CLI closeout       --task-id <K> --root $ROOT
```

## 提问不要阻塞

run 是一次性会话，**不能停下来等人回答**。所以：

- **能继续 → 报告后继续**：把问题写进 issue comment，自己带着合理默认往下走，
  在 comment 里写清你假设了什么。不要改状态、不要停。
- **真卡死 → 先 `add-blocker`，再在 comment 里一次写全**
  `root_cause / owner / next_action / stage`。
  **一次把所有独立缺失项汇总**，不要修一个冒一个、让人来回答三轮。

不要用 `in_review` 表示"我卡住了要问"——那个状态的语义是"工作已交付待复核"，
而且它会 finalize 掉这次 run。

## 硬规则

- **root = implementation_root**。写进任务 workdir 等于没写——那个目录每次 rerun 都换。
- emit 之前必须先 new 建档；state-core 拒绝替未建档的任务造目录，这是有意的。
- 不写 `.mommy/`。那是 mommy 的目录，state-core 只管 `.state/`。
- 状态是给下一轮的自己看的，不是给人看的报告。写清"做完了什么"和"下一步是什么"，不要写心得。
- state-core 只记状态。证据文件、产出物照旧放 `artifact_root`，在 emit 的 `--summary` 里带上路径。
