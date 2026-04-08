# cc-official-broker Handbook

> 这是 `cc-official-broker/` 的项目追溯文档。
> 只追加，不覆盖；后续从这个目录重新开始时，先看这里。

## 2026-04-08 主线重定向

当前主线已收口为：

```text
local official Claude Code CLI
  -> self-hosted gateway / broker
  -> server official runtime pool
  -> Anthropic Claude
```

这意味着：

- `cc-official-broker` 现在是主线实现仓
- `cc-mcp-bridge` 现在主要作为底座能力库
- `multi-model-switch` 主要作为 launcher / 安装体验参考
- `agent-im` 主要作为 observability 参考
- 本地 `local tools` 默认最小化；优先依赖 official CLI 自身本地能力

当前协作与恢复入口：

- `./.ai/coord/LATEST.md`
- `./.ai/coord/TASK_BOARD.md`
- `./.ai/coord/BRANCHES_WORKTREES.md`
- `./.ai/coord/HIVE_RUNS.md`
- `./.ai/iterations/`


## 2026-04-08 `official:attach` 一条命令体验入口（已落地）

当前把 `official:attach` 收成了本机可直接体验的入口。只需要：

```bash
# 终端 1：起本地 broker（.env 已默认指向 127.0.0.1:8787）
npm run broker:serve

# 终端 2：直接 attach
npm run official:attach
```

这会产生什么：

- 本地真实 official `claude` binary 以 headless stream-json child 形态启动
- 它通过 broker 的 session-ingress 完成一次最小回合
- 若本地 `claude` 已登录，你会看到 `protocol_and_model_ok`
- 若未登录，你会看到 `protocol_ok_auth_missing`（协议已通，只需登录）

**注意：这不是完整 TUI direct-connect。** 当前真正跑通的是 official child headless + broker contract 路径。完整 TUI 受限于本地 `claude` binary 是否暴露 `claude open <cc-url>` 能力（当前 2.1.92 未暴露）。

相关改动：

- 新增 `.env`（本地默认值，已进 `.gitignore`）
- `package.json` 所有脚本统一加 `--env-file=.env`
- `src/official/attachOfficialSession.mjs` 报错更直接，缺什么会告诉你补什么
- 补了 `.env.example`

## 2026-04-08 `official:attach` -> live broker 联调结果

这轮已经把 `official:attach` 从“本地 broker 可体验”推进到“live-configured broker 可跑”：

- broker 地址：`http://127.0.0.1:8897`
- remote service：`http://23.95.30.199:28082`
- runtime_id：`cc-static-1`
- 当前真实状态：`protocol_ok_model_error`

已经确认打通的层：

- `POST /auth/device`
- `POST /sessions`
- official child launch
- session-ingress connected + initialized
- final result returned

这个 blocker 已解除：live auth source 已改为 `cc-static-1` 对应的 host-path auth bundle，`official:attach` 已返回 `LIVE_ATTACH_OK`。

相关 handoff：

- `./.ai/coord/handoffs/2026-04-08T234630+0800-12-agent-official-attach-live-broker.md`

## 2026-04-09 live auth source 已对齐

`official:attach` 这条 live 路现在已经真正通过：

- status：`protocol_and_model_ok`
- result：`LIVE_ATTACH_OK`

本轮关键不是改架构，而是把 remote auth source 对齐到 healthy runtime：

- `~/.config/mms/credentials.sh`
  - `CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=''`
  - `CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json`
  - `CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.claude.json`

同时 `src/official/remoteAuthSync.mjs` 也补了最小兼容：

- 显式空 `container_name` 时，允许直接 SSH 读取 host 文件
- 缺失 `.claude.json` 时按 optional 继续，不阻断 auth bundle sync

相关 handoff：

- `./.ai/coord/handoffs/2026-04-08T004800+0800-13-agent-live-auth-source-alignment.md`

## 2026-04-09 MMS profile/live env 已收口

这轮把“成功的 live auth source + official_proxy 配置”正式收成了 MMS profile 能消费的形态：

- `mms:profile:print` / `mms:profile:install` 现在会带上 4 个 remote auth env hooks
- `broker:live` 读取 `~/.config/mms/config.toml + credentials.sh` 时，会尊重显式空 `CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=''`
- 这意味着 `MMS` 现在可以稳定承担 `env exporter + launcher` 这一层，不需要再手抄 live auth source 组合

相关 handoff：

