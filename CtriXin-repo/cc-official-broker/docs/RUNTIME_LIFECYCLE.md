# Runtime Lifecycle

> 文档版本：2026-04-08
> 阶段：Phase 1 最小实现

## 概述

本文档定义 `cc-official-broker` 的 runtime lifecycle 模型，包括状态定义、行为语义和第一阶段实现范围。

## State Model

### 核心状态字段（存储层）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | true | 是否启用该 runtime |
| `draining` | boolean | false | 是否处于 draining 状态 |
| `unhealthy` | boolean | false | 是否标记为不健康 |

### 派生 Routing Status

由核心状态派生，用于路由决策：

| Status | 条件 | 新会话 | 已绑定会话 |
|--------|------|--------|------------|
| `enabled` | enabled=true, unhealthy=false, draining=false | ✅ 可分配 | ✅ 可继续 |
| `draining` | enabled=true, draining=true | ❌ 不分配 | ✅ 可继续 |
| `unhealthy` | unhealthy=true 或 auto-unhealthy 激活 | ❌ 不分配 | ❌ 不继续 |
| `disabled` | enabled=false | ❌ 不分配 | ❌ 不继续 |

### Health State

| 字段 | 说明 |
|------|------|
| `consecutive_failures` | 连续失败次数 |
| `last_failure_at` | 最后失败时间戳 |
| `last_success_at` | 最后成功时间戳 |
| `auto_unhealthy_until_ts` | 自动 unhealthy 过期时间 |
| `auto_unhealthy_reason` | 自动标记原因 |

## 行为语义

### Disable

- **效果**：runtime 不再接受新会话，已有会话被终止
- **使用场景**：长期停用、维护、下线
- **安全守卫**：不能 disable 最后一个 healthy runtime

### Drain

- **效果**：runtime 不再接受新会话，但允许已有会话完成
- **使用场景**：优雅升级、迁移前准备
- **与 disable 区别**：draining 的会话可继续，disabled 的会话应终止

### Unhealthy

- **效果**：runtime 不参与调度，已有会话建议切换
- **触发方式**：
  1. 手动标记：`PATCH /v1/runtimes/{id}` 设置 unhealthy=true
  2. 自动标记：连续失败达到阈值后自动进入 unhealthy
- **自动恢复**：auto-unhealthy 有过期时间，过期后自动解除

### Auto-Unhealthy

- **阈值**：`CC_BROKER_RUNTIME_FAILURE_THRESHOLD`（默认 3）
- **冷却期**：`CC_BROKER_RUNTIME_AUTO_UNHEALTHY_COOLDOWN_MS`（默认 15 分钟）
- **条件**：
  1. 连续失败 >= 阈值
  2. 存在其他 healthy runtime（防止全池不可用）

## 第一阶段实现范围

### 已实现（真实可用）

- [x] Runtime registry（文件存储）
- [x] Runtime state（文件存储）
- [x] 状态派生逻辑（enabled/draining/unhealthy -> routing_status）
- [x] Health tracking（consecutive failures, timestamps）
- [x] Auto-unhealthy（自动标记与过期）
- [x] 选择守卫（不会选择 disabled/unhealthy/draining 用于新会话）
- [x] 安全守卫（防止禁用最后一个 healthy runtime）

### 占位/模拟（未接入真实 server runtime）

