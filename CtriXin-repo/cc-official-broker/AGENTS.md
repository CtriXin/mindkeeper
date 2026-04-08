# AGENTS.md

## Scope

本目录 `cc-official-broker/` 是单用户、双设备的 `official cc native gateway` 主线目录。
目标：

- 以本地 official `Claude Code CLI` 作为主要入口
- 以自建 gateway / broker 接到服务器上的官方 `Claude Code` runtime pool
- 以服务器作为真实 `OAuth / runtime / egress` 真相源
- 本地工具层默认最小化，优先复用 official CLI 自身能力
- 严格隔离 `mac/macmini` 与 `company/personal` workspace

## Release Note Handoff Rule

每次有已落地改动后，都要把本轮摘要追加到：

- `./.ai/agent-release-notes.md`

要求：
- 只追加，不覆盖
- 默认不进 git（见 `.gitignore`）
- 至少包含：时间、Agent、改动范围、摘要、可复用 bullets、验证结果

## Working Rules

- 始终用中文简体回复，technical terms 保持 English。
- 当前边界只允许：
  - 单用户
  - 双设备
  - 不做多人共享
- 默认优先保持：
  - `mac` / `macmini` 隔离
  - `company` / `personal` 隔离
  - session 不串味
- 当前主 runtime 固定是服务器上的官方 `cc`。
- 当前主线固定为：`local official Claude Code CLI -> self-hosted gateway -> server official runtime pool`
- 不再把第三方 relay 当长期生产主路径。
- 所有 agent / Hive / new session 一律共享并维护：
  - `./.ai/coord/`
  - `./.ai/iterations/`
- 新 agent 开工前必须先读：
  - `./.ai/coord/LATEST.md`
  - `./.ai/coord/TASK_BOARD.md`
  - `./.ai/coord/BRANCHES_WORKTREES.md`
  - `./.ai/iterations/<latest>/DISTILL_RECOVERY.md`
- Hive / discuss / worker 运行后，若产生 run id / handoff / branch/worktree 变化，必须回写：
  - `./.ai/coord/HIVE_RUNS.md`
  - `./.ai/coord/handoffs/`
  - `./.ai/coord/BRANCHES_WORKTREES.md`
- 切分支、切 worktree、切阶段、丢 session 恢复都必须落地真实文档，不靠聊天复制粘贴。

## Current Baseline

- personal host: `23.95.30.199`
- server entry: `cc-static`
- official `Claude Code`: `2.1.92`
- egress lock: `168.158.184.72`
- auth: first-party `claude.ai`

## First Build Priority

第一阶段只做四件事：

1. 定义隔离主键：`device_id/workspace_id/session_id`
2. 固化 `Broker + Local Runner` 最小接口
3. 定义本地入口如何把请求正确路由到对应设备/workspace
4. 做最小 skeleton，不影响现有主线和其他实验目录

@RTK.md
