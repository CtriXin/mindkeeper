# Official OAuth Remote Broker 实践方案（2026-04-05）

## 1. 目标

这份文档收敛一个最小可行实践：

- 服务器持有真实 `Claude` 官方 `OAuth`
- 本地通过 `MMS` 启动
- 本地 `new session` 等价远端新 session
- 本地继续执行 `bash / search / read / write`
- 每台电脑通过 `url + device_key` 被识别和统计
- 不走 `newapi` / `CRS`

## 2. 最终结构

```text
MMS(local, i.e. multi-model-switch)
  -> Broker endpoint/profile(url + device_key)
  -> Remote Claude Session(server, real official OAuth)
  -> Local Runner(local bash/search/read/write)
```

解释：

- `MMS`
  - 这里明确指真实的 `multi-model-switch` 项目
  - 在产品侧可以把 broker 暴露成一个特殊 `endpoint/profile`
- `Broker`
  - 负责 device 鉴权、session registry、usage stats、tool routing
- `Remote Claude Session`
  - 服务器上的真实官方 `Claude` 会话
  - 持有真实官方 `OAuth`
- `Local Runner`
  - 跑在每台本地电脑
  - 真正执行 `bash / rg / read / write / patch`

## 2.1 当前阶段切分

- `P0`
  - broker stub + local runner + session stream 内部闭环
  - 已完成
- `P1`
  - 最小 `MMS` 接线
  - 当前已落第一版：
    - `multi-model-switch` 新增独立 `broker_profiles`
    - `mms broker ls/show/run`
    - `mms broker run <profile>` 已能自动拉起本地 loopback broker，并进入当前 profile 对应入口
- `P1.5`
  - broker 对 remote official runtime service 的最小 adapter
  - 当前已落第一版：
    - broker 的普通 prompt 可转发到 `cc-mcp-bridge` 风格的 `/v1/responses` 或 `/v1/chat/completions`
    - `/tool ...` 仍保留给本地 runner
    - broker inspect 可顺带查看远端 `GET /v1/session_state`
- `P1.6`
  - official local child launch contract
  - 当前已落第一版：
    - 能直接探测本机 official `claude` binary 与版本
    - 能固定 `claude --print --sdk-url ...` 这条 reusable headless contract
    - 能起一条本地 `official:mock` smoke test，直接验证 real official child 的最小协议联调
    - 明确这不是完整 TUI，只是后续从 debug shell 切向真正 official child 的桥
- `P1.7`
  - broker session-ingress contract
  - 当前已落第一版：
    - broker stub 的 `POST /sessions` 现在会返回 `official_child.sdk_url + access_token`
    - broker stub 现在自己能接 `WS /v2/session_ingress/ws/:id`
    - broker stub 现在自己能收 `POST /v2/session_ingress/session/:id/events`
    - 新增 `official:broker`，可直接验证 `device auth -> session create -> official child attach` 这条最小链路
- `P1.8`
  - MMS smoke entry
  - 当前已落第一版：
    - 新增 `official:attach`，可对任意已配置 broker 直接做 official child attach smoke
    - `multi-model-switch` 新增 `mms broker smoke <id>`
    - 现在已经能从 `MMS broker profile` 这层直接验证 `broker -> official child` contract
- `P1.9`
  - direct-connect TUI entry
  - 当前已落第一版：
    - broker stub 新增 direct-connect create/WS 兼容层
    - 新增 `official:connect`
    - `multi-model-switch` 里现在直接把 `official_connect` 作为默认 entry
    - `official:connect` 会先同步远端 `.claude.json + .credentials.json` 到本机独立 `CLAUDE_CONFIG_DIR`
    - 当前 broker 侧已能返回真实 `system/init + assistant + result`
    - 当前这条线的结论是：本机官方 client 的本地 login gate 已经能被远端 auth bundle 同步方案接住
- `P2`
  - broker 后端从 stub 切到真实 server-side official `cc`
- `P3`
  - 更完整的 session resume / transfer / usage stats / writable tools

## 2.2 当前完成度判断

如果按“架构方向是否已经收口”来算：

- 目前已经超过一半
- 可以认为主思路已经对了

如果按“你最终想要的真实日用链路是否已经稳定”来算：

- 还没有完全过线
- 当前更接近“中间态已成立”

拆开看更准确：

