# Official `cc` 入口计划（2026-04-06）

这份文档只回答一个现实问题：

- 如果我们后面真想从 `MMS` 进入“真正的 official Claude Code”，现在最能借力的官方入口到底是什么？

先说白话结论：

- 当前最容易直接复用的，不是完整 TUI，而是 official `claude` 的 headless `--sdk-url` child 路径。
- 这条路复用的是“真正的 official `claude` core”，不是我们自定义 shell。
- 但它目前还是 stream-json child，不是用户平时看到的那套完整 REPL/TUI。
- 所以当前最合理的推进顺序是：
  - 保留现有 broker shell 作为 debug 面
  - 同时把 official child launch contract 固定下来
  - 等 server/broker 侧有兼容的 session-ingress / CCR worker 面后，再把真实 official child 接进来

## 1. 我们现在已经确认的三个官方入口

### 1.1 `claude --print --sdk-url <url>`

这是当前最能直接借力的入口。

它在官方源码里被真正用于：

- bridge/session child 启动
- 把 official `claude` 当作一个 stream-json worker 跑起来

关键参考：

- `/Users/xin/Downloads/src/bridge/sessionRunner.ts`
- `/Users/xin/Downloads/src/main.tsx`
- `/Users/xin/Downloads/src/cli/remoteIO.ts`

它的特征：

- 用的是真 official `claude` binary
- 不是我们自定义实现的 agent loop
- 但它默认是 headless / stream-json
- 不是用户熟悉的正常交互 TUI

所以这条路适合做：

- official runtime child 复用
- session-ingress 兼容验证
- broker/server 侧协议收口

不适合直接当：

- “最终用户看到的完整 official CLI 体感”

## 1.2 `claude assistant [sessionId]`

这是更像“真正进入 official REPL”的入口。

关键参考：

- `/Users/xin/Downloads/src/main.tsx`
- `/Users/xin/Downloads/src/assistant/sessionDiscovery.js`

它的特征：

- 本地会起 official REPL viewer
- 但前提是：
  - 已经有一个官方 bridge session 在跑
  - 本地 discovery / attach 能认到那条 session

这意味着它现在不适合我们直接拿来接 broker，因为：

- 它不是一个随便给 URL 就能连的开放入口
- 它期待的是 official bridge/session 基础设施

所以这条路现在先记住，不作为当前最短路径。

## 1.3 `claude --remote` / `claude --teleport`

这是官方 remote session 路径。

关键参考：

- `/Users/xin/Downloads/src/main.tsx`
- `/Users/xin/Downloads/src/utils/teleport.tsx`

它的特征：

- 走的是官方远端 session 流程
- 直接依赖 Anthropic 自己那套 remote/session/backend
- 不是我们当前 broker 想承接的那条路径

所以这条路不属于我们当前主线。

## 2. 当前最现实的决定

当前先明确一件事：

- “从 `MMS` 打开真正 official `cc`”这句话，不能再泛泛地说

要拆成两层理解：

### 2.1 先复用真正的 official core

这件事现在就能有明确抓手：

- 目标是 `claude --print --sdk-url ...`

也就是：

- child 进程用 official `claude`
- 我们不再猜它怎么起
- 后续 server/broker 只要补到它需要的 session-ingress / CCR worker 面，就能直接试

### 2.2 完整 official TUI 体感

这件事当前还不能说已解：

- 因为更接近完整 TUI 的官方入口，仍然绑着 official bridge/session 基础设施
- 现在还不是“给一个 broker URL 就能直接进去”

所以当前不能假装已经打通。

## 3. 对本项目的直接指导

因此当前项目里要固定的不是“新的壳 UI”，而是下面这套共识：

1. 当前 debug 面继续保留：
   - `mms broker run <id>` -> 自定义 broker shell
2. 当前 reusable official 面要固定：
   - local official binary 的定位
   - version 检查
   - headless launch args/env contract
3. 当前 server/broker 后续应优先补的兼容面：
   - session-ingress compatible stream
   - 或 CCR worker compatible surface

一句话：

- 现在不是继续打磨自定义 shell
- 而是把“以后怎么换成真正 official child”这件事先钉死

## 4. 当前仓库已经补的最小脚手架

当前已经新增：

- `npm run official:doctor`
- `npm run official:mock`
- `npm run official:broker`

它会直接打印：

- 本机 `claude` binary 在哪
- 当前版本
- 现在最值得复用的 official 入口是哪条
- 一份可复用的 headless child launch contract

这个命令不是最终用户入口。

它的作用是：

- 让我们以后不再靠猜 official child 怎么起
- 让 `MMS` / broker / server 三边都能围绕同一份 contract 对齐

而 `official:mock` 的作用是：

- 真正拉起本机 official `claude --print --sdk-url ...`
- 先连到本地 mock session-ingress host
- 验证最小握手：
  - websocket read path
  - initialize
  - user replay
  - result 回传

注意：

- 这条 smoke test 仍然不是完整 TUI
- 如果本机 official `claude` 没登录，本轮结果会明确显示：
  - `protocol_ok_auth_missing`
- 这不代表协议没通，而是代表：
  - official child 已经连上了
  - 只是本机 local auth 还不满足真实模型调用

而 `official:broker` 的作用是：

- 不再只是连仓库里的独立 mock host
- 而是先走 broker 自己的：
  - `POST /auth/device`
  - `POST /sessions`
- 再让 broker 在 session create 响应里返回：
  - `official_child.sdk_url`
  - `official_child.access_token`
- 然后直接把真实本机 official child 连到 broker 的 `/v2/session_ingress/...`

如果它也显示：

- `protocol_ok_auth_missing`

那这次多出来的确定性是：

- broker 自己已经能产出那份官方 child 真正可消费的 session-ingress contract
- 当前 blocker 仍然只是“本机 local official auth 未登录”，不是 broker 这层 contract 还没长出来

## 5. 当前边界再说一遍

这一轮之后要避免两个误会：

- 误会一：
  - “既然能起 official child，就等于已经能从 MMS 进入完整 official TUI”
  - 不是
- 误会二：
  - “既然完整 TUI 还没打通，那现在研究 official child 没价值”
  - 也不是

真实情况是：

- official child launch contract 是当前最短、最稳、最不瞎猜的一步
- 完整 TUI 入口还需要更深一层的官方 session/bridge 接口条件

## 6. 下一步建议

本项目后续最顺的顺序是：

1. 继续保留 `B -> broker shell` 作为 debug 面
2. 让 server/broker 侧逐步把现在这份本地已跑通的 session-ingress contract 换成真实 server adapter
3. 一旦兼容面够了，优先试 official headless child
4. 再决定是否继续追完整 TUI attach/viewer 路径
