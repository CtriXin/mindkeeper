# cc-official-broker

单用户、双设备的 `official cc remote broker` 实验目录。

当前目标：

- 以服务器上的官方 `Claude Code` 作为稳定 runtime
- 以本地 `multi-model-switch (MMS)` 作为使用入口
- 通过 `Broker + Local Runner` 保留本地 `bash/search/read/write`
- 每台设备通过 `url + device_key` 被识别和统计
- 严格隔离 `mac/macmini` 与 `company/personal`

## 当前状态

- server-side official `cc` baseline: ready
- auth: ready
- egress: locked to `168.158.184.72`
- auth/logging baseline: aligned with `cc-mcp-bridge/docs/BRIDGE_AUTH_LOGGING_SPEC.md`
- local stub milestone: `auth + sessions + session stream + runner connect` ready
- local tool routing milestone: `tool.call + tool.result` ready for read-only demo tools
- first MMS entry milestone: `mms broker run <profile>` can now launch a minimal broker shell
- broker/service milestone: non-tool prompts can now be forwarded to a `cc-mcp-bridge`-style remote official runtime service
- resume/observability milestone: broker shell now remembers the last local session per project scope and can surface remote usage/cost hints inline
- official entrypoint milestone: local official `claude` binary can now be resolved and its reusable `--sdk-url` child launch contract can be inspected directly
- official child mock milestone: this repo can now launch the real local official `claude` binary against a local mock session-ingress host for protocol smoke tests
- broker session-ingress milestone: broker stub now returns a per-session `sdk_url + access_token` contract and can accept a real local official `claude` child on `/v2/session_ingress/...`
- next: replace more of the stub path with real broker-backed streaming, then swap from debug shell toward a real official child path where possible

## 当前完成度

- 从方向收口看：已经过半，而且主思路是对的
- 从“已经能稳定日用”看：还在中间态，重点剩在更真实的 remote session / stream / resume 稳定化
- 现在最接近的判断是：
  - 方向和边界：已基本成立
  - 最终体验：还在继续补强

## 目录

- `docs/SERVER_CC_USAGE.md`：服务器 `cc` baseline 使用方法
- `docs/PRACTICE_PLAN.md`：当前主线实践方案
- `docs/MMS_BROKER_INTEGRATION_BRIEF.md`：`MMS` 侧如何把 broker 当作特殊 endpoint/profile 接入
- `docs/AGENT_ALIGNMENT_CHECKLIST.md`：给另一个 agent 对齐的冲突检查清单
- `docs/OFFICIAL_CODE_FINDINGS.md`：官方 `Claude Code` 源码里能直接确认的 remote/session/auth 结论
- `docs/OFFICIAL_CC_ENTRYPOINT_PLAN.md`：现在到底该怎么复用真正 official `cc`，以及为什么当前最现实的是 headless `--sdk-url` 路径
- `docs/TELEMETRY_BOUNDARY.md`：本地 `MMS`、broker、远端 official runtime 三层 telemetry 边界
- `src/`：本地 skeleton

当前本地源码 reference：

- `/Users/xin/Downloads/src`

## 当前共识

当前主线是：

```text
multi-model-switch(local)
  -> Broker endpoint/profile(url + device_key)
  -> Remote Claude Session(server, real official OAuth)
  -> Local Runner(local bash/search/read/write)
```

不是：

- `newapi/CRS` relay
- `ssh/tmux` shared shell
- 本地官方账号直启

## 当前 auth/logging 基线

- steady-state auth 首选 `Authorization: Bearer <token>`
- `x-api-key` 只做 compatibility，不要求与 `Bearer` 同时出现
- `device_key` 继续保留给 broker bootstrap / device auth
- routing 统一带：
  - `owner_user_id`
  - `device_id`
  - `workspace_id`
  - `session_id`
  - `runner_key`
  - `session_key`
- request logging 只保留最小 meta，不记录 prompt body、file content 或任何 secret

## 当前 MMS 入口边界

