# Key Management

> 文档版本：2026-04-08
> 类型：Gateway Ingress Auth

## 概述

Key management 为 `cc-official-broker` gateway 提供**持久化的接入鉴权**。客户端通过 API key 访问 gateway，key 以 SHA-256 哈希存储，支持 active / disabled 状态管理。

注意：

- `/v1/keys` 管理面不是匿名开放的
- Phase 1 下，管理 key 需要一个已存在的有效 key，或沿用 legacy `/auth/device` 路径拿到的 access token 做 bootstrap

## 边界（Key 管什么、不管什么）

### Key 负责的事

- **Gateway 接入鉴权**：验证客户端是否有权访问 broker
- **访问统计**：记录 last_used_at / last_used_ip
- **生命周期管理**：创建、禁用、启用、删除

### Key 不负责的事

- **不等于 Official OAuth**：Official OAuth 凭证由服务器侧 Docker 容器独占管理，key 不涉及任何 upstream Anthropic auth
- **不负责 routing / sticky**：routing 由 `device_id/workspace_id/session_id` 决定，key 不编码也不参与路由决策
- **不负责 session 绑定**：key 不携带 `device_id`、`workspace_id`、`session_id` 等字段
- **不负责多租户隔离**：Phase 1 是单用户场景

## Key Model

每条 key record 包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `key_id` | string | 唯一标识，格式 `key-<hex>` |
| `secret_hash` | string | SHA-256 hex digest，不明文存储 |
| `key_prefix` | string | 显示用前缀，如 `sk_live_x...yzw` |
| `status` | string | `active` 或 `disabled` |
| `label` | string | 可选的可读标签 |
| `note` | string | 可选备注 |
| `created_at` | string | ISO 8601 时间戳 |
| `updated_at` | string | ISO 8601 时间戳 |
| `last_used_at` | string|null | 最后使用时间 |
| `last_used_ip` | string|null | 最后使用 IP |

## Key 生成规则

- 使用 `crypto.randomBytes(24)` 生成 192-bit 随机数
- 前缀 `sk_live_` + base64url 编码
- 明文 key **仅在创建时返回一次**，之后不可恢复

## Key 校验路径

```
客户端请求
  ↓
IP Allowlist 检查（第一关）
  ↓
提取 token（Authorization: Bearer / x-api-key / ?access_token=）
  ↓
计算 token 的 SHA-256 hash
  ↓
在 key registry 中查找匹配的 hash
  ├─ 找到且 status=active → 通过
  ├─ 找到但 status=disabled → 403 api_key_disabled
  └─ 未找到 → 回退到 legacy token 检查（state.tokens）
      ├─ 匹配 → 通过（legacy 兼容模式）
      └─ 未匹配 → 401 invalid access token
```

### disabled key 行为

- 返回 `403 Forbidden`
- 错误类型：`api_key_disabled`
- 不回退到 legacy token 检查（直接拒绝）

## 与现有 Auth 的关系

### 现有 Auth 流程（保持不变）

1. `POST /auth/device` — device_key 验证，签发 in-memory stub token
2. 后续请求用 stub token 鉴权（`state.tokens` Map）

### 新增 Key Auth（独立层）

- Key registry 是**独立的持久化验证层**
- 通过 `state.tokens` 回退保持向后兼容
- 现有 device_key → stub token 流程不受影响
- 两种方式可以并存

### 认证优先级

1. Key manager registry（持久化）
2. Legacy in-memory token（向后兼容）

## API Endpoints

### POST /v1/keys — 创建 Key

```bash
curl -X POST http://localhost:3000/v1/keys \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "my-key", "note": "development access"}'
```

响应：
```json
{
  "ok": true,
  "key_id": "key-a1b2c3d4e5f6",
  "api_key": "sk_live_xxxxxxxxxxxxxxxxxxxx",
  "key_prefix": "sk_live_x...yzw",
  "status": "active",
  "label": "my-key"
}
```

**注意**：`api_key` 字段只在创建时返回，后续无法恢复。

### GET /v1/keys — 列出所有 Key

```bash
curl -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  http://localhost:3000/v1/keys
```

### GET /v1/keys/:key_id — 查看 Key 详情

```bash
curl -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  http://localhost:3000/v1/keys/key-a1b2c3d4e5f6
```

### PATCH /v1/keys/:key_id — 更新 Key

禁用：
```bash
curl -X PATCH http://localhost:3000/v1/keys/key-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "disabled"}'
```

