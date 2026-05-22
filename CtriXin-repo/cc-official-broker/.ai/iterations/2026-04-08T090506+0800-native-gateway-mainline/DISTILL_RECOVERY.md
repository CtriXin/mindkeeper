# Distill Recovery

- 文件恢复口令：`dst-native-gateway-2026-04-08T090506+0800`
- MindKeeper 恢复口令：`dst-0408-1x9q4r`
- 恢复顺序：
  1. 读 `../../coord/LATEST.md`
  2. 读 `./OVERVIEW.md`
  3. 读 `./CONTEXT.md`
  4. 读 `../../coord/TASK_BOARD.md`
  5. 读 `../../coord/BRANCHES_WORKTREES.md`
- 当前主线 worktree：`/Users/xin/auto-skills-wt-cc-official-broker-native`
- 当前主线 branch：`feature/cc-official-broker-native-gateway-mainline`
- 当前恢复重点：按 `docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md` 切 implementation slicing，优先 C3 -> C5 -> C1
- 最新补充重点：`official:proxy` 已加 local execution guard（write/bash/edit 必须走本地 injected runner）；恢复时优先关注 `src/official/upstreamProxy.mjs` 与 `scripts/test-official-proxy-local-exec-guard.mjs`