- 这里的 `MMS` 明确指 `multi-model-switch/` 项目本体
- `MMS` 只负责本地入口、选择 profile、启动 `cc`
- broker 在 `MMS` 里可以长得像一个特殊 endpoint/profile
- 但它内部不是普通 provider relay，而是 broker session flow
- 当前建议的本地顺序：
  - `POST /auth/device`
  - `POST /sessions`
  - `WS /sessions/:id/stream`
  - `WS /runner/connect`
- 当前 CLI 已能直接打印：
  - `auth:device`
  - `broker:profile`
  - `broker:serve`
  - `demo:flow`
  - `demo:local`
  - `demo:mms:mock`
  - `demo:tool`
  - `mms:run`
  - `official:doctor`
  - `official:attach`
  - `official:connect`
  - `official:broker`
  - `official:mock`
  - `runner:serve`
  - `session:create`
  - `session:inspect`
  - `session:last`
  - `session:prompt`
  - `session:resume`
  - `runner:register`
  - `runner:heartbeat`
- 当前也已经能直接本地跑一条最小 stub 链路：
  - `npm run demo:local -- dst-0405-ms30qm create`
  - `npm run demo:local -- dst-0405-ms30qm resume`
- 当前这条 local demo 已覆盖：
  - `POST /auth/device`
  - `POST /sessions`
  - `WS /sessions/:id/stream`
  - `WS /runner/connect`
- 当前也新增了一条专门给真实 server `url + key` 联调的探针：
  - `npm run remote:doctor`
  - 它会直接用当前配置的：
    - `CC_BROKER_REMOTE_SERVICE_BASE_URL`
    - `CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN`
  - 去探测：
    - `/healthz`
    - `/v1/models`
    - 两次真实 prompt
    - `/v1/session_state`
    - `/v1/stats`
  - 然后明确告诉你：
    - auth 是否通
    - prompt 是否通
    - sticky 是否成立
    - `remote_session_id` 是否一致
  - 这条命令就是给“统一 URL + multi-key”联调准备的，不需要先走 broker shell
- 当前 remote service 调用也已经带超时保护：
  - 默认 `CC_BROKER_REMOTE_SERVICE_TIMEOUT_MS=90000`
  - 超时后会直接报清楚：
    - `remote service request timed out after ...ms`
  - 不再只剩一个模糊的 `fetch failed`
- 当前也补了一次轻量 retry：
  - 如果是瞬时网络断连 / `fetch failed` / `ECONNRESET`
  - broker 会自动再试一次
- `/tool rg ...` 现在已直接作为 `/tool search ...` 的 alias 支持
- 而且支持更像真 `rg` 的写法：
  - `/tool rg "remote:doctor" src`
- 如果你现在想直接进 `MMS` 体验真实 live，而不是只看 doctor：
  - 先设置：
    - `CC_BROKER_REMOTE_SERVICE_BASE_URL`
    - `CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN`
  - 然后直接运行：
    - `npm run demo:mms:live`
  - 它会：
    - 临时起一个本地 broker stub
    - 把普通 prompt 转发到真实 `cc-mcp-bridge`
    - 自动生成临时 MMS broker profile
    - 直接把你带进真实 `mms_broker.py -> mms:run` 入口
  - 不会改你的全局 `~/.config/mms/config.toml`
  - 如果想续上上一次这个 demo 的本地 session 记录：
    - `npm run demo:mms:live -- resume-last`
- 如果你现在想从 demo 走向“固定 profile 的长期用法”：
  - 先看准备好的正式 profile：
    - `npm run mms:profile:print`
  - 如果你确认要写入某个 `config.toml`：
    - `npm run mms:profile:install`
  - profile 写好后，本地 broker 可以直接按真实 profile 启：
    - `npm run broker:live`
  - 这个命令会直接读取：
    - `~/.config/mms/config.toml`
    - `~/.config/mms/credentials.sh`
  - 默认启动的 profile 是：
    - `official-broker-personal`
  - 现在推荐这个 profile 默认写成：
    - `entry_mode = "official_connect"`
  - 也就是说：
    - `MMS` 会先通过 SSH 从远端 runtime 同步 `.claude.json + .credentials.json`
    - 然后以独立 `CLAUDE_CONFIG_DIR` 直接拉起本机官方 `Claude Code` UI
  - 默认目标是：
    - `~/.config/mms/config.toml`
  - 它会写入/更新一个固定的 `[[broker_profiles]]`
  - 这一步只写 profile 元数据，不会把 secret 明文写进 config
  - secret 通过环境变量读取：
    - `MMS_BROKER_DEVICE_KEY_*`
    - `MMS_REMOTE_SERVICE_TOKEN_*`
