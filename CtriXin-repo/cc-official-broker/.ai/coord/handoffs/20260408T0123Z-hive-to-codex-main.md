# Handoff: Hive Capability Extraction — cc-mcp-bridge -> cc-official-broker

- **From**: hive-manual-analysis (Claude Code session)
- **To**: codex-main / next implementation worker
- **Time**: 2026-04-08T0123Z
- **Related branch**: `feature/cc-official-broker-native-gateway-mainline`
- **Related worktree**: `/Users/xin/auto-skills-wt-cc-official-broker-native`
- **Related recovery**: `dst-0408-1x9q4r`

## Task

从 `cc-mcp-bridge` 中抽出可复用到底座层的能力清单，给出迁移优先级，不做真实代码迁移。只读分析。

## Capability Inventory

### C1: Key Management (API Key 全生命周期)
| 维度 | 详情 |
|---|---|
| **源文件** | `cc-mcp-bridge/server/consult_bridge.py` L386-2246 (~1860行) |
| **存储** | `data/api-key-registry.json` |
| **功能** | `sk_live_` 前缀 key 生成、SHA-256 哈希存储、HMAC 安全比对、rotation、状态管理(active/disabled/archived)、role(admin/client)、per-key endpoint/runtime allowlist、usage 跟踪 |
| **cc-official-broker 现状** | 仅有 device_key -> access_token 单步 auth (`src/contracts/authDevice.mjs`)，内存 Map 存储，无 key 管理 API、无 rotation、无 role |
| **判定** | **重写** — Python 单体方法需拆为独立 ESM 模块，但业务逻辑（哈希存储、rotation 流程、role 分级）可直接复用 |
| **优先级** | **P0** — 多租户 gateway 的基础前提 |
| **风险** | 低 — 逻辑清晰，无外部依赖 |

### C2: allowed_runtime_ids (Key 级 Runtime 白名单)
| 维度 | 详情 |
|---|---|
| **源文件** | `consult_bridge.py` L429-441, 2080-2085, 3631-3703 |
| **功能** | API key 的 `allowed_runtime_ids` 字段，scheduler 在选 runtime 时过滤 |
| **cc-official-broker 现状** | 无 — 单远程服务目标，无 runtime pool |
| **判定** | **直接复用** — 逻辑仅 ~30 行，作为 key record 的字段 + scheduler 过滤条件 |
| **优先级** | **P1** — 依赖 C1 (key) 和 C4 (runtime pool) |
| **风险** | 低 |

### C3: Source IP Allowlist
| 维度 | 详情 |
|---|---|
| **源文件** | `consult_bridge.py` L444-478, 1854, 1871, 5892-5898, 5910-5917 (~60行) |
| **配置** | `CC_MCP_BRIDGE_ALLOWED_SOURCE_IPS` (CIDR 逗号分隔), `TRUST_X_FORWARDED_FOR` |
| **功能** | `ipaddress` CIDR 匹配，auth 前第一道 gate，403 拒绝 |
| **cc-official-broker 现状** | 无 |
| **判定** | **直接复用** — 完全独立，可第一个迁入，Node.js 用 `ipaddr.js` 或手写 CIDR match |
| **优先级** | **P0** — 独立性强，安全基础设施 |
| **风险** | 极低 — 无外部依赖 |

### C4: Sticky / Runtime Binding (Session Affinity)
| 维度 | 详情 |
|---|---|
| **源文件** | `consult_bridge.py` L1113-1141, 3187-3714 (~600行) |
| **存储** | `data/session-runtime-map.json` |
| **功能** | session_key -> runtime_id 持久绑定；3 层调度：sticky resume > explicit request > weighted scheduler；迁移工具 |
| **cc-official-broker 现状** | 有 session key 体系 (`src/shared/sessionKeys.mjs`) 但无 runtime pool，无调度，无绑定 |
| **判定** | **重写** — 调度算法需适配 Node.js 事件循环 + cc-official-broker 的 runtime 模型；session key 体系可复用 |
| **优先级** | **P1** — 多 runtime 场景核心，依赖 C5 (runtime lifecycle) |
| **风险** | 中 — 调度逻辑复杂，需充分测试边界条件（draining sticky、fallback、quota exhausted） |