- 已完成或基本成立：
  - 单用户、双设备边界
  - `mac/macmini` 与 `company/personal` 隔离主键
  - broker session truth
  - local runner read-only capability
  - `MMS` 独立入口
  - broker 对 remote runtime service 的第一版 adapter
  - 官方源码 reference 与方向校准
  - official child launch contract 探针
  - broker 返回真实可消费的 session-ingress `url + token`
- 还没完全落地：
  - broker 背后直接承接更真实的 official session protocol
  - 更稳定的 stream / resume / sticky 行为
  - writable tool 能力与权限模型
  - 更完整的 usage stats、transfer、恢复与异常处理

一句话：

- “方向和框架”这部分，已经完成了一大半
- “最终日用体验”这部分，还在从中间态往前推

## 2.3 下一阶段最值得做的事

接下来最值钱的不是再扩概念，而是继续补这三件事：

1. 让 `MMS -> broker -> remote runtime service` 的对话链路更稳定
2. 让 broker 对 session / stream / resume 的状态可观测性再提升一点
3. 继续保持 local runner 边界清晰，先把 read-only 路线做稳，再碰 writable

这一轮新增的一点价值在于：

- 我们不再只会说“以后换成真正 official cc”
- 而是已经把当前最现实可复用的官方入口钉成：
  - `claude --print --sdk-url ...`
- 这会让后面的 server/broker 兼容面更明确
- 也让“debug shell 只是中间态”这件事边界更清楚
- 现在又多了一点更具体的落地：
  - broker 不只是“理论上以后可给 official child 用”
  - 而是已经能在 session create 响应里给出那份 `sdk_url + access_token`
  - 并让真实本机 official `claude` 连上自己的 session-ingress stub

当前刚落的一小步就属于第 2 点：

- 本地会记住同一项目最近一次 broker session
- `mms broker run <id> --resume-last` 可以直接续上
- shell 会直接显示 remote usage / cost / remote session id

## 2.4 已记录的后续优化想法（暂不进入当前主线验收）

### local spawn worker：用本地低成本模型减少主脑 token 消耗

背景：

- 当前主线里，远端 `Opus` 仍然是主脑
- 但很多本地交互动作很耗 token，例如：
  - 大量 `search`
  - 批量读文件
  - 多轮 `bash/git` 探索
  - 把原始结果一段段回灌给远端再继续想

想法：

- 不把 `Opus` 降级成插件
- 不回到 `Hive/MCP` 那种多主脑协同思考
- 仍然保持：
  - `Opus` 是主启动和最终决策者
  - broker 是 session truth
- 只是当遇到“低思考、高 token 消耗”的本地任务时：
  - broker 在本地 `spawn` 短生命周期 worker
  - worker 可以使用国产本地 `LLM` 或轻量本地流程
  - worker 负责本地探索、压缩、摘要
  - 最后只把结构化结果回给远端 `Opus`

边界：

- worker 不是主脑
- worker 不直接面向用户输出最终答案
- worker 不持有主 session truth
- worker 只做局部任务，不做最终决策

适合后续拆成的 worker 类型：

1. `spawn-search-worker`
2. `spawn-repo-summary-worker`
3. `spawn-patch-draft-worker`

当前结论：

- 这个方向和主线架构不冲突
- 但不进入当前主线验收
- 先等主线真实可用，再把它作为 `P2.5/P3` 优化层推进

TODO：

- 主线稳定后，评估哪些工具调用最烧 token
- 先原型 `spawn-search-worker`
- 定义 worker 只返回结构化 summary 的 contract

## 3. 明确和现有方案的区别

### 3.1 不是 `newapi / CRS`

- `newapi / CRS` 是 request-level relay / sticky / quota 路线
- 本方案是 session-level broker + local tools 路线
- 本方案默认不复用 `newapi / CRS` 运行时

### 3.2 不是本地官方账号直启

- 当前 `MMS` 已支持本地官方账号档案与本地官方 CLI
- 本方案改为：官方 `OAuth` 在服务器，工具执行仍在本地

### 3.3 不是 `ssh / tmux`

- `ssh / tmux` 会让执行现场变成服务器
- 本方案要求本地 repo / 本地 shell / 本地文件仍是执行现场

### 3.4 和 `Remote Brain + Local Hands` 研究稿的关系