- 当前也已能验证一条最小 tool bridge：
  - broker 下发 `tool.call`
  - local runner 执行 `pwd/git_status/read_file/search`
  - runner 回传 `tool.result`
  - session stream 收到回灌后的 `session.output`
- 当前也能把 broker 和 runner 分开常驻起来做手动联调：
  - Terminal A: `node src/index.mjs broker:serve 127.0.0.1 8788`
  - Terminal B: `CC_BROKER_BASE_URL=http://127.0.0.1:8788 CC_BROKER_DEVICE_KEY=demo-device-key node src/index.mjs runner:serve`
  - Terminal C: `CC_BROKER_BASE_URL=http://127.0.0.1:8788 CC_BROKER_DEVICE_KEY=demo-device-key node src/index.mjs session:prompt dst-0405-ms30qm create /tool pwd`
- 当前也能查询 session snapshot：
  - `CC_BROKER_BASE_URL=http://127.0.0.1:8788 CC_BROKER_DEVICE_KEY=demo-device-key node src/index.mjs session:inspect dst-0405-ms30qm`
- 当前也有第一版 MMS 真实入口：
  - 在 `multi-model-switch` 的 `config.toml` 里加 `[[broker_profiles]]`
  - 然后在项目目录执行：`mms broker run official-broker-personal`
  - 如果 profile 指向的是本地 `127.0.0.1` broker，`mms broker run` 现在也会先自动探测并拉起本地 broker
  - 进入后可直接输入 prompt，或输入 `/tool pwd` 体验本地 runner 回灌
  - 如果你想在这个 `B` 入口里直接测真实 official child，现在可以输入：
    - `/official`
    - 或 `/official 你的测试 prompt`
  - 如果想续上当前项目最近一次会话，可直接执行：`mms broker run official-broker-personal --resume-last`
- 如果你现在只是想先体验，不想改自己的全局 `~/.config/mms/config.toml`：
  - 直接运行：`npm run demo:mms:mock`
  - 下一次想续上这个 mock 会话，可运行：`npm run demo:mms:mock -- resume-last`
  - 它会临时拉起：
    - 一个 mock remote runtime
  - 一个本地 broker stub
  - 一个沙盒化的 MMS broker profile launcher
  - 然后自动进入真实的 `mms_broker.py -> mms:run` 入口，不会改你的全局 `MMS` 配置
- 如果你现在想直接体验“能干活的本地 worker”，也已经有一条单独入口：
  - `npm run demo:mms:worker`
  - 它会基于 mock remote 自动启用：
    - `bash`
    - `write_file`
    - `apply_patch`
    - `runner_writable_scope = workspace`
  - 进 shell 后最直接的三条感受式输入就是：
    - `/tool bash echo worker`
    - `/tool write_file {"path":"demo.txt","content":"worker wrote this"}`
    - `/tool apply_patch {"path":"demo.txt","search":"wrote","replace":"patched"}`
- 如果你想把这个体验直接切到真实远端主脑，而不是 mock：
  - `npm run demo:mms:worker-live`
  - 它会复用当前 live remote service 配置，只是额外把本地 worker v1 写能力打开
- 如果你要把这套 worker 能力正式装进 `MMS` 的长期 profile，也已经有单独入口：
  - `npm run mms:profile:install-worker`
  - 它会安装一个单独的 worker profile，默认 id 形如：
    - `official-broker-worker-personal`
  - 这条 profile 默认保持：
    - `entry_mode = "shell"`
    - `runner_tools = [pwd, git_status, read_file, search, bash, write_file, apply_patch]`
    - `runner_writable_scope = "workspace"`
