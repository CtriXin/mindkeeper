# Server 联调清单

这份清单是给 `cc-official-broker` 和服务器端 runtime service 联调用的。

一句话先说结论：

- 这一轮不要让服务器端重做 broker；只需要提供稳定的 unified `base_url + API key` remote runtime service，broker 来消费它。

## 1. 职责边界先锁死

### `cc-official-broker` 继续负责

- `POST /auth/device`
- `POST /sessions`
- `GET /sessions/:id`
- `WS /sessions/:id/stream`
- `WS /runner/connect`
- broker session truth
- local runner / tool callback
- 本地 `device/workspace/session` 隔离

### 服务器端 runtime service 继续负责

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/session_state`
- `GET /v1/sessions`
- `GET /v1/stats`
- remote official runtime
- remote sticky / usage / logging / redaction

### 当前明确不做

- 不让服务器端再实现一套并列的 broker `/auth/device` 或 `/sessions`
- 不让 broker 里重复建设完整 chat/auth/logging service
- 不把 `device_key` 当成 official auth 字段往服务器上传

## 2. 这一轮要对齐的最小 contract

### 2.1 unified `base_url`

- broker 侧配置一个 remote service base URL，例如：
  - `http://82.156.121.141:18081`
- broker 当前会自己拼这些 path：
  - `/v1/chat/completions`
  - `/v1/responses`
  - `/v1/session_state`
  - `/v1/stats`

### 2.2 auth

- broker -> server steady-state：
  - `Authorization: Bearer <api-key>`
- 可选兼容：
  - `x-api-key: <api-key>`
- `device_key` 只留给：
  - `MMS/local client -> broker -> POST /auth/device`
- 不要要求 broker 调 server 时同时带 `Bearer + device_key`
- 不要再把这层 `Bearer` 视为临时 shared secret；现在按长期可管理 API key 理解

当前 broker 侧配置仍保持：

```bash
CC_BROKER_REMOTE_SERVICE_BASE_URL=http://82.156.121.141:18081
CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN=sk_live_xxxxx
```

这里的 `CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN`，语义上就是 server 侧发的长期 API key。

### 2.3 routing 语义

统一字段名，不再发明别名：

- `owner_user_id`
- `device_id`
- `workspace_id`
- `session_id`
- `runner_key`
- `session_key`

统一语义：

- `runner_key = owner_user_id:device_id:workspace_id`
- `session_key = runner_key:session_id`

当前 broker 发到 server 的最小稳定 routing 面，已经在 `metadata` 里：

```json
{
  "metadata": {
    "owner_user_id": "xin",
    "device_id": "mac",
    "workspace_id": "personal",
    "session_id": "dst-0406-demo",
    "source": "cc-official-broker:broker"
  }
}
```

本轮要求：

- server 至少正确消费 `metadata.owner_user_id/device_id/workspace_id/session_id`
- 如需 `runner_key/session_key`，优先按同一语义自行推导
- 如果后面 broker 显式补发 `runner_key/session_key`，server 直接接受，不要改名字
- 联调时显式传 `workspace_id`，不要依赖默认值

说明：

- 当前 `cc-official-broker` 默认 `workspace_id` 更接近 `personal`
- 另一侧如果默认是 `company`，很容易把“默认值不一致”误判成 session 串味
- key 负责 auth / usage / audit
- routing 负责 session sticky / device-workspace 隔离
- 不靠 key 决定 sticky session
- 不把 `device_id/workspace_id/session_id` 编进 key

### 2.4 session truth

- broker 继续是本地入口这一层的 session truth
- server 继续是 remote sticky/runtime 这一层的 truth
- 两边这轮通过同一个 routing 语义粘住，不去争“唯一全局真相源”

更白话一点：

- 本地是谁、哪个 workspace、这次会话是谁：broker 说了算
- 远端 sticky 到哪个 official runtime / remote session：server 说了算

### 2.5 logging / redaction

日志至少保留：

- `key_id`
- `key_prefix`
- `request_id`
- `source`
- `endpoint`
- `status`
- `duration_ms`
- `routing`
- `usage`
- `cost_usd`
- `rate_limit_info`

日志默认不落：

- prompt body
- `files[].content`
- 完整 answer 正文
- 明文 API key
- `Bearer token`
- `x-api-key`
- 任何 secrets

补一句：

- server 侧后续即使做 key registry / key 管理页，也属于 server 内部能力，不是 broker 首轮接入 blocker

## 3. server 需要满足的最小接口

### 3.1 `POST /v1/responses`

broker 当前会发：

```json
{
  "model": "claude-opus-4-6",
  "input": "hello",
  "metadata": {
    "owner_user_id": "xin",
    "device_id": "mac",
    "workspace_id": "personal",
    "session_id": "dst-0406-demo",
    "source": "cc-official-broker:broker"
  }
}
```

broker 当前最少会读取这些返回字段：

```json
{
  "id": "resp_xxx",
  "output": [
    {
      "type": "message",
      "content": [
        {
          "type": "output_text",
          "text": "answer"
        }
      ]
    }
  ],
  "previous_response_id": "optional",
  "cc_meta": {
    "meta": {
      "remote_session_id": "remote_xxx",
      "reused_remote_session": true
    },
    "usage": {
      "input_tokens": 1,
      "output_tokens": 2,
      "total_tokens": 3
    },
    "cost_usd": 0.000123
  }
}
```