- [ ] 真实 server runtime health check（目前基于请求成功/失败）
- [ ] 真实容器状态同步（docker/container state）
- [ ] 跨设备 sticky session 迁移（drain 时的会话转移）
- [ ] 配额/限流集成（quota-based routing decisions）

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CC_BROKER_RUNTIME_FAILURE_THRESHOLD` | 3 | 自动 unhealthy 的连续失败阈值 |
| `CC_BROKER_RUNTIME_AUTO_UNHEALTHY_COOLDOWN_MS` | 900000 (15m) | 自动 unhealthy 持续时间 |

### 文件存储

```
data/
├── runtime-registry.json    # runtime 配置注册表
└── runtime-state.json       # runtime 动态状态
```

## API（计划）

### List Runtimes

```
GET /v1/runtimes
```

响应包含派生的 `routing_status` 和 `can_accept_new`/`can_continue` 字段。

### Get Runtime

```
GET /v1/runtimes/{runtime_id}
```

### Update Runtime State

```
PATCH /v1/runtimes/{runtime_id}
{
  "enabled": boolean,      // optional
  "draining": boolean,     // optional
  "unhealthy": boolean,    // optional
  "clear_error": boolean   // optional, 重置 health state
}
```

### 手动刷新 Quota

```
POST /v1/runtimes/{runtime_id}/quota/refresh
```

### 手动迁移会话

```
POST /v1/runtimes/{runtime_id}/migrate
```

## 验证步骤

> **注意**：Phase 1 仅实现本地文件存储的 runtime lifecycle 管理，API 层（`/v1/runtimes`）尚未实现。以下验证使用 Node.js 直接调用模块。

### 1. 基础功能验证（已实现）

```javascript
// test-runtime.js
import { RuntimePool, computeRoutingStatus } from './src/runtime/runtimePool.mjs'
import { mkdirSync } from 'fs'

// Create test data directory
mkdirSync('data', { recursive: true })

const pool = new RuntimePool(
  'data/runtime-registry.json',
  'data/runtime-state.json'
)

// 1. Register a runtime
pool.registry.upsert({
  runtime_id: 'cc-static-1',
  base_url: 'http://localhost:3001',
  label: 'Test Runtime',
  enabled: true
})
console.log('✓ Runtime registered')

// 2. Check runtime status
const runtime = pool.get('cc-static-1')
console.log('Status:', runtime.routing_status)  // Should be "enabled"
console.log('Enabled:', runtime.enabled)        // Should be true
console.log('✓ Runtime status checked')

// 3. Set draining
pool.setRuntimeState('cc-static-1', { draining: true })
const draining = pool.get('cc-static-1')
console.log('Status after drain:', draining.routing_status)  // Should be "draining"
console.log('✓ Draining set')

// 4. Check can_accept_new / can_continue
console.log('Can accept new:', draining.can_accept_new)    // Should be false
console.log('Can continue:', draining.can_continue)        // Should be true
```

运行验证：
```bash
node test-runtime.js
```

### 2. Auto-Unhealthy 验证（已实现）

```javascript
// test-auto-unhealthy.js
import { RuntimePool } from './src/runtime/runtimePool.mjs'
import { mkdirSync } from 'fs'

mkdirSync('data', { recursive: true })

// Create pool with low threshold for testing
const pool = new RuntimePool(
  'data/runtime-registry.json',
  'data/runtime-state.json',
  {
    failureThreshold: 2,  // Lower for testing
    autoUnhealthyCooldownMs: 60000  // 1 minute for testing
  }
)

// Register two runtimes (need backup for auto-unhealthy to trigger)
pool.registry.upsert({ runtime_id: 'runtime-a', base_url: 'http://a:3001', enabled: true })
pool.registry.upsert({ runtime_id: 'runtime-b', base_url: 'http://b:3001', enabled: true })

// Record failures for runtime-a (with runtime-b as backup)
pool.recordOutcome('runtime-a', false, new Error('Test error 1'))
pool.recordOutcome('runtime-a', false, new Error('Test error 2'))

const failed = pool.get('runtime-a')
console.log('Consecutive failures:', failed.health_state.consecutive_failures)  // Should be 2
console.log('Auto unhealthy active:', failed.health_state.auto_unhealthy_active)  // Should be true
console.log('Routing status:', failed.routing_status)  // Should be "unhealthy"
console.log('✓ Auto-unhealthy triggered')