- 当前 session snapshot 会返回最小状态：
  - `status`
  - `stream_connected`
  - `runner_attached`
  - `runner_capability`
  - `active_tool_call`
  - `last_input_preview`
  - `last_output_preview`
- 当前 broker shell 也会把最近一次本地记住的 session 存到：
  - `~/.config/cc-official-broker/session-registry.json`
  - 作用域是 `owner_user_id + device_id + workspace_id + project_root`
  - 这样下一次从同一个项目进来时，可以直接 `--resume-last`
- 当前如果普通 prompt 走了 remote service，shell 会顺带直接显示：
  - `remote_session_id`
  - `response_id`
  - `usage input/output/total`
  - `cost_usd`
- 当前 local demo 里的 websocket query `access_token` 只是 stub 简化写法，不代表最终正式口径
- 当前也已经补了一份 official 入口探针：
  - `npm run official:doctor`
  - 它会直接告诉你：
    - 本机 `claude` binary 在哪
    - 当前版本
    - 现在最值得复用的 official 入口是哪条
    - 一份可复用的 `claude --print --sdk-url ...` 启动 contract
- 这一步的意义不是说已经打通完整 official TUI，而是先把“以后怎么换成真正 official child”固定下来
- 当前也已经能做一条最小 official child smoke test：
  - `npm run official:mock`
  - 这会直接起本机真正的 `claude --print --sdk-url ...`
  - 再连到本仓库自带的本地 mock session-ingress host
  - 如果本机 official `claude` 没登录，你会直接看到：
    - `protocol_ok_auth_missing`
    - `Not logged in · Please run /login`
  - 这说明“official child 启动 + sdk-url 协议联调”已经通了，只是本机 local auth 还没满足
- 当前 broker 自己也已经能给出一份真正可用的 `url + token`：
  - `npm run official:broker`
  - 这条命令会临时拉起本地 broker stub
  - 先走一次：
    - `POST /auth/device`
    - `POST /sessions`
  - 然后 broker 在 session create 响应里返回：
    - `official_child.sdk_url`
    - `official_child.access_token`
  - 再把真实本机 official `claude --print --sdk-url ...` 接上去
  - 如果你看到：
    - `protocol_ok_auth_missing`
  - 意味着现在不只是 mock host 协议通了，而是 broker 自己也已经能产出那份 session-ingress contract
- 如果你已经有一个正在跑的 broker（无论是本地 stub 还是后面的真实 server adapter），现在也可以直接：
  - `CC_BROKER_BASE_URL=... CC_BROKER_DEVICE_KEY=... npm run official:attach`
  - 它会直接复用 broker 返回的：
    - `official_child.sdk_url`
    - `official_child.access_token`
  - 再拉起本机真实 official child 去 attach
- 这也意味着 `MMS` 侧现在已经有一条最小可测入口：
  - `mms broker smoke <id>`
  - 它本质上就是用 profile 里的 `broker_base_url + device_key` 去调用这条 `official:attach`
- 当前也已经补了一条更接近最终体验的 direct-connect 路：
  - `CC_BROKER_BASE_URL=... CC_BROKER_DEVICE_KEY=... npm run official:connect`
  - broker stub 现在能直接兼容：
    - `POST /sessions` direct-connect create shape (`{ cwd, dangerously_skip_permissions? }`)
    - `WS /v2/direct_connect/ws/:id`
  - 这条路返回的是 `system/init + assistant + result`，不再是 broker shell / debug JSON
  - 当前这台机器的真实卡点已经收口为：
    - 本机 `Claude Code` 已经能走 `cc://` / `open <cc-url>` 这条 direct-connect 路
    - 本机原生 login gate 现在通过“远端 auth bundle -> 本机临时 `CLAUDE_CONFIG_DIR`”这条线绕开
  - 所以现在的默认策略已经不是固定回 shell
  - 而是：
    - profile 默认走 `official_connect`
    - 只有远端 auth bundle 不可用时，才考虑回退到 shell
  - 这条线仍然复用远端真实 official runtime，不是伪造 local login
