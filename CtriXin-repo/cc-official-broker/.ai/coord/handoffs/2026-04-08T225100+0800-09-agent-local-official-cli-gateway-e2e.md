# 09-agent-local-official-cli-gateway-e2e Handoff

- 时间：2026-04-08T225100+0800
- Agent：qwen-3.6-plus
- 任务：验证 local official CLI -> gateway 真实入口联调

## 一句话结论

**当前真正跑通的是 official child headless + broker shell/contract 路径；尚未接近真正 local official CLI（完整 TUI）入口。**

## 当前真实状态

### 本地 official binary 扫描结果

- `npm run official:doctor` 确认本地 `claude` binary 存在：
  - 路径：`/Users/xin/.config/mms/claude-gateway/s/16046/.local/share/claude/versions/2.1.92`
  - 版本：`2.1.92`
  - 本地 auth：**已登录**（`logged_in: true`, `oauth_token`, `firstParty`）
  - `direct_connect`：**不支持**（`supported: false`）

### 三种入口的当前真实可达性

| 入口 | 命令 | 状态 | 说明 |
|------|------|------|------|
| headless child via broker stub | `official:broker` | **已通** | 本地起 stub broker -> device auth -> create session -> 用 `--print --sdk-url ...` 启动真实 official child |
| headless child via live broker | `official:attach` | **设计已通，待配置** | 连接真实 broker -> 返回 `official_child.sdk_url + access_token` -> 启动 headless child；当前因缺少 `CC_BROKER_BASE_URL` 配置未在本 worktree 直接跑 |
| 完整 TUI direct-connect | `official:connect` | **不通** | 需要 binary 支持 `DIRECT_CONNECT` / `cc://` / `claude open <url>`；当前 2.1.92 缺少可靠 marker，直接报错 |
| Anthropic proxy TUI | `official:proxy` | **代码存在** | 让正常 `claude` TUI 跑起来，但 API 走本地 proxy 到 remote service；不经过 gateway session-ingress，不属于验收口径的 "gateway 入口" |

### 明确区分

- `official:broker` 和 `official:attach` 启动的**不是**用户日常看到的完整 REPL/TUI。
- 它们使用的是官方内部 bridge/session 同款的 headless child contract：
  ```
  claude --print --sdk-url <url> --session-id <id> \
    --input-format stream-json --output-format stream-json --replay-user-messages
  ```
- 这确实在跑**真正的 official `claude` core**，但形态是 stream-json worker，不是完整交互式 CLI。

## 最小 blocker

- **blocker 类型：local official binary 能力限制**
- 具体：当前本地 `claude 2.1.92` binary 缺少 `createDirectConnectSession`、`Connected to server at`、`Connect to a Claude Code server`、`open <cc-url>` 等可靠 marker。
- 影响：`official:connect`（即真正 local official CLI TUI 直接通过 gateway 地址进入）**在当前机器上不可行**。

### blocker 不属于：

- ❌ local official auth（已经登录）
- ❌ gateway contract（已经能返回 `official_child.sdk_url + access_token`）
- ❌ server runtime 能力（`remote:doctor` real interop 已全部 PASS）

## 下一步最小修复建议

1. **若坚持追完整 TUI 入口**：升级/替换本地 `claude` binary 到支持 `DIRECT_CONNECT` / `cc://` 的版本；当前 2.1.92 不够。
2. **若接受 headless child 为当前主路径**：只需补齐本 worktree 的 `CC_BROKER_BASE_URL` / `CC_BROKER_DEVICE_KEY` 配置，`official:attach` 即可直接复用已运行的 broker（127.0.0.1:8787）。

## 交付结论

- 当前入口类型：**official child headless + broker shell/contract**
- 是否满足 "local official CLI -> gateway" 验收：**不满足完整 TUI 定义，只满足 headless child 定义**
- 最小 blocker：local official binary build 缺少 DIRECT_CONNECT 支持
- handoff 路径：`.ai/coord/handoffs/2026-04-08T225100+0800-09-agent-local-official-cli-gateway-e2e.md`
