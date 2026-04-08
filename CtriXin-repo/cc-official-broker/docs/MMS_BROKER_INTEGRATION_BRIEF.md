# MMS Broker Integration Brief

## 1. 这份文档解决什么问题

这份文档只回答一件事：

- `cc-official-broker` 将来如何接进真实的 `multi-model-switch (MMS)`

避免误解：

- 这里的 `MMS` 不是抽象 client
- 它就是仓库 `multi-model-switch/` 里的真实本地入口产品

## 2. 最短结论

对用户来说，这条能力可以表现成：

- 一个特殊的 broker `endpoint/profile`
- 在 `MMS` 里被显式选择
- 选中后照常启动 `cc`

但对运行时来说，它不是普通 provider relay，而是：

```text
MMS(local)
  -> broker endpoint/profile
  -> broker auth/session protocol
  -> remote official cc runtime(server)
  -> upstream Claude
```

同时工具链反向走：

```text
remote official cc
  -> broker
  -> local runner
  -> local repo/files/bash
```

## 3. 和普通 endpoint 一样的地方

- 都需要配置 `url`
- 都需要配置 `key`
- 都会在 `MMS` 里作为一个可选项出现
- 都可以按 `mac/macmini` 和 `company/personal` 拆开

## 4. 和普通 endpoint 不一样的地方

普通 provider endpoint 常见是：

```text
MMS -> provider endpoint -> model response
```

broker endpoint 实际是：

```text
MMS -> POST /auth/device
    -> POST /sessions
    -> WS /sessions/:id/stream
    -> WS /runner/connect
```

所以它看起来像 endpoint/profile，
但内部其实是 session-oriented protocol。

## 5. 推荐的 MMS 侧配置形态

建议先收口成显式的 broker profile：

```toml
[[broker_profiles]]
id = "official-broker-personal"
name = "Official Broker Personal"
enabled = true

broker_base_url = "https://broker.example.com"
device_key_env = "MMS_BROKER_DEVICE_KEY_PERSONAL"

owner_user_id = "xin"
device_id = "mac"
workspace_id = "personal"

remote_runtime = "official-claude-code"
remote_service_label = "server-mms-personal"
remote_service_base_url = "https://cc-service.example.com"
remote_service_endpoint = "responses"
remote_service_model = "claude-opus-4-6"
remote_claude_ssh_target_env = "CC_BROKER_REMOTE_CLAUDE_SSH_TARGET"
remote_claude_container_name_env = "CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME"
remote_claude_credentials_path_env = "CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH"
remote_claude_global_config_path_env = "CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH"
remote_service_bearer_token_env = "MMS_REMOTE_SERVICE_TOKEN_PERSONAL"
```

重点：

- `broker_base_url`
- `device_key_env`
- `device_id`
- `workspace_id`
- `remote_service_base_url`
- `remote_service_bearer_token_env`
- `remote_claude_ssh_target_env`
- `remote_claude_container_name_env`
- `remote_claude_credentials_path_env`
- `remote_claude_global_config_path_env`

补充：

- 这样一个 broker profile 就可以顺带绑定一个 server-side runtime target
- 后续如果你有多组远端 OAuth / 多个 server-side `MMS` 或 runtime service，可以直接靠切 profile 做早期测试
- 当前 live 成功配置里，healthy runtime `cc-static-1` 的 auth source 已经不是 `docker exec` 读取，而是 host-path：
  - `CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=''`
  - `CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json`
  - `CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.claude.json`
- `CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=''` 是显式 override，不是“没配”；live profile resolver 现在会保留空字符串，避免退回旧 container 名

## 6. 推荐的职责拆分

### MMS(local)

- 保存 broker profile
- 让用户显式选择 broker profile
- 启动 `cc`
- 发起 broker auth/create/resume
- 维护 session stream
- 在本地启动/托管 local runner

### Broker(server)

- `device` 鉴权
- `session` 注册与恢复
- usage / token 统计
- runner 路由
- remote official `cc` runtime 管理

### Remote official cc(server)

- 持有真实官方 `OAuth`
- 跑远端 session
- 调用 broker 提供的 tool bridge

### Local Runner(local)