- 所以如果你问“现在进 B 到底测什么”，最直接的就是两件事：
  - `/tool pwd`：看本地 runner 回灌
  - `/official`：看 broker 是否真能把官方 child attach 上来
- 当前 runner 默认是 read-only capability：
  - `pwd`
  - `git_status`
  - `read_file`
  - `search`
  - `writable_scope = none`
- 当前 runner 也已经补上了可选的 worker v1 执行能力，但默认不自动开启：
  - `bash`
  - `write_file`
  - `apply_patch`
- 开启方式仍然走现有 profile / env：
  - `CC_BROKER_RUNNER_TOOLS=pwd,git_status,read_file,search,bash,write_file,apply_patch`
  - `CC_BROKER_RUNNER_WRITABLE_SCOPE=workspace`
  - 或在 `[[broker_profiles]]` 里显式写 `runner_tools` / `runner_writable_scope`
- 当前 worker v1 的最小写能力 contract 是：
  - `bash`：`{ command, timeout_ms? }`
  - `write_file`：`{ path, content, append? }`
  - `apply_patch`：`{ path, search, replace, replace_all? }`
  - 或 `apply_patch` 也可以用：`{ operations: [{ path, search, replace, replace_all? }] }`
- 当前 `bash/write_file/apply_patch` 都会尊重 `workspace_root + writable_scope`：
  - `writable_scope = none` 时拒绝写能力
  - `writable_scope = workspace` 时允许写整个 workspace
  - 也支持相对路径列表，例如：`src,docs`

## 当前对齐边界

- 短期继续和 `cc-mcp-bridge` 并行推进，不互相改目录
- 中期只共享三类基础口径：
  - routing key 语义
  - auth/logging/redaction 口径
  - server baseline 假设
- 当前职责拆分进一步收口为：
  - `cc-official-broker` 负责 broker protocol / broker session truth / local runner
  - `cc-mcp-bridge` 负责 remote official runtime service
- 当前默认 `workspace_id` 是 `personal`，联调时建议显式设置 `CC_BROKER_WORKSPACE_ID`
- 这里不重复做一套完整的 server-side chat/stream/auth/logging 服务层，而是继续聚焦 `Broker + Local Runner`

## 当前 service adapter

如果配置了下面这些环境变量：

- `CC_BROKER_REMOTE_SERVICE_BASE_URL`
- `CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN` 或 `CC_BROKER_REMOTE_SERVICE_X_API_KEY`
- 可选：`CC_BROKER_REMOTE_SERVICE_ENDPOINT=responses|chat.completions`
- 可选：`CC_BROKER_REMOTE_SERVICE_MODEL=claude-opus-4-6`

现在如果你从 `MMS` 的 `broker_profiles` 启动，也可以直接在 profile 里声明这些目标：

- `remote_service_label`
- `remote_service_base_url`
- `remote_service_endpoint`
- `remote_service_model`
- `remote_service_bearer_token_env` 或 `remote_service_api_key_env`

那么当前 broker 行为会变成：

- 普通 prompt
  - broker 继续持有 session truth
  - 但实际回答会转发给远端 service（例如 `cc-mcp-bridge` 的 `/v1/responses`）
- `/tool ...`
  - 仍然优先走本地 runner
  - 不会绕到远端 service

这意味着当前已经进入一个更真实的中间态：

```text
MMS/local shell
  -> cc-official-broker
     -> normal prompt -> remote service
     -> tool prompt   -> local runner
```

## 关于 `url + device_key`

- `url + device_key` 是我们 broker 自己的接入层设计
- 它负责 device identity、usage stats、workspace 隔离、runner 绑定
- 它不是 official `Claude.ai OAuth`
- 它也不是在“伪装 official protocol”
- 当前如果 broker 后面接的是远端 official runtime service，那么真实的 auth、session、org 语义仍然在远端成立

如果想快速统一认知，先看：

- `docs/OFFICIAL_CODE_FINDINGS.md`
