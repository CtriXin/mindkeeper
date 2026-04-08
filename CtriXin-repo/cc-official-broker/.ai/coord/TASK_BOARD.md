# Task Board

| Status | Type | Level | Owner | Task | Prompt | Notes |
|---|---|---|---|---|---|---|
| review_done | hive-composite | high | codex-main | 抽 `cc-mcp-bridge` 可复用能力清单 | `./prompts/01-hive-capability-extraction.md` | 实际不是 Hive 执行；`glm5.1` trigger 的 manual-analysis，评分待补 |
| review_done | single-agent | medium | codex-main | 做 cleanup 审计与归档建议 | `./prompts/02-agent-cleanup-audit.md` | 已收口到 `./.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/CLEANUP_AUDIT.md` |
| review_done | single-agent | high | codex-main | 写 gateway acceptance spec | `./prompts/03-agent-gateway-acceptance-spec-v2.md` | 交付 `./docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md` 与 spec handoff，主线已可进入 implementation slicing |
| review_done | single-agent | high | codex-main | 做 C5 runtime lifecycle | n/a | worker=`kimi-for-coding`；已交付 `./src/runtime/runtimePool.mjs`、`./docs/RUNTIME_LIFECYCLE.md`；评分待补 |
| review_done | single-agent | high | codex-main | 做 C3 source IP allowlist | n/a | worker=`kimi-for-coding`；已交付 `./docs/SOURCE_IP_ALLOWLIST.md`；HTTP + WebSocket ingress 已复审通过；评分待补 |
| review_done | single-agent | high | codex-main | 做 C1 key management | n/a | worker=`mimo`；已交付 `./src/auth/keyStore.mjs`、`./src/auth/keyManager.mjs`、`./docs/KEY_MANAGEMENT.md`；评分待补 |
| in_progress | codex-main | high | codex-main | 主线 review / 集成 / 风险把关 | n/a | 我负责 review、合并、修 bug、验线 |
| review_done | single-agent | high | codex-main | 修 C4 sticky/runtime binding 的 fail-fast 语义 | `./prompts/04-c4-sticky-binding-revision.md` | revision worker=`glm5.1` 已复审通过；16/16 verify pass，stub-server e2e 也通过 |
| review_done | single-agent | high | codex-main | 做 runtime_id upstream passthrough | `./prompts/05-agent-runtime-id-header.md` | revision 已复审通过；header + metadata + verify 均通过 |
| review_done | single-agent | high | codex-main | 做 gateway `GET /v1/session_state` | `./prompts/06-agent-gateway-session-state.md` | worker=`qwen-3.6-plus`；补修 miss 语义和 verify 后已通过 |
| review_done | single-agent | medium | codex-main | 做 `remote:doctor` 验收口径对齐 | `./prompts/07-agent-remote-doctor-alignment.md` | worker=`qwen-3.6-plus`；已复审通过，新增 verdict + probe 对齐 |
| review_done | single-agent | high | codex-main | 做真实 remote:doctor 联调验收 | `./prompts/08-agent-remote-doctor-real-interop.md` | 真实远端 acceptance 已 PASS；remote endpoint=`http://23.95.30.199:28082` |
| review_done | single-agent | high | codex-main | 做 local official CLI -> gateway 真实入口联调 | `./prompts/09-agent-local-official-cli-gateway-e2e.md` | worker=`qwen-3.6-plus`；结论已收口为 headless child 通、full TUI blocked |
| review_done | single-agent | high | codex-main | 做 current-usable 官方入口一条命令体验收口 | `./prompts/11-agent-official-attach-turnkey.md` | worker=`kimi beta`；`official:attach` 已收成零配置入口 |
| review_done | single-agent | high | codex-main | 做 `official:attach` -> live broker 真实联调 | `./prompts/12-agent-official-attach-live-broker.md` | live-configured broker 已跑到 `protocol_ok_model_error`；最小 blocker 为 remote auth source 仍指向 disabled org |
| review_done | single-agent | high | codex-main | 做 live auth source alignment 并复跑 `official:attach` | `./prompts/13-agent-live-auth-source-alignment.md` | 已完成；status=`protocol_and_model_ok`，返回 `LIVE_ATTACH_OK` |
| pending | single-agent | medium | codex-main | 评估把 `CLIProxyAPI` 改造成 gateway facade 的最小接法 | n/a | 可选增强；只在主线跑稳后再做，定位是 facade，不替代 runtime control plane |
