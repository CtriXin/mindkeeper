# Current Plan: 恢复并继续 cc-official-broker 正确主线：本地 official Claude Code CLI 必须是主执行者；本地文件读写、bash、edit、tool use 都应在本机完成；远端只做 planning/runtime augmentation，不能再默认把写文件落到远端 /workspace。
Created: 2026-04-10T00:55:53.003Z
Status: executing

## Tasks
- [x] task-a: 读取所有指定的上下文文件（AGENTS.md、LATEST.md、TASK_BOARD.md、BRANCHES_WORKTREES.md、DISTILL_RECOVERY.md、HANDBOOK.md 相关段落），然后检查当前 git diff 和 src/official/upstreamProxy.mjs 的实际代码，确认 worker 已落地的修正是否完整且方向正确。输出一份简洁评估：哪些修正已到位、哪些有遗漏或方向偏差。评估结果写入 .ai/coord/LATEST.md 的 Review 区段。 (kimi-k2.5) — completed
- [x] task-b: 核对 src/official/upstreamProxy.mjs 中的 official:proxy 实现，确保以下 4 条 guard 全部到位：
1) write/bash/edit 等 mutating tool 意图下，remote planner 不允许直接回 final 冒充成功——必须在拦截层 strip 掉或替换为 plan-only suggestion
2) 本地 runner 没有 advertise 对应 tool 能力时 fail-fast（返回明确错误而不是静默转发远端）
3) mutating builtin tool（Write/Edit/Bash）优先映射到 injected runner MCP tool 而不是远端
4) 在已有对应 tool_result 的 follow-up turn 中允许 final 正常收口（不误杀正常流程）

如有缺失，做最小修正。不要引入显式 local MCP file tool。不要扩大为 Local Runner 大重构。

ONLY modify this file: src/official/upstreamProxy.mjs (kimi-for-coding) — completed
- [ ] task-c: 如果 task-b 的修正涉及 runOfficialProxy.mjs 的调用约定变更，同步更新 src/official/runOfficialProxy.mjs 中对应的调用点。如果 runOfficialProxy.mjs 无需改动则跳过此任务。

ONLY modify this file: src/official/runOfficialProxy.mjs (kimi-k2.5) — failed
- [x] task-d: 验证并修复 scripts/test-official-proxy-local-exec-guard.mjs：确保测试脚本覆盖以下场景并全部通过：
1) 远端返回 write tool call 时被拦截，不直接落盘
2) 远端返回 bash tool call 时被拦截
3) 远端返回 edit tool call 时被拦截
4) 本地 runner 无对应能力时 fail-fast
5) follow-up turn 有 tool_result 时 final 可正常通过

运行 node --check 和 node 执行，确保通过。如有遗漏场景则补充测试。ONLY modify this file: scripts/test-official-proxy-local-exec-guard.mjs (kimi-for-coding) — completed
- [x] task-e: 运行 scripts/test-runtime-id-upstream.mjs，如有失败则修正 src/official/upstreamProxy.mjs 或测试脚本本身直到通过。修正只针对 runtime-id 相关逻辑，不做无关改动。

ONLY modify these files: [src/official/upstreamProxy.mjs, scripts/test-runtime-id-upstream.mjs] (kimi-k2.5) — completed
- [x] task-f: 检查当前 patch 是否仍有场景把「本地写文件」漏到远端 /workspace。具体检查：
1) upstreamProxy.mjs 中所有 tool_name 路由分支，是否有 write/edit/create_file 等未被拦截而直接转发远端的路径
2) runOfficialProxy.mjs 中是否有默认 fallback 会把 mutating 操作送到远端
3) 如有遗漏，在正确方向上做最小修（不引入显式 local MCP file tool）

ONLY modify these files: [src/official/upstreamProxy.mjs, src/official/runOfficialProxy.mjs] (glm-5-turbo) — completed
- [x] task-g: 按仓库规则，将本轮所有已落地改动追加到 .ai/agent-release-notes.md。内容包含：
1) 改了哪些文件
2) 现在机制怎么工作（简述 guard 逻辑）
3) 跑了哪些验证
4) 还剩哪些已知风险
5) 下一步最推荐做什么

格式遵循仓库已有的 release notes 风格。 (glm-5-turbo) — completed
