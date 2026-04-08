# Spec Handoff

## 一句话结论

native gateway 第一阶段的验收口径已经收紧：本地只保留 official CLI 入口与最小 gateway 凭证，服务器继续独占 official `OAuth/runtime/egress` 真相，同时以 `device_id/workspace_id/session_id` 保证隔离与 sticky。

## 新增 / 修改文件

- `docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md`
- `.ai/coord/TASK_BOARD.md`
- `.ai/coord/LATEST.md`
- `.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/PLAN.md`
- `.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/OVERVIEW.md`
- `.ai/iterations/2026-04-08T090506+0800-native-gateway-mainline/DISTILL_RECOVERY.md`
- `HANDBOOK.md`

## 还有哪些验收点仍未定义

1. gateway token refresh / expiry contract
2. runtime `drain -> rebind` 的精确行为
3. optional local bridge 的 permission contract

## 推荐先实现哪 3 项

1. C3: source IP allowlist
2. C5: runtime pool lifecycle
3. C1: key management

## 交付说明

- 这次不是只改任务板；spec 正文已落到 `docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md`
- spec 已明确：
  - `cc-official-broker` 已有能力
  - `cc-mcp-bridge` 计划抽取能力
  - 第一阶段不做的边界
- cleanup audit 与 acceptance spec 现在都已落文档，主线可以进入 implementation slicing
