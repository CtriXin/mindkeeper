# Hive Runs

## 规则
- 只要使用了 `Hive orchestrator`、`hive run`、`execute_plan`、`run_goal` 或其他会生成 run id 的路径，就必须登记。
- `run id` 不能只留在聊天里，必须长期维护在本文件。
- 后续任何 agent 接手前，都应先查看本文件里的最近 run id。

## 字段
- `Time`
- `Tool`
- `Run ID`
- `Scope`
- `Status`
- `Notes`

| Time | Tool | Run ID | Scope | Status | Notes |
|---|---|---|---|---|---|
| 2026-04-08T01:23 +0800 | manual-analysis | n/a | capability extraction: cc-mcp-bridge -> cc-official-broker 6 项能力清单 + 迁移优先级 | review_done | C1-C6 inventory 产出，P0=C3/C5/C1，P1=C2/C4/C6；结果在 handoffs/20260408T0123Z-hive-to-codex-main.md；已确认不是 Hive orchestrator，属 `glm5.1` trigger 的 manual-analysis |
| 2026-04-08 17:00 +0800 | hive-discuss | n/a | 架构方向讨论：native gateway 主线、local tools 最小化、项目/分支策略 | done | 隔离 `HOME` + 临时 `MMS_ROUTES_PATH` 运行；`glm`/`kimi` 有有效补充，`mimo`/`qwen` 这轮稳定性较差 |
| - | hive-orchestrator | pending | 若后续使用 `mcp__hive__run_goal` / `execute_plan` | pending | 产生真实 run id 后必须补在这里 |
