你现在只处理一件事：把 live `official:attach` 的 remote auth source 对齐到当前 healthy runtime，目标是把 status 从 `protocol_ok_model_error` 推到 `protocol_and_model_ok`。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker

先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T223000+0800-08-remote-doctor-real-interop.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T234630+0800-12-agent-official-attach-live-broker.md

已知事实：
- healthy remote service: http://23.95.30.199:28082
- healthy runtime_id: cc-static-1
- 当前 live attach 已跑通到 result，但失败为：`This organization has been disabled.`
- 当前最小 blocker 是 live profile / credentials 仍把 remote auth sync target 指向 `claude-code-official-3`

任务目标：
- 找到 live profile / credentials 真正的来源文件。
- 把 remote auth sync target 从旧的 disabled auth source 收口到当前 healthy runtime 对应 auth source。
- 复跑 live-configured broker + `npm run official:attach`。
- 记录最终 status。

边界：
- 不改主架构。
- 不顺手做别的 cleanup。
- 不重写 profile 系统。
- 若需要改 secrets / credentials 文件，只做最小改动并明确写到 handoff。

必须交付：
- 一句话结论
- 实际改动了哪个文件 / 哪个环境变量
- 复跑命令
- 最终 status
- 若仍失败，最小 blocker 在哪一层
- handoff 路径