- 真正执行：
  - `read_file`
  - `search`
  - `bash`
  - `write_file`
  - `apply_patch`
- 保持本地 repo / shell / 文件系统仍是执行现场

## 7. 最容易误解的一点

服务器上的 official `cc` 不会直接打开本地磁盘文件。

正确理解是：

```text
remote official cc 想读文件
-> broker 转发 tool call
-> local runner 在本地读文件
-> 返回结果给 remote official cc
```

所以这是：

- 远端大脑
- 本地手和文件现场

不是：

- 服务器直接挂载或直接访问本地 repo

## 8. 第一阶段不做什么

- 不做多用户共享
- 不做多 OAuth runtime pool
- 不把 broker 接成现有 default provider 路线
- 不影响当前 `MMS -> newapi -> CRS` 稳定链路

## 9. 第一阶段只验证什么

- `MMS` 能把 broker 当作一个特殊 profile 选中
- 选中后能启动 broker flow
- 远端 official `cc` 跑推理
- 本地 runner 跑工具
- `device/workspace/session` 隔离生效

## 10. 当前已落的最小入口

当前第一版不改 `provider/account` 主路径，而是先在 `MMS` 增加独立入口：

- `[[broker_profiles]]`
- `mms broker ls`
- `mms broker show <id>`
- `mms broker run <id>`
- `mms broker smoke <id>`

其中：

- `mms broker run <id>`
  - 会把选中的 broker profile 转成 `CC_BROKER_*` 环境变量
  - 然后拉起 `cc-official-broker` 的 `mms:run`
  - 当前是最小 line-based session shell，方便先验证真实 `MMS -> broker` 接线
  - 现在也支持：
    - `mms broker run <id> --session <sid> --resume`
    - `mms broker run <id> --resume-last`
- `mms broker smoke <id>`
  - 会直接复用 profile 里的 `broker_base_url + device_key`
  - 内部调用 `cc-official-broker` 的 `official:attach`
  - 用来验证：
    - broker 是否真的返回 `sdk_url + access_token`
    - 本机真实 official child 能否 attach 上去

这一步的目的不是完成最终 UI，而是先把用户真正能感知的 `MMS` 入口落下来。

如果当前只是想快速试体感，而不想碰自己的全局 `MMS` 配置：

- 直接在 `cc-official-broker/` 跑：
  - `npm run demo:mms:mock`
  - 如果想续上刚才那条 mock session：
    - `npm run demo:mms:mock -- resume-last`
- 这会临时创建一个 `MMS_CONFIG_DIR`，并自动挂上：
  - mock remote runtime
  - 本地 broker stub
  - `official-broker-demo` profile

所以它更像一个“沙盒试驾入口”，不是正式配置写入，也不会改你的全局 `~/.config/mms/config.toml`。

## 11. 当前 broker 后端的中间态

`cc-official-broker` 现在已经不只会返回本地 stub output。

如果配置了 remote service：

- `CC_BROKER_REMOTE_SERVICE_BASE_URL`
- `CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN` 或 `CC_BROKER_REMOTE_SERVICE_X_API_KEY`

那么：

- 普通 prompt
  - broker 会转发给远端 official runtime service
  - 当前优先兼容 `cc-mcp-bridge` 的 `/v1/responses`
- `/tool ...`
  - 仍然只走本地 runner

这让 broker 可以先在不放弃 session truth 的前提下，逐步把“回答能力”从 stub 切到真实远端 service。

## 12. 当前新增的可感知点

为了让这条链路更接近日用，而不是“一次性 demo”，当前又补了两层最小体验：

- broker shell 会把最近一次本地 session 记到：
  - `~/.config/cc-official-broker/session-registry.json`
- 记忆范围按：
  - `owner_user_id + device_id + workspace_id + project_root`
- 所以同一个项目里可以直接：
  - `mms broker run <id> --resume-last`
- 如果当前 prompt 实际命中了 remote service，shell 还会直接显示：
  - `remote_session_id`
  - `response_id`
  - `usage`
  - `cost_usd`

这几项虽然不改变主架构，但会明显改善“我现在到底连到哪儿了、能不能续聊、这次大概花了多少”的体感。
