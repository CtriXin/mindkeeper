# Source IP Allowlist

> 文档版本：2026-04-08
> 类型：Optional Ingress Policy

## 概述

Source IP allowlist 是一个**可选的 ingress 安全策略**，用于限制哪些 IP 地址可以访问 gateway。

**重要**：这不是“要求本地客户端必须有固定公网 IP”。动态 IP 用户完全可以正常使用，只是**不要开启** allowlist 即可。

## 使用场景

| 场景 | 建议配置 |
|------|----------|
| 本地开发 / 动态 IP 用户 | **不配置** allowlist（默认行为） |
| 固定出口 IP 的企业环境 | 配置公司出口 IP/CIDR |
| 部署在 trusted proxy 后 | 启用 `trustXForwardedFor` + 配置 upstream IP |
| Server-to-server 调用 | 配置 caller 的固定 IP |

## 默认行为（向后兼容）

- `allowedSourceIps` 为空数组（未配置）=> **Policy disabled** => **Allow all**
- `trustXForwardedFor` 默认 `false`
- 动态 IP 用户无需任何配置即可正常使用

## 配置

### 环境变量

```bash
# 允许的来源 IP/CIDR 列表（CSV 格式）
# 未设置或为空 = 允许所有（默认）
export CC_BROKER_ALLOWED_SOURCE_IPS="192.168.1.0/24,10.0.0.5"

# 是否信任 X-Forwarded-For 头（默认 false）
# 仅在部署在可信 proxy 后时启用
export CC_BROKER_TRUST_X_FORWARDED_FOR="false"
```

### 配置示例

**场景 1：本地开发（动态 IP）**
```bash
# 不设置或留空 = 允许所有
unset CC_BROKER_ALLOWED_SOURCE_IPS
```

**场景 2：固定出口 IP**
```bash
# 只允许特定 IP
export CC_BROKER_ALLOWED_SOURCE_IPS="203.0.113.42"

# 允许 CIDR 段
export CC_BROKER_ALLOWED_SOURCE_IPS="203.0.113.0/24,198.51.100.10"
```

**场景 3：Trusted Proxy 后部署**
```bash
# 信任 X-Forwarded-For，只允许上游 proxy
export CC_BROKER_ALLOWED_SOURCE_IPS="10.0.0.0/8"
export CC_BROKER_TRUST_X_FORWARDED_FOR="true"
```

## 工作机制

### 请求处理流程

```
Client Request
    ↓
IP Allowlist Check (第一关，在 auth 之前)
    ├─ 未配置 allowlist → 通过
    ├─ IP 在 allowlist → 通过
    └─ IP 不在 allowlist → 403 Forbidden
    ↓
Auth Check
    ↓
正常处理
```

### WebSocket Upgrade 处理

WebSocket 连接（如 `/runner/connect`、`/sessions/:id/stream` 等）同样在 upgrade 前检查 IP allowlist：

```
WebSocket Upgrade Request
    ↓
IP Allowlist Check (在返回 101 之前)
    ├─ 未配置 allowlist → 通过
    ├─ IP 在 allowlist → 通过 → 返回 101 Switching Protocols
    └─ IP 不在 allowlist → 403 Forbidden (不升级连接)
```

**重要**：WebSocket 在返回 `101 Switching Protocols` 之前检查，如果 IP 不在 allowlist，直接返回 `403 Forbidden` 并关闭连接，不会完成 WebSocket 握手。

### IP 提取逻辑

1. 如果 `trustXForwardedFor=true` 且存在 `X-Forwarded-For` 头
   - 取该头的第一个 IP（最靠近原始客户端）
2. 否则使用 TCP 连接的 `remoteAddress`
3. 处理 IPv4-mapped IPv6 地址（`::ffff:192.168.1.1` → `192.168.1.1`）

## 验证

### 1. 检查当前配置（已实现）

```bash
curl http://localhost:3000/healthz
```

响应示例（allowlist disabled）：
```json
{
  "ok": true,
  "service": "cc-official-broker-stub",
  "ip_allowlist": {
    "enabled": false,
    "rule_count": 0,
    "trust_x_forwarded_for": false,
    "has_rules": false
  }
}
```

