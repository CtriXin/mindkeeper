你现在处理 `remote:doctor` alignment，只做这一个切片，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/src/remote/doctorRemoteService.mjs

任务目标：让 `npm run remote:doctor` 明确覆盖当前 Phase 1 验收口径：base URL、API key、sticky、session_state。

必须完成：
- 检查并收紧 `src/remote/doctorRemoteService.mjs` 的输出，让最终 report 更直接反映：
  - base URL 是否可达
  - auth 是否通过
  - 两次 prompt 是否 sticky
  - `session_state` 是否与 prompt 返回一致
- 若前一任务已落 `runtime_id`，则在 report 中一并展示；没有则保持兼容。
- 更新 CLI 输出文案，避免“通过/失败”过于模糊。
- 更新文档，给出一条最小验证命令。
- 不依赖真实生产环境特例，优先兼容 mock / local verification。

边界：
- 不改 gateway sticky logic
- 不引入 UI
- 不做 stats/dashboard 大改

交付要求：
- 直接改代码
- 更新 handoff，写明验证命令与结果
- 最终只回：一句话结论 + changed files + 怎么验证