### C5: Runtime Disable/Drain/Health
| 维度 | 详情 |
|---|---|
| **源文件** | `consult_bridge.py` L3109-3396 (~290行) |
| **配置** | `config/runtime-pool.json`, `data/runtime-pool-state.json` |
| **功能** | enabled/disabled/draining/unhealthy 四态；auto-unhealthy（连续失败 >= 3 触发冷却）；PATCH API 控制；健康追踪 |
| **cc-official-broker 现状** | 无 runtime pool — 单远程目标由 env 配置 |
| **判定** | **重写** — 需要定义 cc-official-broker 的 runtime 模型（可能不是 Docker container 而是远程 Claude endpoint），但状态机和 auto-unhealthy 逻辑可复用 |
| **优先级** | **P0** — runtime pool 是 gateway 的核心概念，C4 和 C2 都依赖它 |
| **风险** | 中 — runtime 模型差异可能导致接口不兼容 |

### C6: Usage / Audit / Quota
| 维度 | 详情 |
|---|---|
| **源文件** | `consult_bridge.py` L709-994, 3797-4600, 5987-6043 (~1200行) |
| **存储** | `logs/bridge-requests.jsonl`, `data/quota-cache.json` |
| **功能** | JSONL 请求日志（不含敏感内容）；时间窗口统计 (5h/24h/7d/30d)；per-key/per-runtime/per-account 聚合；Anthropic OAuth quota 拉取 + TTL 缓存；scheduler 跳过 >99% quota 的 runtime |
| **cc-official-broker 现状** | config 中有 `requestLogEnabled`/`requestLogPath` 但无实现代码；无 stats 聚合；无 quota |
| **判定** | **分步迁移** — JSONL logging (直接复用) > Stats aggregation (重写) > Quota (重写，依赖 OAuth) |
| **优先级** | **P1** — logging 是基础设施可先行；stats 和 quota 可后续迭代 |
| **风险** | 低-中 — JSONL 简单；quota 依赖 OAuth 流程和 Anthropic API |

---

## Migration Priority Summary

```
P0 (必须先有，后续依赖):
├── C3: Source IP Allowlist     — 独立，可立即迁入
├── C5: Runtime Pool Lifecycle  — 核心概念，C2/C4/C6 依赖
└── C1: Key Management          — 多租户基础

P1 (P0 完成后):
├── C2: allowed_runtime_ids     — 依赖 C1 + C5
├── C4: Sticky/Runtime Binding  — 依赖 C5
└── C6: Usage/Audit/Quota       — logging 先行，其余可渐进

P2 (锦上添花):
└── Stats dashboard / accounts view — 依赖 C6
```

## 建议迁移顺序

1. **C3 (IP Allowlist)** — 60 行，零依赖，可立刻作为 cc-official-broker 的 HTTP middleware
2. **C5 (Runtime Pool)** — 定义 `RuntimePool` class，从 config JSON 加载，提供 state 管理 API
3. **C1 (Key Management)** — 从 Python 提取 key record schema + 哈希逻辑，实现 ESM 版本
4. **C2 (allowed_runtime_ids)** — 作为 key record 的字段，接入 scheduler 过滤
5. **C4 (Sticky Binding)** — 依赖 runtime pool + scheduler，实现 3 层调度
6. **C6 (Usage/Audit/Quota)** — JSONL logging 先行，stats 和 quota 渐进追加

## 风险点

1. **Python -> Node.js 跨语言**：cc-mcp-bridge 是 Python 单体 (~6000行)，cc-official-broker 是 Node.js ESM。不能直接搬代码，必须理解逻辑后用 JS 重写。
2. **单体耦合**：6 个能力全部交织在 `ConsultBridge` 类中，共享 state（如 `self.api_keys`, `self.runtime_pool`, `self.session_map`）。迁入 cc-official-broker 时需设计清晰的模块边界。
3. **Runtime 模型差异**：cc-mcp-bridge 的 runtime 是 Docker container (有 `claude_container_name`, `egress_ip`)；cc-official-broker 的 runtime 是远程 HTTP endpoint。config schema 需重新设计。
4. **并发模型差异**：Python 用 `threading.Lock`，Node.js 是单线程事件循环。state 管理策略不同。
5. **测试覆盖**：cc-mcp-bridge 无单元测试。迁入时需同步补测试。
6. **Quota OAuth 依赖**：C6 quota 部分依赖 Anthropic OAuth flow，需确认 cc-official-broker 的 runtime endpoint 是否使用同一认证体系。

## Changed Files (本次分析)

无代码变更。纯只读分析产出。

## Current Status

分析完成，capability inventory 和迁移优先级已产出。

## Blockers

无。

## Next Step

根据优先级，建议从 C3 (IP Allowlist) 开始实现，或由 codex-main 决定实际开发顺序。
