# Plan

1. 固定主线 worktree / branch
2. 建立共享 coordination hub
3. 建立逆序迭代恢复目录
4. 写 cleanup audit
5. 后续再派发 worker 做实现与 review

## Task 01 结果摘要 — Capability Extraction (2026-04-08)

6 项能力从 cc-mcp-bridge 识别，分类如下：

| ID | 能力 | 判定 | 优先级 | 源代码量 |
|---|---|---|---|---|
| C1 | Key Management | 重写 | P0 | ~1860行 |
| C2 | allowed_runtime_ids | 直接复用 | P1 | ~30行 |
| C3 | Source IP Allowlist | 直接复用 | P0 | ~60行 |
| C4 | Sticky/Runtime Binding | 重写 | P1 | ~600行 |
| C5 | Runtime Pool Lifecycle | 重写 | P0 | ~290行 |
| C6 | Usage/Audit/Quota | 分步迁移 | P1 | ~1200行 |

建议迁移顺序：C3 → C5 → C1 → C2 → C4 → C6
详细报告：`.ai/coord/handoffs/20260408T0123Z-hive-to-codex-main.md`

## Task 02 结果摘要 — Cleanup Audit (2026-04-08)

- 原 agent 审计方向可用，但删除命令与 ignore 范围过宽。
- 已收口到可执行版：
  - `.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/CLEANUP_AUDIT.md`
- 当前策略：
  - 先 audit，不做大范围硬删
  - `tmp/diagrams/*` 先归档再决定是否删

## Task 03 结果摘要 — Gateway Acceptance Spec (2026-04-08)

- 已补真实交付物：
  - `docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md`
  - `.ai/coord/handoffs/2026-04-08T093609+0800-spec-agent-to-codex-main.md`
- 主结论：
  - 第一阶段默认 `official CLI local capability first`
  - 服务器继续是唯一 `OAuth/runtime/egress` 真相源
  - 下一步按 C3 -> C5 -> C1 开切实现

## Task C5 结果摘要 — Runtime Lifecycle (2026-04-08)

- 已交付：
  - `src/runtime/runtimePool.mjs`
  - `docs/RUNTIME_LIFECYCLE.md`
  - `.ai/coord/handoffs/2026-04-08T094500+0800-c5-runtime-lifecycle-to-codex-main.md`
- 首轮 review 发现 2 个 blocking issues：
  - `enabled` 未反映 effective state
  - auto-unhealthy 可能打掉最后一个 healthy runtime
- 当前已修复并复审通过：
  - effective state 正确
  - auto-unhealthy 仅在存在其他 healthy runtime 时触发
  - 文档验证步骤改为真实可执行的 Node.js 模块调用

## Task C3 结果摘要 — Source IP Allowlist (2026-04-08)

- 已交付：
  - `src/config.mjs` 中的 `allowedSourceIps` / `trustXForwardedFor`
  - `docs/SOURCE_IP_ALLOWLIST.md`
  - `.ai/coord/handoffs/2026-04-08T095000+0800-c3-source-ip-allowlist-to-codex-main.md`
- 首轮 review 发现 blocking issue：
  - WebSocket `upgrade` ingress 未经过 allowlist
- 当前已修复并复审通过：
  - HTTP + WebSocket ingress 都会在 auth / 101 之前做 IP allowlist 检查
  - 默认仍是 optional / disabled（空 allowlist = allow all）
  - 动态 IP 用户无需配置即可正常使用

## Task C1 结果摘要 — Key Management (2026-04-08)

- 已交付：
  - `src/auth/keyStore.mjs`
  - `src/auth/keyManager.mjs`
  - `docs/KEY_MANAGEMENT.md`
  - `.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/C1_KEY_MANAGEMENT_HANDOFF.md`
- 首轮 review 发现 blocking issues：
  - `/v1/keys` 管理面未鉴权
  - WebSocket 在 `101` 之后才做 auth
- 当前已修复并复审通过：
  - `/v1/keys` 现要求有效 key 或 legacy token
  - `/runner/connect` 与 `/sessions/:id/stream` 会在 `101` 之前做 auth
  - 仍保留 Phase 1 边界：尚无完整 admin role / rotation / TTL
