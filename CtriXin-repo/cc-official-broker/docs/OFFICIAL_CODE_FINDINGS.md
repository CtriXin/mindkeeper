# Official Claude Code 源码勘察结论（2026-04-06）

这份文档只回答三件事：

- 官方源码到底直接透露了什么
- 这些信息对 `cc-official-broker` 有什么现实帮助
- 当前哪些东西是我们自己的 broker 设计，哪些不是

## 1. 一句话结论

- 这份源码帮助很大，因为它直接证明官方 remote 不是“普通 endpoint relay”，而是 `session + events + subscribe` 模式。
- 当前 broker 里的 `url + device_key + usage stats` 是我们自己的接入壳，不是官方 Claude remote protocol 本身。
- 所以我们现在不需要“伪装成 official”，也不需要“绕过 official”；我们是在自己的 broker 外壳里，接远端真实发生的 official runtime。

## 2. 当前要怎么理解整条链路

当前项目的中间态可以这样理解：

```text
MMS(local)
  -> Broker(url + device_key)
  -> Remote runtime service(server)
  -> official Claude runtime / session(server side)
  -> Local Runner(local tools)
```

其中：

- `Broker(url + device_key)`
  - 是我们自己定义的接入层
  - 负责 device identity、usage 统计、workspace 隔离、local runner 路由
- `official Claude runtime / session`
  - 是远端真实发生的 official 行为
  - 认证、session 生命周期、org 作用域都在远端真实成立
- `Local Runner`
  - 是我们为了把本地文件、shell、git、IDE 能力接回远端 session 而增加的本地执行层

## 2.1 本地 reference 约定

后续遇到 official remote / auth / session / telemetry 相关问题，默认先看这份本地源码快照，不再先靠猜：

- local reference root:
  - `/Users/xin/Downloads/src`

当前这份 reference 的用途是：

- 查官方 session / events / subscribe 真实接口形状
- 查 official auth headers / org headers
- 查 telemetry / privacy level / analytics 相关开关
- 查 code session / bridge worker 相关实现

注意：

- 这是本机本地 reference，不是本仓库内受版本管理的一部分
- 如果后续官方版本变化，需要重新比对这份 reference 与线上实际行为

## 3. 从源码里已经能直接确认的事实

### 3.1 官方确实有 session-oriented remote API

不是只靠单轮 chat/completions。

能直接看到的接口包括：

- `POST /v1/sessions`
- `GET /v1/sessions/{id}`
- `POST /v1/sessions/{id}/events`
- `POST /v1/sessions/{id}/archive`
- `wss://.../v1/sessions/ws/{id}/subscribe`

对应源码：

- `/Users/xin/Downloads/src/bridge/createSession.ts`
- `/Users/xin/Downloads/src/utils/teleport/api.ts`
- `/Users/xin/Downloads/src/remote/SessionsWebSocket.ts`

### 3.2 WebSocket 不是我们想象的一套自定义 auth 流程

源码里注释还提到过“send auth message”，但真实实现已经是：

- 连接 `wss://api.anthropic.com/v1/sessions/ws/{sessionId}/subscribe?organization_uuid=...`
- 直接在连接 headers 里带：
  - `Authorization: Bearer <accessToken>`
  - `anthropic-version: 2023-06-01`

关键位置：

- `/Users/xin/Downloads/src/remote/SessionsWebSocket.ts:75`
- `/Users/xin/Downloads/src/remote/SessionsWebSocket.ts:109`
- `/Users/xin/Downloads/src/remote/SessionsWebSocket.ts:116`

### 3.3 用户输入是 append 到 session events，不是直接打一个普通 prompt API

发送用户消息的路径是：

- `POST /v1/sessions/{sessionId}/events`

而不是“每次都新建一个无状态 completion”。

关键位置：

- `/Users/xin/Downloads/src/utils/teleport/api.ts:369`

### 3.4 官方 remote session 有 control / permission 语义

源码能看到：

- `control_request`
- `control_response`
- permission request / cancel

这说明 official remote session 本来就不是纯文本流，而是带交互控制面的 session channel。

关键位置：

- `/Users/xin/Downloads/src/remote/RemoteSessionManager.ts:153`
- `/Users/xin/Downloads/src/remote/RemoteSessionManager.ts:187`
- `/Users/xin/Downloads/src/remote/RemoteSessionManager.ts:245`

### 3.5 还有一条更接近 bridge worker 的 code session 路线

源码里还能看到：

- `POST /v1/code/sessions`
- `POST /v1/code/sessions/{id}/bridge`

`/bridge` 会返回：

- `worker_jwt`
- `api_base_url`
- `expires_in`
- `worker_epoch`

这对我们非常关键，因为它说明官方内部确实存在“把 OAuth 会话换成 worker bridge 凭证”的机制。

关键位置：

- `/Users/xin/Downloads/src/bridge/codeSessionApi.ts:33`
- `/Users/xin/Downloads/src/bridge/codeSessionApi.ts:83`
- `/Users/xin/Downloads/src/bridge/codeSessionApi.ts:100`

