# cc-official-broker Handbook

> 这是 `cc-official-broker/` 的项目追溯文档。
> 只追加，不覆盖；后续从这个目录重新开始时，先看这里。

## 当前大方向

当前主线固定为：

```text
MMS(local)
  -> Broker(url + device_key)
  -> Remote Claude Session(server, real official OAuth)
  -> Local Runner(local bash/search/read/write)
```

一句话：

- 远端是主能力
- 本地是执行现场
- `MMS` 指的是真实的 `multi-model-switch` 项目，不是抽象 client
- 不走 `newapi/CRS`
- 不走 `ssh/tmux` shared shell
- 不被 `cc-mcp-bridge` 的 `MCP-first` 路线牵着走

## 当前边界

- 当前项目是：
  - 单用户
  - 双设备
  - `mac/macmini` 隔离
  - `company/personal` 隔离
- 当前服务器 baseline 已成立：
  - host: `82.156.121.141`
  - entry: `cc-static`
  - official `Claude Code`: `2.1.92`
  - auth: first-party `claude.ai`
- 当前不做：
  - 多人共享
  - 复用 `newapi/CRS`
  - 直接改 `cc-mcp-bridge/` 主线
  - 为了兼容别的方案修改本项目主方向

## 和 `cc-mcp-bridge` 的关系

- `cc-mcp-bridge`：
  - 当前只做 `MCP-first`
  - 本地通过 `consult_opus` 向远端强模型做单轮咨询
- `cc-official-broker`：
  - 当前目标是更直接地使用远端能力
  - 后续是 `Broker + Local Runner` 路线

结论：

- 两条线并行
- 暂不互相改目录
- 如有共用底座，先对齐再合

## 当前已落地

- 独立项目目录已建立
- 主线实践文档已集中到：
  - `docs/PRACTICE_PLAN.md`
  - `docs/SERVER_CC_USAGE.md`
  - `docs/AGENT_ALIGNMENT_CHECKLIST.md`
  - `docs/SERVER_INTEROP_CHECKLIST.md`
- 本地 skeleton 已有：
  - `src/config.mjs`
  - `src/index.mjs`
  - `src/shared/sessionKeys.mjs`
  - `src/runner/deviceContext.mjs`
- 已补官方源码勘察结论：
  - `docs/OFFICIAL_CODE_FINDINGS.md`
- 当前本地 official source reference：
  - `/Users/xin/Downloads/src`
- 当前 `doctor` 已能提示缺失：
  - `CC_BROKER_BASE_URL`
  - `CC_BROKER_DEVICE_KEY`
- 当前 `remote:doctor` 已能直接探测：
  - `CC_BROKER_REMOTE_SERVICE_BASE_URL`
  - `CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN`
  - remote prompt round-trip
  - sticky 是否成立
  - `GET /v1/session_state` 是否可见
- 当前 remote service 请求也已有超时保护：
  - `CC_BROKER_REMOTE_SERVICE_TIMEOUT_MS`
  - 默认 `90000ms`
- 当前对瞬时网络错误也会自动 retry 一次，减少偶发 `fetch failed`
- 当前本地 demo 已能跑通：
  - `POST /auth/device`
  - `POST /sessions`
  - `WS /sessions/:id/stream`
  - `WS /runner/connect`
- 当前也已经有一条最短的 live MMS 体验入口：
  - `npm run demo:mms:live`
  - 用临时 broker profile 直连当前配置的 remote service
- 当前也已有把这条链路收成固定 MMS profile 的能力：
  - `npm run mms:profile:print`
  - `npm run mms:profile:install`
- 当前也补了一个正式 live 常驻入口：
  - `npm run broker:live`
  - 会直接读取真实 `~/.config/mms/config.toml + credentials.sh`
  - 默认按 `official-broker-personal` 起本地 broker stub
- 当前 `MMS broker run <profile>` 也已经补了两层体验收口：
  - 如果 profile 指向本地 `127.0.0.1` broker，会自动拉起本地 broker
  - `official_connect` 现在会先通过 SSH 同步远端 `claude.ai` auth bundle 到本机 `CLAUDE_CONFIG_DIR`
  - 同步成功后，`MMS` 可以直接进入本机 `Claude Code` 界面，而不是先落到 broker shell

## 下一步

1. 固化 broker 最小接口字段
2. 固化 local runner 注册/回连协议
3. 固化 official child launch contract，减少后续对 official `cc` 启动方式的猜测
4. 继续只在本目录推进
5. 任何可能影响 `cc-mcp-bridge` 的内容后上线

## Iteration 2026-04-05 17:18 +0800

- type:
  - context freeze
- decision:
  - 从现在开始，把 `cc-official-broker/` 视为独立主线
  - 继续沿着 `Broker + Local Runner` 方向推进
  - 不因另一条 `MCP-first` 路线改变当前大方向
