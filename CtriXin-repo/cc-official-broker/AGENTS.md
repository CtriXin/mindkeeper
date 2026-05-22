# AGENTS.md

## Scope

本目录 `cc-official-broker/` 是单用户、双设备的 `official cc remote broker` 实验目录。
目标：

- 以服务器上的官方 `Claude Code` 为固定 runtime
- 以本地 `MMS/cc` 为使用入口
- 通过 `Broker + Local Runner` 让远端 session 使用本地工具能力
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
- 当前阶段先做项目隔离、文档和最小骨架，不碰其他方案目录。

## Current Baseline

- personal host: `82.156.121.141`
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