- `./.ai/coord/handoffs/2026-04-09T004445+0800-14-mms-profile-live-env-alignment.md`

## 2026-04-08 运行链白话说明

这轮关于“为什么本地工具层去不掉”“server runtime 怎么真正去找 Claude”“为什么不是所有 broker 请求都打到同一个活会话”的白话解释，已经落到：

- `docs/RUNTIME_CHAIN_PLAIN.md`

当前真实联调已通过的 remote endpoint：

- `http://23.95.30.199:28082`

对应 acceptance handoff：

- `./.ai/coord/handoffs/2026-04-08T223000+0800-08-remote-doctor-real-interop.md`

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
  - host: `23.95.30.199`
  - entry: `cc-static-1`
  - official `Claude Code`: `2.1.92`
  - auth: first-party `claude.ai`
- 当前不做：
  - 多人共享
  - 复用 `newapi/CRS`
  - 直接改 `cc-mcp-bridge/` 主线
  - 为了兼容别的方案修改本项目主方向

## 资产复用参考

- 新增资产表：`docs/ASSET_REUSE_MATRIX.md`
- 新增验收 spec：`docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md`
- 用来统一记录哪些目录是主线、哪些只适合抽底座、哪些只适合做参考
- 后续再新增相关 repo / worktree 时，优先先追加到这份表里，不要只留在聊天记录

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
2. 按 `docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md` 开始 implementation slicing
3. 优先落 C3 / C5 / C1，再补 C2 / C4 / C6
4. 固化 official child launch contract，减少后续对 official `cc` 启动方式的猜测
5. 继续只在本目录推进

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

## Iteration 2026-04-07 14:20 +0800

- type:
  - local runner writable slice
- decision:
  - local runner 继续保留 read-only 默认值，但最小 writable tools 已开放实现：
    - `write_file`
    - `bash`
  - 这两个工具都必须显式 opt-in：
    - `runner_tools` 包含对应名字
    - `runner_writable_scope != none`
  - `writable_scope` 当前用于 `write_file` 的硬限制，以及 `bash` 的工作目录限制提示
  - `bash` 当前还不是 OS-level sandbox，只是先把显式开关和 cwd 收口起来
- note:
  - shell 里现在可以直接手动触发：
    - `/tool write_file path -- content`
    - `/tool bash <command>`

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

## Iteration 2026-04-07 10:40 +0800

- type:
  - runtime target switch
- decision:
  - live broker profile 的 remote official auth target 改为独立配置，不再默认跟 `remote_service_base_url` 绑定同一台机器
  - 当前 personal profile 推荐使用 `root@23.95.30.199` + host-path auth source（`claude-home-1`）来同步 official `claude.ai` auth bundle
  - 现有本机 `Claude Code 2.1.92` 重新实测后，仍不能把 `cc://` 当成真正 direct-connect 入口；进入 TUI 后会把整条 URL 当普通 prompt
- note:
  - 新服务器上的 official auth 已可用，但这只解决 remote login，不解决本机 binary 的 direct-connect runtime 能力
  - `official:doctor` 现在会正确显示：`remote_auth.available=true`，但 `direct_connect.supported=false`
  - 所以当前主阻塞已经从“服务器登录态”切回“本机 official build 不支持 broker direct-connect TUI”

## Iteration 2026-04-07 09:48 +0800

- type:
  - public channel verdict
- decision:
  - 当前 public `Claude Code` 可拿到的两条 official 安装通道都不包含可用的 broker direct-connect TUI：
    - npm: `@anthropic-ai/claude-code@2.1.92`
    - native: `https://claude.ai/install.sh` 下载的 `2.1.92`
  - 这两条 public build 都只保留了 `cc://` / `claude-cli://` / `--handle-uri` 之类 deep-link marker，但没有 `createDirectConnectSession` / `open <cc-url>` / `Connect to a Claude Code server` 这些 direct-connect runtime marker。
  - 因此本项目当前不能把“从 MMS 直接进入真实 Claude Code TUI 并通过 broker 通话”作为可交付主线；这不是 server/broker 再修一轮能解决的问题，而是 public official client build 本身没有这条 runtime path。
- note:
  - `claude.ai/install.sh` 现在明确从 `storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases` 拉官方 native binary，最新公开版仍是 `2.1.92`。
  - 实测 native `2.1.92` 与 npm `2.1.92` 一样：`claude open --help` 仍只回顶层 help，不暴露 `open <cc-url>`。
  - 所以当前最硬结论是：remote official auth 已通，但 public local official build 仍不能进入 broker direct-connect TUI。