- `docs/REMOTE_BRAIN_LOCAL_HANDS_PILOT_20260404.md` 是更泛的研究稿
- 本文档是它的收敛版：
  - 明确要求 `official OAuth`
  - 明确要求 `device_key + url` 做统计
  - 明确不走 `API relay`

### 3.5 和普通 provider endpoint 的关系

- 从 `MMS` 用户视角看，它可以长得像一个 `url + key` 的特殊 endpoint/profile
- 但从运行时视角看，它不是普通 provider relay
- 真正顺序是：
  - `POST /auth/device`
  - `POST /sessions`
  - `WS /sessions/:id/stream`
  - `WS /runner/connect`

### 3.6 和 `cc-mcp-bridge` 的协作边界

- 短期：
  - 两边继续独立推进
  - 不互相改目录
- 中期只共享：
  - routing key 语义
  - auth/logging/redaction 口径
  - server baseline 假设
- 当前职责拆分已经收口为：
  - `cc-official-broker`
    - `POST /auth/device`
    - `POST /sessions`
    - `WS /sessions/:id/stream`
    - `WS /runner/connect`
    - broker session truth
    - local runner / tool callback
  - `cc-mcp-bridge`
    - remote official runtime service
    - `POST /v1/chat/completions`
    - `POST /v1/responses`
    - `GET /v1/session_state`
    - `GET /v1/sessions`
    - `GET /v1/stats`
- 当前不在本项目重复建设：
  - 一整套新的 server-side chat service
  - 一整套新的 streaming/auth/logging 平台层
  - 另一套并列的 broker session 真相层

## 4. Session 语义

- `new session`
  - Broker 创建新的远端 `session_id`
  - 远端启动新的 `Claude` runtime
  - 默认绑定当前发起设备的 `Local Runner`
- `resume session`
  - 只恢复已有远端 session
  - 不新建 runtime
- `stop session`
  - 停止远端 runtime
- `transfer runner`
  - 显式把 session 的本地执行权切到另一台设备

硬约束：

- 一个 session 默认只允许一个 `active writer`
- 可以有多个 viewer，但不要双设备同时写
- 当前不要和别的项目争夺“唯一 session 真相源”
  - 本项目负责 broker session / local runner 这条线
  - 其他项目如有 sticky chat session，可以并存，但后续统一前不要混成同一层语义

## 5. `url + device_key` 的职责

`url + device_key` 只用于你的 Broker：

- `device` 鉴权
- 标记这台电脑是谁
- 统计每台电脑使用量
- 做 feature flag / quota / 灰度

它不是：

- 官方 `Claude OAuth`
- OpenAI-compatible API key
- `newapi / CRS` relay key

## 6. Usage Stats 建议口径

至少记录：

- `device_id`
- `session_id`
- `project_root`
- `input_tokens`
- `output_tokens`
- `tool_name`
- `tool_count`
- `bytes_read`
- `bytes_written`
- `bash_count`
- `latency_ms`
- `started_at / ended_at`

这样后续可以按：

- 设备
- 项目
- session
- 工具类型

做优化。

## 7. 最小接口

在进入 endpoints 前，当前先固定一层最小 auth/logging baseline，避免后面各端字段再漂移：

- steady-state auth 首选 `Authorization: Bearer <token>`
- `x-api-key` 仅保留 compatibility，不要求与 `Bearer` 同时存在
- `device_key` 继续用于 broker bootstrap / `POST /auth/device`
- request routing 统一带：
  - `owner_user_id`
  - `device_id`
  - `workspace_id`
  - `session_id`
  - `runner_key`
  - `session_key`
- 最小 request logging 只记录：
  - `request_id`
  - `source`
  - `target_model`
  - `duration_ms`
  - `ok`
  - `status`
  - `error`
  - `routing`
- 明确不落日志：
  - prompt body
  - file content
  - response body
  - bearer token / api key / device key
- 默认值注意：
  - 本项目当前本地默认 `workspace_id = personal`
  - 如果和默认 `company` 的其他服务联调，必须显式传 `workspace_id`

### 7.1 Device Auth

```text
POST /auth/device
```

用途：

- `device_key` 换 broker access token
- 默认由本地 `MMS` 先调用

建议最小请求体：

```json
{
  "routing": {
    "owner_user_id": "xin",
    "device_id": "mac",
    "workspace_id": "company",
    "runner_key": "xin:mac:company"
  },
  "auth": {
    "device_key": "<device-key>",
    "preferred_mode": "bearer"
  },
  "client": {
    "name": "mms",
    "version": "0.1.0"
  },
  "meta": {
    "request_id": "uuid",
    "requested_at": "iso8601",
    "source": "cc-official-broker:mms"
  }
}
```

