# Sticky Runtime Binding

> 文档版本：2026-04-08
> 阶段：Phase 1 最小实现
> 对应实现切片：C4

## 一句话结论

Phase 1 sticky runtime binding：以 `owner_user_id + device_id + workspace_id + session_id` 为 sticky 主键，将每个会话绑定到一个 runtime，且同一 sticky key 一定命中同一个 runtime。

---

## 核心概念

### Sticky Key（粘性主键）

```
sticky_key = owner_user_id : device_id : workspace_id : session_id
```

- `owner_user_id`：用户身份标识（来自 token routing 或 config）
- `device_id`：设备标识（mac / macmini）
- `workspace_id`：workspace 标识（company / personal）
- `session_id`：会话标识

> **注意**：sticky key 由 caller（stubServer）在调用 `RuntimeBinder.selectRuntimeForSession()` 时构造，binding store 只负责持久化 `(sticky_key → runtime_id)` 的映射。key 本身不塞进 runtime binding store 的 key 里。

### Binding Record（绑定记录）

每条 binding record 包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `runtime_id` | string | 绑定到的 runtime ID |
| `created_at` | number | 首次绑定时间（Unix ms） |
| `updated_at` | number | 最后更新时间（Unix ms） |
| `source` | string | `new`（新建）或 `reused`（复用） |
| `reason` | string | `new_session`（新建会话）或 `resumed_session`（恢复会话） |

---

## 行为语义

### 新会话（无现有 binding）

1. 调用 `RuntimeBinder.selectRuntimeForSession()`
2. `RuntimeBindingStore.get(bindingKey)` → 返回 `null`
3. 调用 `RuntimePool.selectForNewSession()` → 选择第一个 `can_accept_new=true` 的 runtime
4. `RuntimeBindingStore.upsert(bindingKey, runtimeId, { source: "new", reason: "new_session" })`
5. 返回 `{ runtime, reused: false, reason: "created_new_binding" }`

### 已存在 binding，runtime 健康

1. `RuntimeBindingStore.get(bindingKey)` → 返回已有 record
2. `RuntimePool.get(binding.runtime_id)` → 检查 `can_continue`
3. 若 `can_continue === true`：
   - `upsert()` 刷新 `updated_at`，`source: "reused"`
   - 返回 `{ runtime, reused: true, reason: "reused_existing_binding" }`

### 已存在 binding，runtime 不健康

**Phase 1 策略：fail-fast，不自动迁移，不创建 session**

1. `RuntimeBindingStore.get(bindingKey)` → 返回已有 record
2. `RuntimePool.get(binding.runtime_id)` → 检查 `can_continue`
3. 若 `can_continue === false`（`disabled` / `unhealthy` / `draining`）：
   - **不**自动创建新 binding
   - **不**自动迁移到健康 runtime
   - 返回 `{ runtime: null, reused: false, reason: "bound_runtime_not_acceptable" }`
   - **上层（stubServer）直接返回 HTTP 503，不创建/覆盖 session**
   - 失败响应携带 `reason` 字段区分失败类型（`no_healthy_runtime_available` / `bound_runtime_not_acceptable`）

> **为什么 fail-fast 而不是静默 rebind？**
> 自动迁移会引入隐式行为：用户以为 session 命中 runtime A，实际可能静默切到 runtime B。这在 Phase 1 是不可接受的复杂度。
> Phase 1 之后，如果需要，可以扩展为：draining → 允许 rebind；disabled/unhealthy → 拒绝或手动迁移。

---

## 与 Session Isolation 的关系

- 隔离主键 **仍然是** `owner_user_id / device_id / workspace_id / session_id`（来自 `sessionKeys.mjs`）
- `localSessionRegistry.mjs` 继续负责 `proxy_session_id / remote_session_id` 的本地映射
- Runtime binding store 补充的是：**"哪个 session 应该路由到哪个 runtime"** 这层决策

> **不能做的事**：把 sticky 主键塞进 API key 或 key management 层。

