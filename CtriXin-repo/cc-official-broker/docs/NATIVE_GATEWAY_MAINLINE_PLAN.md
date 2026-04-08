# Native Gateway Mainline Plan

## Goal

收口到一条主线：

```text
local official Claude Code CLI
  -> self-hosted gateway / broker
  -> server official runtime pool
  -> Anthropic Claude
```

## Non-goals

- 不继续把第三方 relay 当长期主路径
- 不要求外部用户先理解 `MMS` / daemon / hooks
- 不把重型 `local tools` 作为默认前置

## Layer split

### 1. local entry
- 主入口：official `Claude Code CLI`
- 用户体验目标：尽量做到“一个 cc 即可”
- 实际实现允许存在一个极薄 bootstrap，但默认不显性化

### 2. gateway / broker
- 接 official CLI 的 `ANTHROPIC_BASE_URL + token`
- 负责统一 auth、routing、sticky、policy、audit
- 不持有本地用户的杂乱前端标识作为上游真相

### 3. server runtime pool
- `one docker + one oauth + one real egress ip`
- `runtime/account/ip` 隔离
- disable / drain / sticky / quota / audit 统一在这一层治理

## What to reuse

- from `cc-official-broker`
  - `src/official/runOfficialProxy.mjs`
  - `src/official/upstreamProxy.mjs`
  - `src/session/localSessionRegistry.mjs`
- from `cc-mcp-bridge`
  - key 管理
  - `allowed_runtime_ids`
  - source IP allowlist
  - sticky runtime binding
  - runtime health / disable / drain
  - usage / audit / quota
- from official source reference
  - session / bridge / direct-connect / telemetry 边界认知

## Local tools policy

- 默认先复用 official CLI 自身的本地文件与命令能力
- 只有在 server-driven callback 确实需要时，才补最小 local bridge
- 这个 local bridge 必须：
  - 可选
  - 最小
  - 默认不让外部用户感知复杂度

## Project strategy

- 不新开项目
- 在 `cc-official-broker` 新分支 / 新 worktree 上继续推进
- `cc-mcp-bridge` 作为底座能力库按需抽取

## First implementation tranche

1. 固化 `official CLI -> gateway` 主链
2. 抽 `cc-mcp-bridge` 的 key/sticky/runtime/audit 清单
3. 定义极薄 local bootstrap 的职责边界
4. 建立 worker review integration 流程，所有 run id / handoff / branch/worktree 强制落文档
