# cc-consult-first Handbook

> 这是 `cc-consult-first/` 的项目追溯文档。
> 只追加，不覆盖；后续重新接手时先看这里。

## 当前大方向

当前项目固定为 consult-first 路线：

```text
local CN LLM / local cc
  -> consult adapter
  -> remote official Claude Code brain
  -> local orchestrator decides next step
```

一句话：

- 本地模型主导
- 远端官方脑子只做 consult
- 不抢本地 agent ownership
- 不阻塞完整 `Broker + Local Runner` 主线

## 为什么单开这个目录

- `cc-official-broker/` 当前主线仍是 `Broker + Local Runner`
- 这条 consult-first 能力更像 sidecar / adapter
- 当前 `cc-official-broker/` 在上层仓库里还没正式进 git，不适合直接拿来做 worktree 基座
- 因此这轮单开一个 sibling 目录，优先把最短可用链路落下来

## 第一阶段只做三件事

1. 固定 remote consult client 的最小配置
2. 固定 `device_id / workspace_id / session_id` 三个隔离键
3. 提供 `doctor / consult / session:state` 三个最小命令

## 当前已落地

- 新建独立目录：`CtriXin-repo/cc-consult-first`
- 已补最小命令：
  - `npm run doctor`
  - `npm run consult`
  - `npm run session:state`
- 已支持两种远端入口：
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
- 已支持读取 `GET /v1/session_state`
- 已补最小测试：
  - config normalization
  - request payload

## 下一步

1. 视使用体感决定是否补 `--stream`
2. 视本地 orchestrator 需要决定是否补成 MCP tool
3. 如果后续这条 lane 证明稳定，再考虑和 `cc-official-broker/` 收口公共 routing/config
