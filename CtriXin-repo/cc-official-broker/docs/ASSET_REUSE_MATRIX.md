# Asset Reuse Matrix

## 一句话结论
之前的工作没有白做。现在几个目录里都有可直接复用的有效资产，只是它们分别属于不同层：有的是 `entry layer`，有的是 `gateway/control plane`，有的是 `official reference`，有的是 `observability`。

## 当前主线收口

```text
local official Claude Code CLI
  -> self-hosted gateway / broker
  -> server official runtime pool
  -> Anthropic Claude
```

补充原则：

- 能让用户“只像平时一样启动 cc”，就不要额外暴露复杂入口
- 真正的 OAuth / runtime / egress / sticky 真相留在服务器
- 本地尽量只保留 official CLI 本身；非必要不再强推重型 local tools
- 如需补工具层，优先让 official CLI 自带能力先工作，再考虑最小 bridge

## 资产表

| 路径 | 当前价值 | 推荐角色 | 可直接复用 | 不建议直接带入主线的部分 |
|---|---|---|---|---|
| `cc-official-broker/` | 最接近你目标主线，已经有 `official:proxy`、session registry、local official child attach、broker shell | 主线项目 | `src/official/runOfficialProxy.mjs`、`src/official/upstreamProxy.mjs`、`src/session/localSessionRegistry.mjs` | 早期 stub / shell-only debug 路径不要继续膨胀成长期产品形态 |
| `cc-mcp-bridge/` | 已有 server-side official runtime、multi-key、sticky、runtime pool、quota、audit、IP allowlist | control plane / capability library | key 管理、`allowed_runtime_ids`、runtime disable/drain、usage/audit、runtime state | 不要继续把它当最终 native CLI gateway 主入口 |
| `cc-mcp-bridge/docs/CLIPROXYAPI_GATEWAY_REFERENCE.md` | 已验证“统一 gateway 入口 + 服务端账号池/静态 egress + 本地 client 不感知 runtime 细节”这条产品形态 | gateway product reference | 单入口 `base_url + key`、登录链路与运行链路分离、gateway 持有 egress/proxy policy | 不要把整套 `CLIProxyAPI` 管理面、多 provider 外壳直接搬成主线实现 |
| `/Users/xin/Downloads/src` | 官方源码参考，能确认 session、direct-connect、bridge、telemetry、permission 边界 | official reference | `remote/RemoteSessionManager.ts`、`server/directConnectManager.ts`、`bridge/*`、`services/analytics/*` | 不要整包复制；只拿协议认知和边界，不做大段源码搬运 |
| `multi-model-switch/` | 已经证明“复杂能力可以包装成很轻的本地入口”，尤其是 `broker profile` 和 `official_proxy` 体验层 | optional entry layer / installer reference | `mms_broker.py` 的 profile/env 注入、`README.zh-CN.md` 里的 `entry_mode = "official_proxy"`、runtime-api 的 gateway UX | 面向别人公开时，不要把 MMS 设成必需前置；它更适合做你自己的 launcher/installer 经验来源 |
| `agent-im/` | 对 session watch、hooks、事件流、可观测性很有参考价值 | observability sidecar reference | `src/codex-watcher.ts`、`hooks/*.sh`、`src/session-registry.ts` | 不要把 Discord / daemon / hook 体系变成主链依赖；它是 sidecar，不是主产品核心 |

## 我建议保留的高价值点

### 1. `cc-official-broker/`

最值得继续做：

- `src/official/runOfficialProxy.mjs`
  - 已经证明可以把本地 official CLI 指向你自己的 `ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN`
  - 还顺手做了隔离 `CLAUDE_CONFIG_DIR`、最小环境清洗、`DISABLE_TELEMETRY` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
- `src/official/upstreamProxy.mjs`
  - 已经是最接近目标 gateway 的 adapter 原型
- `src/session/localSessionRegistry.mjs`
  - 本地最近会话恢复、作用域隔离，这些都继续有用

结论：

- 这是未来主线
- 不是废稿

### 2. `cc-mcp-bridge/`

最值得抽出来的：

- API key 管理
- `allowed_runtime_ids`
- source IP allowlist
- sticky session / runtime binding
- runtime health / disable / drain
- usage / quota / audit

结论：

- 它更像 server control plane
- 不用推倒重来，但也不再当最终用户入口

### 3. `/Users/xin/Downloads/src`

最值得看的不是 UI，而是边界：

- remote session 生命周期
- direct-connect / bridge 协议结构
- permission request 形状
- telemetry / analytics 开关
- session / transcript / resume 相关契约

结论：

- 它非常有参考价值
- 但主要用于“少猜、多对齐官方真实行为”

### 4. `CLIProxyAPI Gateway Reference`

最值得借的不是代码本体，而是已经被这次实验坐实的产品结论：

- 本地 client 只认一个统一入口是对的
- `Claude OAuth` 登录链路和日常运行链路可以分离
- 静态 egress / proxy policy 应该由服务端 gateway 统一持有
- runtime pool 应该藏在 gateway 后面，而不是暴露给本地 client

结论：

- 它很适合拿来校准“外部产品体验应该长什么样”
- 但主线实现仍然更适合继续长在 `cc-official-broker + cc-mcp-bridge`

### 5. `multi-model-switch/`

最值得保留的不是整个产品，而是“怎么把复杂事藏起来”：

- `mms_broker.py` 已经能把 `broker profile` 收口成很轻的入口
- `README.zh-CN.md` 里的 `entry_mode = "official_proxy"` 已经证明可以做到：用户看起来像正常启动 `claude`
- `apps/runtime-api/` 也提供了一些 gateway 管理面经验

结论：

- 对你自己和内部用户，它是很好的 launcher / installer / UX 参考
- 对外若要做到“一个 cc 即可”，最终不应该要求用户先理解 MMS

### 6. `agent-im/`

最值得保留的是观察而不是控制：

- hook 事件采集
- transcript / rollout watch
- session registry
- sidecar observability

结论：

- 它对排查和运维有帮助
- 但不适合并进主链做必需依赖

## 对“一个 cc 即可”的实际判断

目标可以分两层：

| 目标 | 是否可做到“一个 cc 即可” | 说明 |
|---|---|---|
| 本地 official CLI 通过 `apiurl + key` 正常对话 | 是 | 这是当前主线目标 |
| 本地还能读写本机文件、跑命令 | 大概率也是 | 因为 official CLI 本来就在本机运行，优先复用它自己的本地能力 |
| 服务器主动远控本机工具，但用户完全无感 | 部分可做 | 只有在需要 server-driven tool callback 时，才需要一个极薄 local bridge |
| 面向别人公开时还要求安装 MMS / runner / daemon / hooks | 不建议 | 这会违背“一个 cc 即可”的产品感受 |

## 现在的大方向

- 主线：`cc-official-broker`
- 底座：`cc-mcp-bridge`
- 官方参考：`/Users/xin/Downloads/src`
- 入口/安装体验参考：`multi-model-switch`
- 可观测性参考：`agent-im`

## 下一步建议

1. 继续在 `cc-official-broker` 固化 `official CLI -> self-hosted gateway` 主链
2. 从 `cc-mcp-bridge` 抽 key/sticky/runtime/audit，而不是整仓迁移
3. 从 `multi-model-switch` 借“轻入口 / profile / 安装体验”，但不要把 MMS 变成外部必需前置
4. 从 `agent-im` 只借 observability 模式，不把 daemon/hooks 变成主链依赖
5. `local tools` 默认继续压到最小；先让 official CLI 自身完成本地读写与命令，再决定是否真的需要自定义 bridge
