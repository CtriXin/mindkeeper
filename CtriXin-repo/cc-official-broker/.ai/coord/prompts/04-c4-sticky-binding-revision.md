你现在处理 C4 sticky/runtime binding 的 revision，只修这一个任务，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/TASK_BOARD.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T135704+0800-c4-review-by-codex-main.md
4. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md

任务目标：把 C4 真正修成 fail-fast，而不是只记 event。

必须修的点：
- `POST /sessions` 的 create / resume / direct-connect 三条路径，只要 `bindingResult.runtime === null`，就必须直接返回失败，不允许创建或覆盖 session。
- 失败响应必须区分至少两类 reason：
  - `no_healthy_runtime_available`
  - `bound_runtime_not_acceptable`
- `resume` 失败时不能保留旧 `remoteService` 假装成功恢复。
- `docs/STICKY_BINDING.md` 要同步改口径，删掉“binding 失败但 session 仍被创建”这种描述。
- 补最小验证脚本或可执行验证步骤，证明：
  1. healthy runtime 下 create -> resume 正常
  2. 绑定后的 runtime 变 unhealthy 后，resume 返回失败且 session 不被覆盖
  3. 没有 healthy runtime 时，新建 session 返回失败

边界：
- 不做 TTL
- 不做 manual rebind API
- 不做 upstream header 透传
- 不做跨 runtime migration
- 不改 C1/C3/C5

交付要求：
- 直接改代码
- 更新 handoff，写明验证命令与结果
- 最终只回：一句话结论 + changed files + 怎么验证
