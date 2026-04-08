你现在处理 local official CLI -> gateway 的真实入口联调，只做这一个任务，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/OFFICIAL_CC_ENTRYPOINT_PLAN.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md
4. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/RUNTIME_CHAIN_PLAIN.md

任务目标：验证“本地 official Claude Code CLI 仅通过 gateway 地址与 gateway key 发起稳定会话”这条 acceptance，给出当前真实可达的最小落地方式。

必须完成：
- 基于当前 broker/gateway 能力，跑一条 local official CLI 接 gateway 的最小真实链路。
- 优先使用当前仓已有 official child / session-ingress 相关能力，不要新造大壳。
- 明确写出当前到底跑通的是哪种入口：
  - official child headless
  - broker shell + official child contract
  - 还是更接近完整 local official CLI 入口
- 给出实际命令、需要的环境变量、最小操作步骤。
- 如果没有完全跑通：
  - 必须明确最小 blocker 是什么
  - blocker 属于 local official auth、gateway contract、还是 server runtime 能力
  - 给出下一步最小修复建议，但不要顺手大改
- handoff 写到 `.ai/coord/handoffs/`
- 更新 `.ai/coord/LATEST.md`

边界：
- 不做新 UI
- 不做多人共享
- 不扩 MCP
- 不把任务改成第三方 relay 路线
- 除非遇到 blocker，否则不重构 C1-C8 既有能力

交付要求：
- 最终只回：一句话结论 + 当前入口类型 + 是否真正满足“local official CLI -> gateway” + 最小 blocker（如有） + handoff 路径
