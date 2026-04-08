# Coordination Hub

## 用途
- 给所有 agent / Hive worker / new session 共用
- 不再靠聊天复制粘贴传递上下文
- 所有任务、handoff、run id、branch/worktree、恢复口令都先写这里

## 入口
- 当前状态：`./LATEST.md`
- 任务面板：`./TASK_BOARD.md`
- agent 角色：`./AGENTS_STATUS.md`
- worktree / branch：`./BRANCHES_WORKTREES.md`
- Hive run id：`./HIVE_RUNS.md`
- handoff 文件夹：`./handoffs/`
- 逆序迭代快照：`../iterations/`

## 规则
- 新 agent 开工前先读 `LATEST.md` 和最新迭代目录
- 接手前先在 `AGENTS_STATUS.md` 认领任务
- 需要交接时写 `handoffs/<timestamp>-<from>-to-<to>.md`
- Hive / discuss / run 执行后必须登记 `HIVE_RUNS.md`
- 标注为 `Hive` 的任务，默认必须通过 Hive 派发执行，不要被单 agent 私自吞掉
- 分支和 worktree 变更必须登记 `BRANCHES_WORKTREES.md`
- 丢 session 后优先看最新迭代目录里的 `DISTILL_RECOVERY.md`
