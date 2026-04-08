# C1 Key Management — Handoff

> 交付时间：2026-04-08
> Agent：claude (codex-main)
> 分支：feature/cc-official-broker-native-gateway-mainline
> worktree：/Users/xin/auto-skills-wt-cc-official-broker-native

## 一句话结论

Phase 1 key management 已落地：持久化 key registry（SHA-256 hashed），支持 active / disabled 状态管理，接入 broker stub server 的 HTTP + WebSocket 鉴权路径；`/v1/keys` 管理面现已要求有效 key 或 legacy token，与现有 legacy token 流程向后兼容。

## Changed Files

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/auth/keyStore.mjs` | **新增** | 文件存储层 — JSON registry、原子写入、constant-time hash 比较 |
| `src/auth/keyManager.mjs` | **新增** | 业务逻辑层 — key 生成(192-bit)、SHA-256 hash、验证、生命周期 CRUD |
| `src/broker/stubServer.mjs` | **修改** | 导入 keyManager；新增 `authenticateRequest()` 统一鉴权函数；替换 4 处 `state.tokens.has(token)` 为统一鉴权；新增 `/v1/keys` CRUD 端点；healthz 增加 key 统计 |
| `src/config.mjs` | **修改** | 新增 `keyRegistryPath` 配置项（`CC_BROKER_KEY_REGISTRY_PATH`） |
| `.gitignore` | **修改** | 新增 `data/` 排除 |
| `docs/KEY_MANAGEMENT.md` | **新增** | 完整文档：边界、模型、API、验证、回滚 |

## 已落地

- [x] 最小 key model — key_id, secret_hash, key_prefix, status, label, note, timestamps
- [x] SHA-256 hashed storage — 明文 key 仅在创建时返回一次
- [x] active / disabled 状态 — disable 后 403，enable 后恢复正常
- [x] Key 创建/列表/详情/更新/删除 API（`/v1/keys`，需有效 key 或 legacy token）
- [x] Bearer token + x-api-key 两种提取方式
- [x] 与 legacy `state.tokens` 流程向后兼容（key 优先，无匹配回退 legacy）
- [x] WebSocket 路径（runner/connect, sessions/:id/stream）同样接入 key auth
- [x] healthz 端点暴露 key 统计
- [x] 使用追踪（last_used_at, last_used_ip）

## 未做

- [ ] Key rotation（生成新 secret 替换旧的 hash）
- [ ] Per-key endpoint allowlist / runtime allowlist
- [ ] Usage audit / quota per key
- [ ] Admin role 区分
- [ ] key 过期时间（TTL）
- [ ] 日志中 secret 脱敏
- [ ] C3 / C5 相关改动

## 验证方式

```bash
# 启动 broker
node src/index.mjs broker:serve

# 创建 key（需管理凭证）
curl -X POST http://localhost:3000/v1/keys \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -d '{"label":"test","note":"demo"}'
# 返回: {"ok":true,"api_key":"sk_live_...","key_id":"key-..."}

# 用 key 访问 healthz
curl -H "Authorization: Bearer sk_live_..." http://localhost:3000/healthz
# 返回: 200 + key_management stats

# 禁用 key
curl -X PATCH http://localhost:3000/v1/keys/key-xxx \
  -H "Authorization: Bearer $ADMIN_KEY_OR_LEGACY_TOKEN" \
  -d '{"status":"disabled"}'

# 验证禁用
curl -H "Authorization: Bearer sk_live_..." http://localhost:3000/healthz
# 返回: 403 {"error":"api_key_disabled"}

# 删除 key
curl -X DELETE http://localhost:3000/v1/keys/key-xxx
```

## 后续可扩展方向

1. **Rotation** — `rotateKey(keyId)` 生成新 secret，更新 hash，旧 hash 立即失效
2. **Per-key policy** — key record 扩展 `allowed_endpoints` 和 `allowed_runtime_ids` 字段
3. **Audit** — 在 keyManager.authenticateRequest 成功后写 audit log
4. **Multi-key admin** — 当前只有最小管理面保护，后续仍应补 admin role / bootstrap 方案