---

## Phase 1 已实现 / 未实现

### 已实现（真实接入 stubServer）

- [x] 最小 binding model（`RuntimeBindingStore`）
- [x] File-based 持久化（`data/runtime-binding-store.json`）
- [x] 新会话 → RuntimePool 选择 → 创建 binding
- [x] 已有 binding + healthy runtime → 复用 binding
- [x] 已有 binding + unhealthy runtime → fail-fast（返回 null，不自动 rebind，stubServer 直接返回 503 不创建 session）
- [x] stubServer `POST /sessions`（标准 session 和 direct-connect）均接入 binder
- [x] `runtime.binding` event 记录到 `state.events`（可观测性）
- [x] `/healthz` 暴露 runtime pool 和 binding store 统计
- [x] `CC_BROKER_BINDING_STORE_PATH` 配置项
- [x] `runtime_id` 通过 `x-cc-runtime-id` header 和 `metadata.runtime_id` 写入 upstream 请求

### 未实现（Phase 1 范围外）

- [ ] 自动 rebind：当 bound runtime draining 时静默切换
- [ ] 手动 rebind API（`PATCH /v1/bindings/:key`）
- [ ] Binding TTL / expiration
- [ ] 跨 runtime 主动会话迁移

---

## 文件结构

```
src/
├── runtime/
│   ├── runtimePool.mjs          # C5: runtime 注册 + 状态 + 选择
│   ├── runtimeBindingStore.mjs   # C4: binding 持久化存储
│   └── runtimeBinder.mjs         # C4: binding 决策逻辑
src/
├── broker/
│   └── stubServer.mjs           # C4: 接入 binder（POST /sessions）
src/
└── config.mjs                    # C4: 新增 bindingStorePath

data/
├── runtime-registry.json         # C5
├── runtime-state.json            # C5
└── runtime-binding-store.json    # C4: 粘性 binding 记录
```

---

## 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `CC_BROKER_BINDING_STORE_PATH` | `data/runtime-binding-store.json` | Binding store 文件路径 |
| `CC_BROKER_RUNTIME_REGISTRY_PATH` | `data/runtime-registry.json` | Runtime registry 文件路径 |
| `CC_BROKER_RUNTIME_STATE_PATH` | `data/runtime-state.json` | Runtime state 文件路径 |

---

## 部署 / 验证 / 回滚

### 部署

1. 代码部署后，`data/runtime-binding-store.json` 首次写入时自动创建
2. 若有 `data/runtime-registry.json`，确认至少有一个 `enabled=true && !unhealthy` 的 runtime
3. 无需额外 bootstrap —— stubServer 启动时自动初始化 RuntimePool + BindingStore + Binder

### 验证

#### 1. 直接调用模块验证（推荐先跑这个）

```javascript
// test-binding.js
import { mkdirSync } from "fs"
import { RuntimePool } from "./src/runtime/runtimePool.mjs"
import { RuntimeBindingStore } from "./src/runtime/runtimeBindingStore.mjs"
import { RuntimeBinder } from "./src/runtime/runtimeBinder.mjs"

mkdirSync("data", { recursive: true })

// Setup runtime pool with a test runtime
const pool = new RuntimePool("data/runtime-registry.json", "data/runtime-state.json")
pool.registry.upsert({ runtime_id: "cc-static-1", base_url: "http://localhost:3001", enabled: true })

// Setup binding store and binder
const store = new RuntimeBindingStore("data/runtime-binding-store.json")
const binder = new RuntimeBinder({ pool, store })

// 1. New session → creates binding
const r1 = binder.selectRuntimeForSession({
  ownerUserId: "xin",
  deviceId: "mac",
  workspaceId: "personal",
  sessionId: "sess-001"
})
console.log("New session:", r1.reused, r1.reason, r1.runtime?.runtime_id)
// Expected: reused=false, reason="created_new_binding", runtime_id="cc-static-1"

// 2. Same session → reuses binding
const r2 = binder.selectRuntimeForSession({
  ownerUserId: "xin",
  deviceId: "mac",
  workspaceId: "personal",
  sessionId: "sess-001"
})
console.log("Resumed session:", r2.reused, r2.reason)
// Expected: reused=true, reason="reused_existing_binding"

// 3. Different session → new binding
const r3 = binder.selectRuntimeForSession({
  ownerUserId: "xin",
  deviceId: "mac",
  workspaceId: "personal",
  sessionId: "sess-002"
})
console.log("Another new session:", r3.reused, r3.reason)
// Expected: reused=false, reason="created_new_binding"

// 4. Unhealthy runtime → fail-fast
pool.setRuntimeState("cc-static-1", { unhealthy: true })
const r4 = binder.selectRuntimeForSession({
  ownerUserId: "xin",
  deviceId: "mac",
  workspaceId: "personal",
  sessionId: "sess-003"
})
console.log("After unhealthy:", r4.runtime, r4.reason)
// Expected: runtime=null, reason="bound_runtime_not_acceptable"
```

