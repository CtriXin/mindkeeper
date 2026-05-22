恢复并继续 cc-official-broker 正确主线：本地 official Claude Code CLI 必须是主执行者；本地文件读写、bash、edit、tool use 都应在本机完成；远端只做 planning/runtime augmentation，不能再默认把写文件落到远端 /workspace。

先按顺序读取：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/AGENTS.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/TASK_BOARD.md
4. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/BRANCHES_WORKTREES.md
5. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/DISTILL_RECOVERY.md
6. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/HANDBOOK.md 中关于 official:proxy / local runner / planner-only 的段落

当前已知真相：
- cc-mcp-bridge 侧那条"显式 local MCP file tool"临时方案已经回退，不作为方向。
- 正确主线固定为：local official Claude Code CLI -> official:proxy / hidden thin layer -> remote planner/runtime
- 本地执行面必须保留在本机：本地文件 read/write、bash、apply_patch / edit
- 远端只能 plan，不能冒充已经在远端 /workspace 执行成功。
- 之前的 explorer/reviewer 已确认关键瓶颈在 src/official/upstreamProxy.mjs
- 次要相关：src/official/runOfficialProxy.mjs、如确有必要再看 src/index.mjs
- 当前 worker 已做一轮最小修正，重点文件包括 src/official/upstreamProxy.mjs 等

本轮任务：
1. 先检查当前 diff 和实际代码，确认 worker 已落地的修正是否完整且方向正确。
2. 核对 official:proxy 是否已经做到：write/bash/edit 意图下 remote planner 不允许直接回 final 冒充成功；本地 runner 没 advertise 对应能力时 fail-fast；mutating builtin 优先映射到 injected runner MCP；在已有对应 tool_result 的 follow-up turn 允许 final 正常收口。
3. 运行并补齐验证：node --check src/official/upstreamProxy.mjs、node --check scripts/test-official-proxy-local-exec-guard.mjs、node scripts/test-official-proxy-local-exec-guard.mjs、node scripts/test-runtime-id-upstream.mjs，如有失败就修到通过。
4. 如果当前 patch 仍会把某些"本地写文件"场景漏到远端 /workspace，继续在正确方向上最小修，不要引入显式 local MCP file tool。
5. 每有已落地改动，按仓库规则继续追加 .ai/agent-release-notes.md 等。
6. 最后给出：改了哪些文件、现在机制怎么工作、跑了哪些验证、还剩哪些风险、下一步最推荐做什么。

约束：不要把"写本地文件"重新做成用户显式感知的 local MCP tool；不要把远端 /workspace 执行结果同步回本地冒充成功；不要扩大成完整 Local Runner 大重构；始终保持"用户感知上仍是本地 Claude Code 在工作"。