### 3.2 `POST /v1/chat/completions`

broker 当前会发：

```json
{
  "model": "claude-opus-4-6",
  "messages": [
    {
      "role": "user",
      "content": "hello"
    }
  ],
  "metadata": {
    "owner_user_id": "xin",
    "device_id": "mac",
    "workspace_id": "personal",
    "session_id": "dst-0406-demo",
    "source": "cc-official-broker:broker"
  }
}
```

broker 当前最少会读取这些返回字段：

```json
{
  "id": "chatcmpl_xxx",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "answer"
      }
    }
  ],
  "cc_meta": {
    "meta": {
      "remote_session_id": "remote_xxx",
      "reused_remote_session": true
    },
    "usage": {
      "input_tokens": 1,
      "output_tokens": 2,
      "total_tokens": 3
    },
    "cost_usd": 0.000123
  }
}
```

### 3.3 `GET /v1/session_state`

broker 会这样查：

```text
GET /v1/session_state?device_id=mac&workspace_id=personal&session_id=dst-0406-demo
```

建议最小返回：

```json
{
  "ok": true,
  "session": {
    "remote_session_id": "remote_xxx",
    "session_summary_items": 3,
    "last_user_preview": "trimmed",
    "last_answer_preview": "trimmed"
  }
}
```

### 3.4 `GET /v1/sessions`

这条不是当前 broker prompt 主链路 blocker，但建议 ready。

最少建议支持按这些 query 过滤：

- `device_id`
- `workspace_id`
- `limit`

### 3.5 `GET /v1/stats`

这条主要给排障和 usage 面板，不是首轮 prompt blocker，但建议 ready。

最少建议支持：

- `window`
- `limit`
- `endpoint`

## 4. 推荐联调顺序

### Step 1：先只验证 remote service

- 用固定 `base_url + API key`
- 手工 `curl` 打：
  - `POST /v1/responses`
  - `GET /v1/session_state`
- 先不碰 runner / tool callback
- broker 这边也可以直接跑：

```bash
npm run remote:doctor
```

它会直接验证当前配置的 `base_url + API key`、两次 prompt sticky 和 `session_state`。

通过标准：

- 同一组 `device_id + workspace_id + session_id` 连续两次请求能复用同一个 remote session
- 返回里能拿到 `cc_meta.meta.remote_session_id`
- `usage/cost` 至少有最小结构
- server 日志或 stats 能按 key 归因

### Step 2：broker 接真实 server

broker 侧环境变量对齐：

```bash
export CC_BROKER_REMOTE_SERVICE_BASE_URL=http://82.156.121.141:18081
export CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN=sk_live_xxxxx
export CC_BROKER_REMOTE_SERVICE_ENDPOINT=responses
```

通过标准：

- `POST /sessions` 后，broker 内部普通 prompt 不再走本地 mock
- `GET /sessions/:id` 能看到 `remote_session_state`
- 同一 session 连续 prompt，`remote_service.reused_remote_session` 为真

### Step 3：再补 chat / stats / sessions

- 如果 `responses` 已稳定，`chat/completions` 只是兼容层，不必卡主线
- `stats` 和 `sessions` 主要用于可观测性，不要反过来阻塞主链路

## 5. 不要踩的坑

- 不要让 server 再发明一套 broker session id
- 不要在两边出现两套不同的 routing 字段名
- 不要把 `device_key` 上传到 remote runtime service
- 不要把 key 当成 sticky session 主键
- 不要把机器名 / workspace / runtime id 编进 key 本体
- 不要把默认 `workspace_id` 不一致误判成串会话
- 不要把 logging 需求扩成“记录 prompt/file content”

## 6. 联调完成的最低验收线

- broker 能稳定消费 server 的 `/v1/responses` 或 `/v1/chat/completions`
- 同一 `session_id` 能在 server 侧 sticky 复用
- broker inspect 能拿到 `remote_session_state`
- server 能按 key 看 usage / requests / cost 的归因
- auth/logging/redaction 口径没有分叉
- 不需要 server 额外实现一套 broker protocol

## 7. 可以直接发给对方的最短版本

```text
这轮联调的最小目标不是让你那边重做 broker，而是让 cc-official-broker 直接消费你现在已有的 remote runtime service。

请先保证这几件事：
1. 提供稳定 unified base_url，例如 http://82.156.121.141:18081
2. steady-state 鉴权统一用 Authorization: Bearer <api-key>
3. key 只负责 auth / usage / audit，不负责 routing
4. 接受 metadata.owner_user_id/device_id/workspace_id/session_id
5. 同一组 device_id + workspace_id + session_id 要 sticky 到同一个 remote session
6. 至少提供：
   - POST /v1/responses
   - GET /v1/session_state
   - 可选再补 POST /v1/chat/completions / GET /v1/sessions / GET /v1/stats
7. 日志不要记录 prompt body / file content / secrets

broker 这边继续负责：
- POST /auth/device
- POST /sessions
- WS /sessions/:id/stream
- WS /runner/connect
- broker session truth
- local runner

也就是：
你那边做 remote official runtime service，
我这边做 broker + MMS 接线，
先不要把两个项目揉成一套。
```