- note:
  - 如果出现必须共用的底座，先对齐边界，再决定是否接线

## Iteration 2026-04-05 17:45 +0800

- type:
  - direction clarification
- decision:
  - `MMS` 在本项目中明确指 `multi-model-switch/` 这个真实本地产品
  - broker 在 `MMS` 里可以表现为一个特殊 `endpoint/profile`
  - 但其内部语义是 session-oriented broker protocol，不是普通 provider relay
- note:
  - 服务器上的 official `cc` 不直接访问本地文件
  - 本地文件/命令通过 `Broker -> Local Runner` 间接提供给远端 session

## Iteration 2026-04-05 19:05 +0800

- type:
  - coordination refinement
- decision:
  - 短期继续和 `cc-mcp-bridge` 并行推进，不互相改目录
  - 中期只共享 routing key、auth/logging/redaction、server baseline 三类共识
  - 当前不在本项目重复建设完整的 server-side chat/stream/auth/logging
- note:
  - 需要持续避免 session 语义分叉成两个“唯一真相源”
  - 当前本地默认 `workspace_id` 是 `personal`，联调时要显式指定，避免把默认值差异误判成串味

## Iteration 2026-04-05 21:45 +0800

- type:
  - tool-bridge expansion
- decision:
  - 第一阶段 runner capability 先固定为 read-only：`pwd/git_status/read_file/search`
  - `writable_scope` 当前固定 `none`
  - broker 必须尊重 runner advertise 的 capability，不假定 write/patch/bash 已存在
- note:
  - 已增加分离式手动联调链路：`broker:serve` + `runner:serve` + `session:prompt`
  - 现在不仅能跑 demo 内嵌 stub，也能把 broker/runner 分开常驻起来

## Iteration 2026-04-05 22:05 +0800

- type:
  - session observability
- decision:
  - broker stub 需要暴露最小 `GET /sessions/:id` 状态面，方便联调和后续接真实 MMS
  - session inspect 只返回状态与 preview，不回完整 prompt/history
- note:
  - 当前 session snapshot 已包含 `status/stream_connected/runner_attached/runner_capability/active_tool_call`
  - 也会保留 `last_input_preview` 与 `last_output_preview`，方便判断 capability block 或 tool 回灌是否生效

## Iteration 2026-04-06 10:30 +0800

- type:
  - official source findings
- decision:
  - 明确把 `url + device_key` 定义为 broker-side envelope，而不是 official remote protocol 本体
  - 当前不追求“伪装 official”，而是在 broker 外壳之上消费远端真实 official runtime
  - 后续 server-side adapter 如需进一步靠近官方，优先参考 `sessions + events + subscribe` 与 `code sessions + /bridge`
- note:
  - 相关整理已落到 `docs/OFFICIAL_CODE_FINDINGS.md`

## Iteration 2026-04-06 10:05 +0800

- type:
  - future optimization note
- decision:
  - 记录一个后续优化方向：`spawn` 本地短生命周期 worker，承担低思考、高 token 消耗的本地探索任务
  - 保持 `Opus` 为唯一主脑与最终决策者
  - 保持 broker 为 session truth
  - 不把这个方向并入当前主线验收
- note:
  - 该想法更像“本地跑腿助手”而不是“第二主脑”
  - 当前先继续主线；后续可作为 `P2.5/P3` 优化层推进

## Iteration 2026-04-06 13:05 +0800

- type:
  - official entrypoint clarification
- decision:
  - 当前最现实可复用的 official 本地入口先固定为 `claude --print --sdk-url ...`
  - 这条路复用的是真 official `claude` child，但仍是 headless stream-json，而不是最终完整 TUI
  - 当前继续保留 broker shell 作为 debug 面；后续 server/broker 优先补 session-ingress / CCR worker 兼容面
- note:
  - `claude assistant` / `--remote` / `--teleport` 已确认不属于当前最短复用路径
  - 相关整理已落到 `docs/OFFICIAL_CC_ENTRYPOINT_PLAN.md`

## Iteration 2026-04-06 12:09 +0800

- type:
  - official child smoke test
- decision:
  - 在当前仓库内新增一条本地 `official:mock` smoke test，直接拉起真实 official `claude --print --sdk-url ...`
  - 这条 smoke test 先对接本地 mock session-ingress host，用来验证 child launch contract 与最小协议，不等 server 侧完全落地
  - 对当前机器的实测结果是“协议已通，但本机 local official auth 未登录”
- note:
  - 实测返回 `protocol_ok_auth_missing`

## Iteration 2026-04-07 09:05 +0800

- type:
  - official_connect stabilization
- decision:
  - `official_connect` 选择本机 `Claude Code` 时，不再盲信 `PATH` 里的旧 binary，优先选择可执行的最新版本
  - 远端 `claude.ai` auth bundle 缓存目录固定到真实用户 home，下次从新的 MMS session 进入时也直接复用，不再每次都重新 SSH 同步
  - 本地 `credentials.sh` 里的 broker `device_key` 不能继续留占位值；联调时要先确认已经换成 live key，并重启本地 broker
