# Handoff: C3 Source IP Allowlist (Fixed)

- **From**: Worker Agent
- **To**: codex-main
- **Task**: C3 Source IP Allowlist (Optional Ingress Policy)
- **Timestamp**: 2026-04-08
- **Status**: Completed with WebSocket fix

## 一句话结论

C3 source IP allowlist 已收口为"最小可用、默认关闭"的 optional ingress policy，且同时覆盖 **HTTP + WebSocket** 两种 ingress：配置入口在 `src/config.mjs`，HTTP guard 在请求处理入口处，WebSocket guard 在 `upgrade` 事件处理中（返回 101 之前检查），默认 `allowedSourceIps` 为空即 allow all，动态 IP 用户无需配置即可正常使用。

## 交付内容

### 1. 配置入口 (`src/config.mjs`)

新增两个配置项：
- `allowedSourceIps`: 从 `CC_BROKER_ALLOWED_SOURCE_IPS` 读取，CSV 格式，支持 CIDR
- `trustXForwardedFor`: 从 `CC_BROKER_TRUST_X_FORWARDED_FOR` 读取，默认 `false`

默认行为：
- `allowedSourceIps` 为空数组 => policy disabled => **allow all**
- `trustXForwardedFor` 默认 `false`

### 2. HTTP Ingress 接入 (`src/broker/stubServer.mjs`)

- 导入 `createIpAllowlistMiddleware` 和 `buildAllowlistStatus`
- 在 HTTP server 创建时初始化中间件
- 在每个请求处理**最开始处**调用 IP allowlist check（在 auth 之前）
- `/healthz` 端点返回 `ip_allowlist` 状态摘要
- 拒绝时记录 `ingress.ip_rejected` 事件到 state.events

### 3. WebSocket Ingress 接入 (`src/broker/stubServer.mjs`)

**修复内容**：原实现只在 HTTP path 检查 IP allowlist，WebSocket upgrade 路径绕过了检查。

修复措施：
- 在 `server.on("upgrade")` 最开始处添加 IP allowlist 检查
- **在返回 `101 Switching Protocols` 之前**检查 IP
- 如果 IP 不在 allowlist，返回 `403 Forbidden` 并关闭连接，**不完成 WebSocket 握手**
- 覆盖所有 WebSocket ingress 路径：
  - `/runner/connect`
  - `/sessions/:id/stream`
  - `/v2/session_ingress/ws/:id`
  - `/v2/direct_connect/ws/:id`
- 拒绝时记录 `ingress.ws_upgrade.ip_rejected` 事件到 state.events

### 4. 文档 (`docs/SOURCE_IP_ALLOWLIST.md`)

- 明确说明这是 optional policy，不是固定公网 IP 前提
- 动态 IP 场景使用指南（不配置即可）
- 配置示例（固定 IP、trusted proxy 场景）
- **验证步骤包括 HTTP 和 WebSocket 两种场景**
- 回滚方式

## Changed Files

| File | Change |
|------|--------|
| `src/config.mjs` | 新增 `allowedSourceIps` 和 `trustXForwardedFor` 配置读取 |
| `src/broker/stubServer.mjs` | HTTP: 接入 IP allowlist middleware 到请求入口；WebSocket: 在 upgrade 事件处理中添加 IP 检查（返回 101 前）；healthz 返回 allowlist 状态 |
| `docs/SOURCE_IP_ALLOWLIST.md` | 更新：明确 HTTP + WebSocket 都受控；添加 WebSocket 验证步骤 |
| `.ai/coord/handoffs/2026-04-08T095000+0800-c3-source-ip-allowlist-to-codex-main.md` | 本 handoff 文件（更新） |
| `.ai/agent-release-notes.md` | 追加 release notes |

## 验证方式

### 1. 语法检查

```bash
node --check src/config.mjs
node --check src/broker/stubServer.mjs
node --check src/shared/ipUtils.mjs
node --check src/broker/ipAllowlist.mjs
```

### 2. 默认行为验证（动态 IP 用户场景）

```bash
# 不配置 allowlist（默认）
unset CC_BROKER_ALLOWED_SOURCE_IPS

# 启动服务
node src/index.mjs broker:stub

# 从任何 IP 都应能访问 HTTP
curl http://localhost:3000/healthz
# 预期：{"ok": true, "ip_allowlist": {"enabled": false, ...}}

# WebSocket 也应该能连接
websocat ws://localhost:3000/runner/connect
# 预期：连接成功（或 auth 失败，但不是 IP 被拒绝）
```

