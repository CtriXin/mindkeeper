你现在处理 runtime_id upstream passthrough，只做这一个切片，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/STICKY_BINDING.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md

任务目标：把 gateway 选中的 `runtime_id` 真正带到 upstream request，让 server-side runtime/control plane 能看到这是哪个 runtime/container。

必须完成：
- `src/broker/remoteServiceClient.mjs` 的 `promptRemoteService` / `postRemoteAgentEvent` / `fetchRemoteSessionState` 增加 `runtimeId` 输入。
- 向 upstream 请求增加一个明确 header，默认名先用 `x-cc-runtime-id`。
- 如已有 metadata 结构，也同步写入 `runtime_id`，保持 server-side 好读。
- `src/broker/stubServer.mjs` 在所有 remote-service 调用点把当前 session 的 `runtime_id` 传进去。
- 文档补到 `docs/STICKY_BINDING.md` 或相关 interop 文档。
- 补最小验证：证明 header/metadata 已被发出。可以用本地 mock server 或单测，不要依赖真实线上服务。

边界：
- 不改 sticky decision
- 不做 rebind / migration
- 不做多用户
- 不改 C1/C3/C4/C5

交付要求：
- 直接改代码
- 更新 handoff，写明验证命令与结果
- 最终只回：一句话结论 + changed files + 怎么验证
