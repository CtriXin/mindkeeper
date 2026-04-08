你现在处理真实远端联调，只做这一个任务，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/SERVER_INTEROP_CHECKLIST.md
4. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/src/remote/doctorRemoteService.mjs

任务目标：用真实 remote service 跑通 `npm run remote:doctor`，给出一份明确的 acceptance 结果，确认当前 gateway 主线是否已经具备真实联调基础。

必须完成：
- 使用当前有效的 remote service 环境变量运行一次真实 `npm run remote:doctor`。
- 记录并整理 5 项 verdict：
  - `base_url_reachable`
  - `auth_passed`
  - `sticky_two_prompts`
  - `session_state_consistent`
  - `runtime_id_present`
- 给出 overall 结论：
  - `ACCEPTANCE PASS` 或 `ACCEPTANCE FAIL`
- 如果失败：
  - 必须定位到最小 blocker，明确是 remote service 问题、gateway 问题、还是配置问题
  - 给出最小修复建议，但这轮不要顺手扩写大改
- 如果通过：
  - 明确写出当前主线已经跑通到哪一步
  - 列出下一步最值得做的 1 个任务
- 写 handoff 到 `.ai/coord/handoffs/`，包含实际命令、关键输出、最终结论
- 更新 `.ai/coord/LATEST.md` 和必要的共享状态文档

边界：
- 不重构 doctor
- 不改大架构
- 不做多人共享
- 不扩到 UI
- 除非定位到 blocker，否则不改 C1/C3/C4/C5/C6/C7 主逻辑

交付要求：
- 最终只回：一句话结论 + verdict 5 项 + overall + handoff 路径