### 3. HTTP Allowlist 启用验证

```bash
# 配置 allowlist
export CC_BROKER_ALLOWED_SOURCE_IPS="127.0.0.1"

# 从 allowed IP 访问
curl http://localhost:3000/healthz
# 预期：200 OK

# 从其他 IP 访问（换机器或用代理模拟）
# 预期：403 Forbidden
# {"error": "source_ip_not_allowed", "client_ip": "..."}
```

### 4. WebSocket Allowlist 启用验证

```bash
# 配置 allowlist（只包含特定 IP）
export CC_BROKER_ALLOWED_SOURCE_IPS="192.168.1.1"

# 从其他 IP 尝试 WebSocket 连接
websocat ws://localhost:3000/runner/connect

# 预期响应：HTTP/1.1 403 Forbidden
# 不会收到 101 Switching Protocols
# 连接不会建立
```

使用 Node.js 验证：
```javascript
// test-ws-reject.js
import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:3000/runner/connect')

ws.on('upgrade', (res) => {
  console.log('Upgrade response status:', res.statusCode)
  // 如果 IP 被拒绝，这里应该是 403，不会触发 'open'
})

ws.on('error', (err) => {
  console.log('Expected error:', err.message)
  // 预期：连接被拒绝
})

ws.on('open', () => {
  console.log('UNEXPECTED: Connection should have been rejected')
  ws.close()
})
```

### 5. 单元测试（直接调用模块）

```bash
node -e "
import('./src/shared/ipUtils.mjs').then(m => {
  const list = m.parseIpAllowlist('192.168.1.0/24,10.0.0.5')
  console.assert(list.length === 2, 'Parse failed')
  console.assert(m.isIpAllowed('192.168.1.100', list) === true, 'CIDR check failed')
  console.assert(m.isIpAllowed('8.8.8.8', list) === false, 'Reject failed')
  console.assert(m.isIpAllowed('any', []) === true, 'Empty should allow all')
  console.log('✓ All IP utils tests passed')
})
"
```

## 设计决策

### 为什么是 optional policy？

用户明确强调：这不是"要求本地客户端必须有固定公网 IP"。

- 动态 IP 用户是主要使用场景
- Allowlist 只用于特定场景（固定出口、server-to-server、trusted proxy 后）
- 默认 disabled 保证向后兼容

### 为什么放在 auth 之前？

- IP allowlist 是网络层策略，应在应用层 auth 之前
- 减少无效 auth 处理
- 符合 defense in depth 原则

### 为什么 WebSocket 也要在 101 之前检查？

- WebSocket 握手完成后，连接已经升级，此时再拒绝会造成资源浪费
- 在返回 `101 Switching Protocols` 之前检查，可以干净地拒绝连接
- 与 HTTP 行为一致：都返回 403 Forbidden

### 覆盖哪些 WebSocket 路径？

当前 gateway 的所有 WebSocket ingress：
- `/runner/connect` - Runner 连接
- `/sessions/:id/stream` - Session 流
- `/v2/session_ingress/ws/:id` - Official child ingress
- `/v2/direct_connect/ws/:id` - Direct connect

## 已知限制

1. **没有按 key/endpoint 细分 allowlist**
   - Phase 1 只有全局 allowlist
   - 后续可按需添加 key-level 配置

2. **没有 rate limiting**
   - 纯 IP allowlist，没有请求频率限制
   - 后续可考虑添加

3. **没有 GeoIP 限制**
   - 只有 IP/CIDR，没有地理位置

## 回滚方式

```bash
# 临时禁用
unset CC_BROKER_ALLOWED_SOURCE_IPS

# 从配置文件删除对应行
# 重启服务
```

## 与 C5 Runtime Lifecycle 的关系

- C3 处理 **gateway ingress 层**的 IP 控制
- C5 处理 **runtime pool 层**的健康和调度
- 两者独立工作：IP 检查通过后才进入 runtime 选择

## 确认修复的 Blocking 问题

- [x] WebSocket upgrade 路径现在经过 IP allowlist 检查
- [x] 在返回 101 Switching Protocols 之前检查
- [x] 拒绝时返回 403 而不是先 101 再断开
- [x] 覆盖所有 WebSocket ingress 路径（runner, session, ingress, direct-connect）
- [x] 文档更新说明 HTTP + WebSocket 都受控
- [x] 验证步骤包含 WebSocket 场景
