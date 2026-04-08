你现在处理“让我能直接体验”的收口任务，只做这一个任务，不扩 scope。

仓库绝对路径：/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
先读：
1. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/LATEST.md
2. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/docs/OFFICIAL_CC_ENTRYPOINT_PLAN.md
3. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T225100+0800-09-agent-local-official-cli-gateway-e2e.md
4. /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/handoffs/2026-04-08T223000+0800-08-remote-doctor-real-interop.md

任务目标：把当前可行的体验路径收成“我本机一条命令就能跑”的最小可用体验。注意：当前目标不是完整 TUI direct-connect，而是把可行的 official child headless + broker 路径做成稳定入口。

必须完成：
- 明确选择当前唯一可交付入口：`official:attach` 或同等一条命令入口。
- 把这条入口收成最小可用：
  - 所需环境变量明确
  - 缺省值/示例配置明确
  - 失败报错更直接，不要让用户猜
- 给出一条真实可执行命令，让用户本机直接体验当前已通链路。
- 如果需要配置文件（例如 `.env.example`、本地 profile、worktree config 示例），可以补，但不要引入复杂安装器。
- 文档只收口到“怎么跑、会看到什么、当前不是完整 TUI”这三件事。
- handoff 写到 `.ai/coord/handoffs/`
- 更新 `.ai/coord/LATEST.md`

边界：
- 不追 full TUI direct-connect
- 不改 server runtime 架构
- 不扩多人共享
- 不改第三方 relay 路线
- 不做大 UI

交付要求：
- 最终只回：一句话结论 + 体验入口命令 + 需要的环境变量 + 当前是不是完整 TUI + handoff 路径