## Iteration 2026-04-07 10:55 +0800

- type:
  - official cli fallback
- decision:
  - public `Claude Code` 既然不能走 broker direct-connect TUI，就不再把“official shell”绑死在 `cc://...` 上
  - 新增本地 `official:proxy` 路径：本地起 Anthropic-compatible proxy，把真实 official `claude` 正常拉起来，再把底层请求转到当前 remote service
  - 这条路里本地文件 / shell / edit 由本机官方 `claude` 自己负责，不再依赖 broker shell 作为用户入口
- note:
  - 当前 proxy 先固定转当前 `remote_service_base_url + token` 的 `/v1/responses`
  - 已用本地 mock remote service 实测：真实 official `claude -p` 能通过这层 proxy 正常完成一轮回答
  - live remote service 现在仍有独立 server-side 阻塞：`82.156.121.141:18081` 返回 locale 相关 `500`

## Iteration 2026-04-07 18:35 +0800

- type:
  - live runtime recovery
  - mms official entry alignment
- decision:
  - live remote runtime 当前已收口回 `cc-static-1`
  - disabled org 的旧 auth source 已退出主线
  - `official_connect` 在 `MMS` 侧如果探测到 local official build 不支持 direct-connect，就自动改走 `official:proxy`
  - 新生成的 `broker profile` 默认入口改成 `official_proxy`
- note:
  - 已把 live auth sync target 收口到 `cc-static-1` 的 `claude-home-1` auth bundle
  - live `/v1/responses` 已恢复 `200`
  - 本地 `node src/index.mjs official:proxy --print 'reply with ok only'` 已实测返回 `ok`
  - 这意味着用户现在可以从真实 official `Claude Code` CLI 入口感知远端主脑，而不是继续卡在 broker shell

## Iteration 2026-04-07 20:35 +0800

- type:
  - official proxy config inheritance
- decision:
  - `official:proxy` 不再总是从空白 temp config 启动
  - 现在会尽量继承当前 Claude config 里的 `.claude.json` / `settings.json`
  - 但会继续强制覆盖 provider 相关 env，避免被旧 `ANTHROPIC_* / OPENAI_*` 污染
  - broker profile 也新增了 `claude_bypass_permissions` 开关，后续需要时可显式让 official CLI 带 `--dangerously-skip-permissions`
  - 同时向隔离 config 注入一份 session-local `cc-official-broker-runner` MCP entry，给后续 local worker 接线预留位置
- note:
  - 目标是让 `official_proxy` 更像“真的本机 Claude Code”，而不是一个失去 MCP / 偏好设置的空壳

## Iteration 2026-04-07 20:55 +0800

- type:
  - remote planner local tool loop
- decision:
  - `official:proxy` 不再把带 tools 的 Anthropic request 直接透传给远端 `/v1/responses`
  - 因为 bridge 的 `responses` 本质上还是 consult lane，会天然回成 read-only advisory
  - 现在改成：
    - 本地官方 `Claude` 先上报 tools
    - proxy 把对话和 tool catalog 压成 planner prompt 发给远端
    - 远端只负责决定下一步：`tool_use` 或 `final`
    - 本机 official `Claude` 继续真的执行本地 `Bash / Read / Write ...`
- note:
  - 已用 `official:proxy --tools default -p ...` 实测：
    - 远端先下发 `Bash mkdir -p tmp`
    - 再下发 `Write tmp/official-tools-default.txt`
    - 最后返回 `OK`

## Iteration 2026-04-07 21:10 +0800

- type:
  - multi-session entry
  - mms session picker
- decision:
  - 同项目下的 `official_proxy` 不再只允许一条 sticky 会话
  - 本地 session registry 继续保留 `latest` 指针，但同时保留一组 official proxy 历史
  - `official:proxy` 现在支持按显式 `session_id` / `remote_session_id` 恢复指定旧会话，而不只是 `--continue` 最近一条
  - `MMS` 里的 broker Claude 启动入口改成 session picker：
    - 默认回车续最近
    - 可新开一条
    - 可切回旧会话
- note:
  - broker CLI 也补了 `mms broker run <profile> --new` 与 `--pick`
  - 当前切旧会话依赖本地 registry 中已记住的 official transcript session id 与 remote sticky 元数据
  - 已做语法与定向 stub 验证，但还没做你手上的完整真人交互回归