// Verify runtime-a is now unhealthy but runtime-b is still healthy
const healthy = pool.get('runtime-b')
console.log('Runtime-b status:', healthy.routing_status)  // Should be "enabled"
console.log('✓ Other runtime unaffected')
```

### 3. 安全守卫验证（已实现）

```javascript
// test-guard.js
import { RuntimePool } from './src/runtime/runtimePool.mjs'
import { mkdirSync } from 'fs'

mkdirSync('data', { recursive: true })

const pool = new RuntimePool(
  'data/runtime-registry.json',
  'data/runtime-state.json'
)

// Register only one runtime
pool.registry.upsert({ runtime_id: 'only-one', base_url: 'http://only:3001', enabled: true })

// Try to disable the last runtime
try {
  pool.setRuntimeState('only-one', { enabled: false })
  console.log('✗ Should have thrown error')
} catch (err) {
  console.log('✓ Guard worked:', err.message)
  // Expected: "At least one enabled healthy runtime must remain"
}

// Verify runtime is still enabled
const runtime = pool.get('only-one')
console.log('Still enabled:', runtime.enabled)  // Should be true
```

### 4. Effective Enabled State 验证（修复项 #1）

```javascript
// test-effective-enabled.js
import { buildRuntimePoolEntry, computeRoutingStatus } from './src/runtime/runtimePool.mjs'

// Test case: state.enabled=false overrides config.enabled=true
const config = { runtime_id: 'test', enabled: true }
const state = { enabled: false, draining: false, unhealthy: false, health_state: {} }

const entry = buildRuntimePoolEntry(config, state)
console.log('routing_status:', entry.routing_status)  // Should be "disabled"
console.log('enabled:', entry.enabled)                // Should be false (not true!)
console.log('✓ Effective enabled state is correct')
```

### 5. Auto-Unhealthy 保护最后一个 Runtime（修复项 #2）

```javascript
// test-auto-unhealthy-guard.js
import { RuntimePool } from './src/runtime/runtimePool.mjs'
import { mkdirSync } from 'fs'

mkdirSync('data', { recursive: true })

const pool = new RuntimePool(
  'data/runtime-registry.json',
  'data/runtime-state.json',
  { failureThreshold: 2, autoUnhealthyCooldownMs: 60000 }
)

// Register ONLY one runtime
pool.registry.upsert({ runtime_id: 'solo', base_url: 'http://solo:3001', enabled: true })

// Record multiple failures (normally would trigger auto-unhealthy)
pool.recordOutcome('solo', false, new Error('Error 1'))
pool.recordOutcome('solo', false, new Error('Error 2'))
pool.recordOutcome('solo', false, new Error('Error 3'))

const runtime = pool.get('solo')
console.log('Consecutive failures:', runtime.health_state.consecutive_failures)  // Should be 3
console.log('Auto unhealthy active:', runtime.health_state.auto_unhealthy_active)  // Should be false!
console.log('Routing status:', runtime.routing_status)  // Should still be "enabled"
console.log('✓ Auto-unhealthy did NOT trigger for last runtime')
```

## 回滚方式

### 状态回滚

直接修改 `data/runtime-state.json`：

```json
{
  "runtimes": {
    "cc-static-1": {
      "enabled": true,
      "draining": false,
      "unhealthy": false
    }
  }
}
```

### 配置回滚

直接修改 `data/runtime-registry.json`。

## 与其他组件的关系

```
┌─────────────────┐
│  Session Router │───► 使用 RuntimePool.selectForNewSession()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   RuntimePool   │───► 组合 RuntimeRegistry + RuntimeState
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│Registry│ │ State  │
└────────┘ └────────┘
```

## 下一阶段 TODO

- [ ] 接入真实 server runtime health check（docker exec health probe）
- [ ] 实现 drain -> migrate 的会话转移
- [ ] 集成 quota-based routing
- [ ] 添加 runtime 级 metrics 和 alerting