启用：
```bash
curl -X PATCH http://localhost:3000/v1/keys/key-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

更新标签：
```bash
curl -X PATCH http://localhost:3000/v1/keys/key-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "renamed", "note": "updated"}'
```

### DELETE /v1/keys/:key_id — 删除 Key

```bash
curl -X DELETE http://localhost:3000/v1/keys/key-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN"
```

### Healthz 端点（已更新）

`GET /healthz` 现在返回 key management 状态：

```json
{
  "ok": true,
  "key_management": {
    "enabled": true,
    "registry_path": "data/key-registry.json",
    "total": 2,
    "active": 1,
    "disabled": 1
  }
}
```

## 使用 Key 鉴权

### Bearer Token 方式

```bash
curl http://localhost:3000/sessions \
  -H "Authorization: Bearer sk_live_xxxxxxxxxxxxxxxxxxxx"
```

### x-api-key 方式

```bash
curl http://localhost:3000/sessions \
  -H "x-api-key: sk_live_xxxxxxxxxxxxxxxxxxxx"
```

## 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `CC_BROKER_KEY_REGISTRY_PATH` | `data/key-registry.json` | Key registry 文件路径 |

## 文件存储

```
data/
├── key-registry.json          # key 管理注册表
├── runtime-registry.json      # runtime 配置（C5）
└── runtime-state.json         # runtime 状态（C5）
```

## 部署 / 验证 / 回滚

### 部署

1. 代码部署后，`data/key-registry.json` 自动创建（首次写入时）
2. 准备一个管理凭证：
   - 已存在 active key；或
   - legacy `/auth/device` 返回的 access token
3. 创建一个初始 key：
   ```bash
   curl -X POST http://localhost:3000/v1/keys \
     -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
     -d '{"label": "default"}'
   ```
4. 将返回的 `api_key` 配置到客户端环境变量

### 验证

```bash
# 1. 创建 key（需管理凭证）
KEY=$(curl -s -X POST http://localhost:3000/v1/keys \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -d '{"label": "test"}' | jq -r '.api_key')

# 2. 用 key 访问 gateway
curl -H "Authorization: Bearer $KEY" http://localhost:3000/healthz

# 3. 禁用 key
curl -X PATCH http://localhost:3000/v1/keys/key-xxx \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -d '{"status": "disabled"}'

# 4. 验证禁用后返回 403
curl -H "Authorization: Bearer $KEY" http://localhost:3000/healthz
# 预期: 403 {"error": "api_key_disabled"}
```

### 回滚

1. 删除 `data/key-registry.json` 文件
2. 系统自动回退到 legacy token 模式（in-memory state.tokens）
3. 重启服务即可

## Bootstrap 边界

- Phase 1 还没有完整 admin role system
- 第一个持久化 key 的 bootstrap 依赖：
  - 已存在的 active key；或
  - legacy `/auth/device` 返回的 access token
- 后续若要对外长期使用，应补独立 admin bootstrap / rotation 流程

## 安全注意事项

1. **SHA-256 非加盐哈希**：适用于 key 这类高熵值随机字符串，不需要 bcrypt/argon2 的慢哈希
2. **明文 key 仅返回一次**：创建后不可恢复，丢失只能重新创建
3. **数据文件不进 git**：`data/` 目录已在 `.gitignore` 中
4. **key 不编码任何业务语义**：不包含 user/device/workspace/session 信息

## Phase 1 已实现 / 未实现

### 已实现

- [x] 最小 key model（key_id, secret_hash, key_prefix, status, label, note, timestamps）
- [x] SHA-256 hashed storage（不明文持久化）
- [x] active / disabled 状态管理
- [x] Key 创建 / 列表 / 详情 / 更新 / 删除 API
- [x] Bearer token 和 x-api-key 两种提取方式
- [x] 与现有 legacy token 流程向后兼容
- [x] 健康检查端点暴露 key 统计
- [x] 使用追踪（last_used_at, last_used_ip）
- [x] 数据目录 .gitignore 保护

### 未实现（后续阶段）

- [ ] Key rotation（生成新 secret 替换旧的）
- [ ] Per-key endpoint allowlist（限制 key 可访问的路由）
- [ ] Per-key runtime allowlist（限制 key 可路由到的 runtime）
- [ ] Usage audit / quota per key
- [ ] Admin role 区分（admin vs client）
- [ ] 多 key 并发管理界面
- [ ] key 过期时间（TTL）
- [ ] 内容日志中的 secret 脱敏

## 文件列表

| 文件 | 说明 |
|------|------|
| `src/auth/keyStore.mjs` | 文件存储层，原子 JSON 写入，SHA-256 hash 比较 |
| `src/auth/keyManager.mjs` | 业务逻辑层，key 生成、hash、验证、生命周期管理 |
| `src/broker/stubServer.mjs` | 集成点，key auth + legacy token 兼容 + `/v1/keys` API |
| `src/config.mjs` | 新增 `keyRegistryPath` 配置项 |
| `docs/KEY_MANAGEMENT.md` | 本文档 |
