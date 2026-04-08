你现在处理 `official:attach` -> live broker 真实联调，只做这一个任务，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/HANDBOOK.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/OFFICIAL_CC_ENTRYPOINT_PLAN.md
4. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T224800+0800-11-agent-official-attach-turnkey.md
5. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T223000+0800-08-remote-doctor-real-interop.md

任务目标：把当前已可用的 `official:attach` 从“本地 broker 可体验”推进到“live broker 真实可体验”，确认本机 official child 能通过真实 gateway/broker 路径跑通。

必须完成：
- 使用真实 live broker 配置跑一次 `npm run official:attach`。
- 明确 live broker 地址、所需环境变量、最小执行命令。
- 记录真实结果：
  - 是否成功走完 device auth -> session create -> official child launch -> result
  - 最终 status 是什么（如 `protocol_and_model_ok` / `protocol_ok_auth_missing` / 其他）
  - 如果失败，最小 blocker 在哪一层：local auth / gateway contract / remote runtime / wrapper / config
- 如果只需很小修复即可打通，可以做最小修复；不要顺手大改架构。
- 更新 handoff 到 `.ai/coord/handoffs/`
- 更新 `.ai/coord/LATEST.md`

边界：
- 不追 full TUI direct-connect
- 不做新 UI
- 不改第三方 relay 路线
- 不重构 C1-C11 已通过能力
- 除非确认 blocker，否则不要改远端大范围部署

交付要求：
- 最终只回：一句话结论 + live broker 地址 + 实际命令 + 最终 status + 最小 blocker（如有） + handoff 路径