响应示例（allowlist enabled）：
```json
{
  "ok": true,
  "service": "cc-official-broker-stub",
  "ip_allowlist": {
    "enabled": true,
    "rule_count": 2,
    "trust_x_forwarded_for": false,
    "has_rules": true
  }
}
```

### 2. 测试 HTTP 拒绝场景（已实现）

```bash
# 从不在 allowlist 的 IP 访问
export CC_BROKER_ALLOWED_SOURCE_IPS="192.168.1.1"

# 从其他 IP 访问
curl http://localhost:3000/healthz
# 预期响应：403 Forbidden
# {"error": "source_ip_not_allowed", "client_ip": "..."}
```

### 3. 测试 WebSocket 拒绝场景（已实现）

```bash
# 配置 allowlist（只包含一个特定 IP）
export CC_BROKER_ALLOWED_SOURCE_IPS="192.168.1.1"

# 从其他 IP 尝试 WebSocket 连接
# 使用 websocat 或类似工具
websocat ws://localhost:3000/runner/connect

# 预期响应：HTTP/1.1 403 Forbidden
# 连接不会升级为 WebSocket（没有 101 Switching Protocols）
```

使用 Node.js 测试：
```javascript
// test-ws-reject.js
import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:3000/runner/connect')

ws.on('error', (err) => {
  console.log('Expected error:', err.message)
  // 预期：连接被拒绝，不会收到 101
})

ws.on('open', () => {
  console.log('UNEXPECTED: Connection should have been rejected')
  ws.close()
})
```

### 4. 单元测试（直接调用模块）

```javascript
// test-ip-allowlist.js
import { parseIpAllowlist, isIpAllowed, getClientIp } from './src/shared/ipUtils.mjs'

// Test 1: Parse CIDR
const allowlist = parseIpAllowlist("192.168.1.0/24,10.0.0.5")
console.log('Parsed:', allowlist)
console.assert(allowlist.length === 2, 'Should parse 2 rules')

// Test 2: IP in allowlist
console.assert(isIpAllowed("192.168.1.100", allowlist) === true, 'IP in CIDR')
console.assert(isIpAllowed("10.0.0.5", allowlist) === true, 'Exact match')
console.assert(isIpAllowed("8.8.8.8", allowlist) === false, 'IP not allowed')

// Test 3: Empty allowlist = allow all
console.assert(isIpAllowed("any.ip.here", []) === true, 'Empty = allow all')

console.log('✓ All tests passed')
```

运行：
```bash
node test-ip-allowlist.js
```

## 回滚

### 临时禁用 allowlist

```bash
unset CC_BROKER_ALLOWED_SOURCE_IPS
# 重启服务
```

### 从配置中移除

从 `.env` 或环境变量中删除 `CC_BROKER_ALLOWED_SOURCE_IPS` 行，重启服务。

## 安全注意事项

1. **不要依赖 IP allowlist作为唯一安全机制**
   - 仍需配合 auth（bearer token / device key）
   - IP 可以被伪造（如果不使用 trusted proxy）

2. **X-Forwarded-For 风险**
   - 只有**可信 proxy** 才能设置此头
   - 恶意客户端可以伪造此头
   - 默认 `trustXForwardedFor=false` 是安全的

3. **日志记录**
   - 被拒绝的请求会记录到 `state.events`
   - 包含 `type: "ingress.ip_rejected"` 和客户端 IP

## 与 Session Isolation 的关系

- IP allowlist 在 **gateway ingress 层**生效
- `device_id/workspace_id/session_id` 在 **session 层**生效
- 两者独立：IP 检查通过后才进入 session 路由

## Phase 1 实现范围

### 已实现

- [x] IP/CIDR 解析（支持 IPv4/IPv6）
- [x] 请求入口检查（在 auth 之前）
- [x] X-Forwarded-For 支持（可选，默认关闭）
- [x] 默认 allow all（向后兼容）
- [x] 明确错误响应（403 + error 字段）
- [x] Healthz 端点暴露 allowlist 状态
- [x] 拒绝事件记录

### 未实现（后续考虑）

- [ ] 按 key/endpoint 细分的 allowlist
- [ ] 临时封禁（rate limiting）
- [ ] GeoIP 限制
- [ ] IP reputation 检查
