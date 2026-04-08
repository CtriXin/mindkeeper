你现在处理 gateway `GET /v1/session_state`，只做这一个切片，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/SERVER_INTEROP_CHECKLIST.md

任务目标：在 gateway 侧提供最小可用的 `GET /v1/session_state`，让 caller 能按 `device_id/workspace_id/session_id` 查询当前 session 状态。

必须完成：
- 在 `src/broker/stubServer.mjs` 实现 `GET /v1/session_state`。
- query 至少支持：`device_id`、`workspace_id`、`session_id`；如有现成 routing helper，统一复用。
- 响应至少包含：
  - `ok`
  - `session.remote_session_id`
  - `session.runtime_id`
  - `session.binding_reason`（如可得）
  - `session_summary_items` / `last_user_preview` / `last_answer_preview`（拿不到时可为 `null`）
- 如果配置了 remote service，优先把 remote `session_state` 合并进来；拿不到时不要 500，要给明确 fallback。
- 文档补到 `docs/`。
- 补最小验证脚本或可执行验证步骤。

边界：
- 不改 remote prompt 主链路
- 不做列表分页 / 管理面
- 不做多用户

交付要求：
- 直接改代码
- 更新 handoff，写明验证命令与结果
- 最终只回：一句话结论 + changed files + 怎么验证