### 3.6 telemetry / privacy 也能直接从源码确认

源码里能直接看到 privacy level 相关开关：

- `DISABLE_TELEMETRY`
  - 对应 `no-telemetry`
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  - 对应 `essential-traffic`

从注释语义看：

- `no-telemetry`
  - 关闭 analytics / telemetry / feedback survey
- `essential-traffic`
  - 关闭所有 nonessential traffic
  - 包括 telemetry，以及 auto-updates、release notes、部分非必要网络能力

关键位置：

- `/Users/xin/Downloads/src/utils/privacyLevel.ts`
- `/Users/xin/Downloads/src/services/analytics/config.ts`
- `/Users/xin/Downloads/src/services/analytics/firstPartyEventLoggingExporter.ts`

## 4. 认证这件事，哪些是官方的，哪些是我们的

### 4.1 官方侧真实要求

目前从源码看到，官方 remote 至少依赖这些信息：

- `Authorization: Bearer <OAuth access token>`
- `anthropic-version: 2023-06-01`
- 某些 session API 还要：
  - `anthropic-beta: ccr-byoc-2025-07-29`
  - `x-organization-uuid: <orgUUID>`

关键位置：

- `/Users/xin/Downloads/src/bridge/createSession.ts:140`
- `/Users/xin/Downloads/src/utils/teleport/api.ts:278`
- `/Users/xin/Downloads/src/utils/teleport/api.ts:372`

### 4.2 我们 broker 里的 `url + device_key` 是什么

这是我们自己定义的 broker-side envelope，用来做：

- device 鉴权
- 用户/设备/工作区路由
- usage 统计
- 灰度/feature flag
- 本地 runner 绑定

它不是：

- 官方 `Claude.ai OAuth`
- 官方 session API 的原生 credential
- “伪装成 official” 所必须的字段

## 5. 这意味着我们现在到底在做什么

用户可以把当前方案理解成：

- 我们没有在本地伪造 official remote protocol
- 我们也没有试图绕过 official 的 OAuth / org / session 体系
- 我们是在自己的 broker 外面套一层“入口、隔离、统计、runner 桥接”
- 真正的 remote reasoning 和 session 行为，仍然发生在远端真实 runtime 上

如果当前 broker 后面接的是 `cc-mcp-bridge` 风格 remote service，那么现阶段更准确的说法是：

- broker 正在消费一个 server-side official runtime service adapter
- 还不是我们自己直接对接官方原生 `sessions/events/subscribe` 全套协议
- 但远端那一层依旧是真实 official runtime 在工作，不是本地伪装出来的假协议

## 6. 哪些东西现在可以少走弯路

源码勘察后，可以明确少猜这些东西：

- 不用再凭空设计一套“像 official 的 remote session stream”
- 不用再把最终形态误想成纯 `/responses` relay
- 不用再假设只靠 API key 就能完整替代 Claude.ai OAuth
- 不用再怀疑 remote session 是否真的存在

对 `cc-official-broker` 最现实的帮助是：

- broker 继续专注 `session truth + runner bridge + isolation`
- 后端 adapter 的未来方向更清楚：
  - 优先参考 `sessions + events + subscribe`
  - 或进一步研究 `code sessions + /bridge + worker_jwt`

## 7. 仍然绕不过的边界

就目前源码能看到的内容，下面这些边界依旧成立：

- 绕不过 `Claude.ai OAuth`
- 绕不过 `organization_uuid`
- 绕不过 remote session 生命周期
- 绕不过“本地文件/命令能力需要本地 companion/runner”这层现实

所以：

- 纯远端 API 形态，不会天然拥有你本机文件系统能力
- 真正要接近 official 的本地体感，还是要 `Broker + Local Runner`
- 如果想降低 official runtime 的 telemetry，要在运行 official `cc` 的那一侧控制环境变量；不是靠 broker 字段名去“伪装”掉

## 8. 对本项目的直接指导

当前建议继续保持：

- `cc-official-broker`
  - 负责 `POST /auth/device`
  - 负责 `POST /sessions`
  - 负责 `WS /sessions/:id/stream`
  - 负责 `WS /runner/connect`
  - 负责 broker session truth
  - 负责 local runner / tool callback
- server-side runtime service
  - 继续承接远端 official runtime
  - 后续若要更接近 official，可逐步向 `sessions/events/subscribe` 靠拢

不要做的事情：

- 不要在 broker 里重新发明一套并列的 official session truth
- 不要把 `device_key` 误当成 official 认证字段
- 不要把当前 broker 壳误解成“在本地 fake official”

## 9. 最后一句话

这份源码最有价值的地方，不是告诉我们“它用了什么 model”，而是告诉我们：

- official remote 是真的
- 它是 session protocol，不是普通 endpoint
- 它有真实 auth、org、event、subscribe、worker bridge 语义

这会让我们后面的 broker 开发更像“对准真实结构靠近”，而不是“继续猜”。