### 7.2 Create Session

```text
POST /sessions
```

用途：

- 新建远端 `Claude` session
- 默认由本地 `MMS` 调用
- 先只处理我们自己的 create/resume 语义，不兼容别的 relay 路线

建议最小请求体：

```json
{
  "routing": {
    "owner_user_id": "xin",
    "device_id": "mac",
    "workspace_id": "company",
    "runner_key": "xin:mac:company"
  },
  "session": {
    "mode": "create",
    "bind_runner": true,
    "client_session_id": "draft-session",
    "project_root": "/path/to/project",
    "initial_goal": "string",
    "initial_prompt": "string"
  },
  "client": {
    "name": "mms",
    "version": "0.1.0"
  },
  "meta": {
    "request_id": "uuid",
    "requested_at": "iso8601",
    "source": "cc-official-broker:mms"
  }
}
```

### 7.3 Session Stream

```text
WS /sessions/:id/stream
```

用途：

- 双向 stream
- 传用户输入、模型输出、tool event
- 默认由本地 `MMS` 维持

当前本地 stub 已验证的最小事件：

- `session.ready`
- `session.input`
- `session.input.ack`
- `session.output`

当前还提供最小 session inspect：

```text
GET /sessions/:id
```

返回目标：

- 不暴露完整 prompt/history
- 只返回联调最需要的状态面：
  - `status`
  - `stream_connected`
  - `runner_attached`
  - `runner_capability`
  - `active_tool_call`
  - `last_input_preview`
  - `last_output_preview`

### 7.4 Runner Connect

```text
WS /runner/connect
```

用途：

- 本地 `Local Runner` 主动回连
- 接收 tool call，返回 tool result
- 第一阶段最小协议先只固定：
  - `runner.register`
  - `runner.registered`
  - `runner.heartbeat`
- 第一阶段 capability 先固定为 read-only：
  - `pwd`
  - `git_status`
  - `read_file`
  - `search`
- `writable_scope` 默认先固定为 `none`
- broker 必须尊重 runner advertise 的 capability，不要假定所有 runner 都支持 write / patch / bash

### 7.5 Usage Heartbeat

```text
POST /usage/heartbeat
```

用途：

- 上报设备/session/tool 统计

## 8. 最小落地顺序

### Phase 1

- 先做 `Broker`
- 先做 `device auth`
- 先做 `runner register / heartbeat`

### Phase 2

- 先只开放 read-only tools：
  - `pwd`
  - `git_status`
  - `read_file`
  - `search`
- 先让 broker 和 runner 可以分开常驻联调：
  - `broker:serve`
  - `runner:serve`
  - `session:prompt`
  - `session:inspect`

### Phase 3

- 接入远端真实 `Claude OAuth session`
- 打通：
  - `new`
  - `resume`
  - `stop`
  - `stream`

### Phase 4

- 再放开：
  - `write_file`
  - `apply_patch`
  - 更广义 `exec`

## 9. Hive Discuss 收敛结论

`2026-04-05` 已用 `hive-discuss` 让：

- `kimi-k2.5`
- `glm-5.1`
- `mimo-v2-pro`

讨论本方案。

共同结论：

- 方向应选：`Broker + Remote Session + Local Runner`
- 不应回退到 `API relay` 路线
- `Local Runner` 应主动回连 `Broker`
- transport 应优先选 `WebSocket`

补充说明：

- 本轮 `qwen` 路由失败，不构成否决信号
- 后续再跑 multi-model discuss 时，若 `qwen` 不可用，应自动降级到其他已可用模型

## 10. 当前默认结论

如果现在就开始做 MVP，默认按下面版本推进：

```text
official OAuth on server
+ broker(url + device_key)
+ websocket local runner
+ local tool execution
+ per-device usage stats
```

这就是当前建议的主线实践方案。

## 11. Direction Revision 2026-04-05

本轮对 `MMS` 语义做了明确修订：

- `MMS` 指真实的 `multi-model-switch`
- 不是抽象的 client 占位词
- broker 可以在 `MMS` 中以特殊 endpoint/profile 形态出现
- 但正式实现时不能把它误接成普通 provider relay
