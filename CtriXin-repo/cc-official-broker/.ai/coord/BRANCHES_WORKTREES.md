# Branches and Worktrees

## Active

| Project | Branch | Worktree | Purpose |
|---|---|---|---|
| monorepo(`/Users/xin/auto-skills`) | `feature/worktree-management` | `/Users/xin/auto-skills` | 旧主工作区，当前较脏，不再直接作为主实现区 |
| monorepo(`/Users/xin/auto-skills`) | `feature/cc-official-broker-native-gateway-mainline` | `/Users/xin/auto-skills-wt-cc-official-broker-native` | 新 native gateway 主线 worktree |
| monorepo(`/Users/xin/auto-skills`) | `feature/cc-official-broker-local-worker-v1` | `/Users/xin/auto-skills-wt-cc-worker-v1` | 历史 worker worktree，仅读参考 |
| monorepo(`/Users/xin/auto-skills`) | `feature/cc-remote-consult-first` | `/Users/xin/auto-skills-wt-cc-remote-consult-first` | 历史方向 worktree，仅读参考 |

## Stash
- `stash@{0}`: `wip(cc-official-broker): official proxy runner and session state`
- 当前不丢、不清；等 cleanup audit 后再决定是否拆回或归档