- note:
  - 当前已确认 `2.1.92` 能识别 `cc://` deep link；`2.1.90` 会误走普通 prompt
  - 当前 remote service 侧仍有一处独立阻塞：`/v1/responses` 与 `/v1/chat/completions` 都会返回 `bash: warning: setlocale: LC_ALL: cannot change locale (C.UTF-8)` 的 `500`
  - 这说明当前卡点不是 `sdk-url` 协议，而是本机 `claude` 登录状态

## Iteration 2026-04-06 16:55 +0800

- type:
  - broker session-ingress contract
- decision:
  - broker stub 的 `POST /sessions` 从现在开始返回 `official_child.sdk_url + access_token`
  - broker stub 本地补上 `/v2/session_ingress/ws/:id` 与 `/v2/session_ingress/session/:id/events`
  - 新增 `official:broker`，用真实本机 official `claude` 直接验证 broker 自己产出的 contract
- note:
  - 当前本机实测同样返回 `protocol_ok_auth_missing`
  - 这说明“broker 生成 contract + official child attach”这一层已经通了
  - 下一步优先把这份 contract 从本地 stub 换成真实 server-side adapter，而不是继续扩 shell

## Iteration 2026-04-06 17:30 +0800

- type:
  - MMS smoke entry
- decision:
  - 新增 `official:attach`，允许对任意已配置 broker 做一次真实 official child attach smoke
  - `multi-model-switch` 新增 `mms broker smoke <id>`，把这条 smoke 能力挂到 broker profile 入口
- note:
  - 现在已经不只是 `cc-official-broker` 自己内部能测
  - 而是已经能从 `MMS broker profile` 这层去验证 `broker_base_url + device_key -> official child contract`

## Iteration 2026-04-06 18:35 +0800

- type:
  - direct connect entry
- decision:
  - broker stub 补上最小 direct-connect 兼容面：`POST /sessions { cwd }` + `WS /v2/direct_connect/ws/:id`
  - `official:connect` 作为当前最接近 MMS 正常通道体感的入口
  - `multi-model-switch` 的 `entry_mode = official_attach` 先直接映射到 `official:connect`
- note:
  - broker 侧已能返回 `system/init + assistant + result`
  - 后续实机校正后，当前机器更真实的卡点不是 binary 不支持，而是本机 `Claude Code` 尚未登录 claude.ai

## Iteration 2026-04-06 22:40 +0800

- type:
  - mms entry hardening
- decision:
  - `official_connect` 保留为实验入口，不再作为默认主线
  - `multi-model-switch` 在 `mms broker run <profile>` 前先自动探测/拉起本地 loopback broker
  - official preflight 统一通过 `official:doctor` 暴露 `direct_connect.supported`
- note:
  - 远端链路本身已经可用，但本机官方 client 自带本地登录门槛
  - 所以当前主线应继续以 broker shell 为默认入口，而不是追本机 official UI

## Iteration 2026-04-07 09:35 +0800

- type:
  - local worker v1
- decision:
  - 本地 runner 先补成可执行的 worker v1：在现有 `pwd/git_status/read_file/search` 之外，新增可选 `bash/write_file/apply_patch`
  - 默认 profile 仍保持 read-only，不直接改成全量写能力；需要通过 `runner_tools + runner_writable_scope` 显式开启
  - `bash/write_file/apply_patch` 都必须尊重 `workspace_root + writable_scope`，避免把 worker 先做成无边界 shell
- note:
  - 这一步的目的不是引入第二主脑，而是先把“远端主脑 -> 本地执行层”做成真正能干活的闭环
  - `apply_patch` 当前先固定为结构化 search/replace contract，不先引入更复杂的 unified diff 兼容面

## Iteration 2026-04-07 10:05 +0800

- type:
  - official connect unblock
- decision:
  - `official:connect` 不再把 `device_key` 直接塞进 `cc://`；先走 `POST /auth/device` 换到 broker `access_token`，再把这个 token 传给 official `open <cc-url>`
  - `official:doctor` / `official:connect` 默认会优先解析已安装的 live broker profile，避免本地 loopback broker 场景下丢失 `remote_service_base_url`
  - 本机 binary 选择扩大到 `claude-gateway` + `codex-gateway` 两类 MMS session，并优先挑可走 direct-connect 的 build
  - remote auth bundle 现在显式判定 `expires_at`，过期时直接报明确信号，不再把问题拖到 official UI 里才暴露成 401
- note:
  - 当前真实阻塞已经收窄为两件事：远端 synced `claude.ai` auth bundle 已过期；live remote service 仍可能返回 `LC_ALL/C.UTF-8` 相关错误
  - broker / binary / direct-connect URL 这一层已经不再是主阻塞