```bash
node test-binding.js
```

#### 2. API 层验证（stubServer 启动后）

```bash
# 1. 确保 runtime 已注册
# curl or check data/runtime-registry.json

# 2. 启动 stubServer（需要配置）
node -e "
import('./src/broker/stubServer.mjs').then(async ({ startBrokerStub }) => {
  const { close, baseUrl } = await startBrokerStub({
    config: {
      brokerBaseUrl: 'http://localhost:3000',
      ownerUserId: 'xin',
      deviceId: 'mac',
      workspaceId: 'personal',
      bindingStorePath: 'data/runtime-binding-store.json',
      runtimeRegistryPath: 'data/runtime-registry.json',
      runtimeStatePath: 'data/runtime-state.json',
      runtimePool: null  // let stubServer create its own
    }
  })
  console.log('Broker stub running at', baseUrl)
  setTimeout(async () => { await close(); process.exit(0) }, 3000)
})
"

# 3. 查看 /healthz 中的 binding 统计
curl http://localhost:3000/healthz | jq '.runtime_binding, .runtime_pool'

# 4. 观察 state.events 中的 runtime.binding 事件（需要访问内部 state）
# After creating sessions, data/runtime-binding-store.json 会有记录
```

### 回滚

1. **Binding 层回滚**：删除 `data/runtime-binding-store.json`，重启 stubServer
   - 下次请求会生成新 binding（reused=false）
   - 不同 sticky key 会重新选择 runtime
2. **Runtime state 回滚**：修改 `data/runtime-state.json` 中的 `enabled / unhealthy / draining`
3. **Registry 回滚**：修改 `data/runtime-registry.json`

---

## 与其他组件的边界

```
stubServer (HTTP/WS server)
  ├─ POST /sessions → RuntimeBinder.selectRuntimeForSession()
  │                    ├─ RuntimeBindingStore.get(bindingKey)
  │                    │   └─ data/runtime-binding-store.json
  │                    └─ RuntimePool.selectForNewSession() / RuntimePool.get(runtimeId)
  │                        ├─ data/runtime-registry.json
  │                        └─ data/runtime-state.json
  │
  └─ routeSessionInput() → uses session.remoteService.runtime_id (set at creation)
```

**关键边界**：
- `runtimeBinder` 不调用 `localSessionRegistry`——它们是正交维度
- `runtimeBinder` 不做 quota / routing load balancing——那是 Phase 2+
- `RuntimePool.selectForNewSession()` 永远返回 `can_accept_new=true` 的 runtime，不会返回 unhealthy/disabled

---

## 下一阶段 TODO（不包含在 C4）

- [ ] 实现 `PATCH /v1/bindings/:key` 手动 rebind API
- [ ] `draining` 状态的 runtime 允许 rebind（新会话分配新 runtime）
- [ ] Binding TTL / 过期清理
- [ ] 跨 runtime 会话迁移（手动触发，非自动）
