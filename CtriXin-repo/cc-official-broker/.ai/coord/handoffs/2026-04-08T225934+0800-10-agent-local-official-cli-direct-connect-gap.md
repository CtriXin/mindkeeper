# 10-agent-local-official-cli-direct-connect-gap Handoff

- 时间：2026-04-08T225934+0800
- Agent：qwen-3.6-plus
- 任务：查清 local official CLI -> gateway direct-connect 升级 gap

## 一句话结论

**当前本地 official Claude Code 2.1.92 无法 direct-connect 进 gateway，根本原因是该 build 缺少暴露给用户的 `claude open <cc-url>` CLI 入口；最小升级路径是尝试升级到官方最新稳定版并复跑 `official:doctor`。**

## direct-connect 所需 marker / capability 清单

基于仓库 `src/official/claudeBinary.mjs` 中 `detectDirectConnectSupport` 的判断逻辑，以及 `directConnect.mjs` 对 TUI 入口的调用方式，完整 direct-connect 需要同时满足：

### 1. Binary-level reliable markers（至少命中一项）
- `createDirectConnectSession` — 表明 binary 内建了直接创建 direct-connect session 的逻辑
- `Connected to server at` — 表明连接成功后的输出/状态确认
- `Connect to a Claude Code server` — help/CLI 描述中的功能声明
- `open <cc-url>` — 命令行帮助中明确 advertise 的用法

### 2. CLI 入口 advertised
- `claude open --help` 输出中必须包含 `Connect to a Claude Code server` 或 `open <cc-url>`
- 只有 binary strings 中存在字符串，但 CLI parser 没有注册 `open` subcommand，用户无法触发

### 3. 运行时协议能力
- 能解析 `cc://` URL scheme（含 `serverUrl`、`authToken` 等 query 参数）
- 能通过 WebSocket 连接到自定义 session-ingress host
- 能在完整 TUI（非 `--print` headless）模式下维持该连接

### 4. Gateway 侧配合（当前已具备）
- broker 已能返回 `official_child.sdk_url + access_token`
- session-ingress stub / live broker 已验证可承载 official child

## 当前 2.1.92 的真实状态

### `official:doctor` 扫描结果
```json
{
  "direct_connect": {
    "supported": false,
    "markers": ["cc://", "claude-cli://", "--handle-uri"],
    "reason": "local official claude build does not expose reliable direct-connect markers"
  }
}
```

### 具体缺失
| 所需能力 | 2.1.92 状态 | 说明 |
|----------|-------------|------|
| `createDirectConnectSession` | ❌ 缺失 | strings 扫描未命中 |
| `Connected to server at` | ❌ 缺失 | strings 扫描未命中 |
| `Connect to a Claude Code server` | ❌ 缺失 | strings + help 均未命中 |
| `open <cc-url>` | ❌ 缺失 | strings + help 均未命中 |
| `claude open` subcommand | ❌ 不存在 | `claude --help` 无 `open`；执行 `claude open cc://test` 超时/无响应 |
| `cc://` 解析能力 | ⚠️ 弱标记仅存 | binary 内部有 URI handler 残留字符串，但无用户入口 |
| TUI 模式连接 remote session | ❌ 不可达 | 无 CLI 入口即无法触发 |

### 有趣的发现
通过 `strings` 对 2.1.92 binary 进行扫描，能发现大量 `DirectConnect`、`useDirectConnect`、`setDirectConnectServerUrl`、`[useDirectConnect] Connecting to` 等字符串。这说明 **direct-connect 的 UI/frontend 代码已经打包在该 binary 内**（用于官方 bridge/session 的 viewer attach 路径），但 **CLI 层没有向用户暴露 `open` 命令**。因此这不是“功能完全不存在”，而是“功能被编译进 binary 但未在当前 build 中启用”。

## Blocker 类型判断

- ❌ **不是 CLI version 太旧**：2.1.92 本身是 2025 年底至 2026 年初的较新版本
- ❌ **不是入口判断逻辑不完整**：仓库内的 `detectDirectConnectSupport` 正确返回了 `false`，判断逻辑无误
- ✅ **是 local official binary 能力限制 / feature flag 缺失**：当前 2.1.92 build 没有启用/暴露 `claude open <cc-url>` 这一用户入口。需要更高版本或不同 channel 的 build 才能解锁

## 最小升级建议

### 升级目标
将本地 `claude` binary 升级到**当前官方最新稳定版**（通过 `claude doctor` 自更新，或重新安装 `@anthropic-ai/claude-code`）。

### 升级后优先验证步骤
1. **复跑诊断**：`npm run official:doctor`
   - 观察 `direct_connect.supported` 是否变为 `true`
   - 观察 `markers` 是否新增可靠标记（如 `open <cc-url>`）
2. **尝试直连**：`npm run official:connect`
   - 这是真正的 TUI direct-connect 入口验证
   - 若 CLI 支持 `open` 命令，此脚本会自动构造 `cc://...` URL 并拉起 TUI
3. **版本对比**：若升级后仍不支持，记录最新版本号及 `official:doctor` 输出，用于判断该功能是否尚未进入官方稳定 release

### 降级/回滚策略
- 官方 CLI 通常保留旧版本在 `~/.local/share/claude/versions/`，可直接回切
- 或重新 pin 安装 `npm i -g @anthropic-ai/claude-code@2.1.92`

## 策略建议

- **若最新版支持 direct-connect**：立刻将 `official:connect` 作为主推入口，gateway 侧只需保持现有 contract 即可
- **若最新版仍不支持**：说明该能力尚未对用户开放，应**放弃继续追完整 TUI 路径**，把资源集中在：
  1. 固定 `headless sdk-url child` 主链（`official:broker` / `official:attach`）
  2. 补齐 `CC_BROKER_BASE_URL` / `CC_BROKER_DEVICE_KEY` 配置，让 `official:attach` 能在本 worktree 直接跑通 live broker

## 交付清单

- [x] direct-connect marker/capability 清单已整理
- [x] 2.1.92 缺失项已明确列出
- [x] blocker 类型已判定（binary build 能力限制 / feature flag 缺失）
- [x] 最小升级路径与验证命令已给出
- [x] handoff 已写入本文件
- [ ] 实际升级与复测待执行（不在本轮 scope）
