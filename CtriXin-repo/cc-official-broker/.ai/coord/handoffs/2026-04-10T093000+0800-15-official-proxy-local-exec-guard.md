# Handoff - 15 official:proxy local-exec guard

- 时间：2026-04-10T09:30+0800
- owner：codex-main
- 范围：`src/official/upstreamProxy.mjs`、`scripts/test-official-proxy-local-exec-guard.mjs`

## 结论

`official:proxy` 已做最小方向性修正：local write/bash/edit 场景必须走本地 injected runner，远端 bridge 只保留 planner/runtime augmentation。

## 已落地改动

1. 收紧 planner 协议边界
   - 新增 `PlannerBoundaryError`，对方向性违规返回可辨识 `409` + `error.code`。
   - 对 write/bash/edit intent，若 planner 直接返回 `final`（冒充成功）会被拦截，拒绝放行。

2. 本地能力 fail-fast
   - 新增 policy 检查：当用户请求涉及 write/edit/bash，但当前 session/profile 没有 advertise 对应 injected runner 工具时，直接 `409`。
   - 避免“看起来可写、实际落远端 /workspace”的误导体验。

3. mutating tool 路由优先 runner
   - planner 若返回 builtin `Write`/`Edit`/`Bash`，会优先映射到 `mcp__cc-official-broker-runner__write_file` / `apply_patch` / `bash`。

4. follow-up turn 放宽
   - 若消息流中已经有对应 `tool_result`（本地执行完成证据），下一轮允许 planner 正常返回 `final` 收口，不会被持续强制 `tool_use`。

## 验证

- `node --check src/official/upstreamProxy.mjs` ✅
- `node --check scripts/test-official-proxy-local-exec-guard.mjs` ✅
- `node scripts/test-official-proxy-local-exec-guard.mjs` ✅
  - 覆盖：
    - 写文件请求下 remote final 冒充成功被拒绝
    - 缺 runner write/edit 能力 fail-fast
    - builtin `Bash` 被映射到 injected runner
    - 已有 `tool_result` 的 follow-up turn 可正常 final 收口
- `node scripts/test-runtime-id-upstream.mjs` ✅（回归）

## 风险与后续

- 当前 intent 判定基于 text pattern + tool_choice，不是语义级 parser；边界 case 仍可能误判。
- `tool_result` 放宽逻辑依赖消息中的 `tool_use_id` 关联；若上游裁剪历史导致 id 丢失，仅在“最后一条是纯 tool_result”时做保守放宽。
