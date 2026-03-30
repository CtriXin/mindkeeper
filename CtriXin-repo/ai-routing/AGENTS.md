# AGENTS.md
<!-- Updated: 2026-03-30 by Codex -->

## Scope

本目录是 `ai-routing` 工作区，不是单一运行时仓库。
当前内含两个独立仓库：

- `crs/`
- `newapi/`

处理子仓库任务时，先读本文件，再读目标子仓库自己的 `AGENTS.md`。

## Startup Order

1. 先确认本次任务落在哪个层级：
   - 当前目录的跨仓库规则
   - `crs/`
   - `newapi/`
2. 若任务只涉及单个子仓库，默认只在该仓库内行动，不跨仓库顺手改。
3. 若任务涉及 `newapi -> CRS` 链路，先检查字段契约、验证路径、回退路径，再动手。
4. 开始任何新的实质性下一步前，先读并更新：
   - `./.ai/plan/current.md`
   - `./.ai/plan/schedule.md`
   - `./.ai/plan/TODO.md`
   - `./.ai/plan/handoff.md`

## Working Rules

- 始终用中文简体回复，technical terms 保持 English。
- 用户说“`不对`”或“`不是这个问题`”时，立即停下并重新定向。
- 优先执行，不反复确认；只有在猜错风险高时才提问。
- 多步或非 trivial 任务，先自检：
  - writable scope
  - validation plan
  - rollback path
  - blast radius
- 默认走最短正确路径，避免 over-design。

## Shared Coordination Files

`ai-routing` 工作区默认维护一套**双方共享**的进度文档：

- `./.ai/plan/current.md`
- `./.ai/plan/schedule.md`
- `./.ai/plan/TODO.md`
- `./.ai/plan/handoff.md`

硬规则：

1. `Codex` 和另一个 agent 每次开始新的下一步前，先更新自己的 lane。
2. 更新前先检查对方 lane，确认是否有冲突、阻塞、越界或重复工作。
3. 任何发现的问题都要先告诉用户，再继续。
4. 不允许把关键进度只留在聊天里，不落文件。
5. 如果某条 lane 的边界、checkpoint、owner 或 blockers 变了，必须同轮更新 shared docs。
6. 任何实际 deploy、smoke、server 命令、live runtime 状态变化，都必须先写入 `./.ai/plan/handoff.md`，不要只留在聊天里。

## Lane Ownership

当前固定按 3 条 lane 协作：

1. `serveragent`
   - 负责：
     - 服务器相关配置检查
     - 公司服务器调试
     - deploy / smoke / live runtime 核查
     - server-side `newapi -> CRS` 行为对比
   - 默认不负责：
     - 本地 `crs/newapi` 装修
     - `Claude` 加固实现
2. `local-renovation`
   - 负责：
     - 本地 `crs/` 和 `newapi/` 的装修、整理、命名、结构收口
   - 默认不负责：
     - 公司服务器 live 调试
     - `Claude` 加固实现
3. `claude-hardening`
   - 负责：
     - `Claude` 加固
     - `Claude-sensitive` 配置、告警、保护逻辑
   - 默认不负责：
     - 公司服务器通用调试
     - 本地装修类收口

硬规则：

- 不跨 lane 顺手接活。
- 如果发现任务已经越过自己的 lane，先停下并写入 shared docs。
- `serveragent` 只在 server-side 事实、server-side config、公司服务器 debug 范围内继续推进。

## Cross-Repo Boundaries

- 默认一次只改一个仓库。
- 没有用户明确要求时，不同时修改 `newapi/` 和 `crs/` 的运行时代码。
- 若必须跨仓库修改，提交前必须明确写出：
  - 哪个字段从哪里来
  - 经过哪些层透传
  - 哪一侧消费
  - 如何验证没有破坏现有 sticky / cache 语义

## Quota Rollout Gate

当前 `quota-aware` 推进阶段只允许做到**状态层**，默认不提前进入**选路层**。

本阶段优先事项：

- `userAccountService`
- `usageTracker`
- Redis 状态层可读写
- `admin/debug endpoint`
- 只读观测日志
- feature flag 接线但默认不生效

本阶段默认禁止：

- scheduler 接入
- quota 选择顺序修改
- `Claude sticky` 改动
- 默认选号修改
- `metadata.user_id` / `Session_id` / `prompt_cache_key` 语义修改
- 把 `X-Newapi-Token` 当成 `Claude session key`

只要准备碰下面任一项，必须先同步影响面，不要等合版时才暴露：

- scheduler 接入点
- quota 选择顺序
- sticky key 逻辑
- `metadata.user_id` 的读取 / 写回 / 转换
- `Session_id` / `prompt_cache_key` 语义
- `channel_affinity` 对 `Claude` 的识别语义
- `pass_headers` / header 契约
- `claudeRelayService` 里真正消费 `X-Newapi-Token`
- Redis key schema 改名 / TTL 变化 / 字段语义变化
- explainability / smoke 口径变化
- config schema / feature flag 默认值变化

当 quota 相关 agent 回传 checkpoint 时，默认使用下面固定格式：

```text
Checkpoint 回传：
1. 改动文件：
2. 新增 Redis keys：
3. 每个 key 的 value 结构：
4. 每个 key 的 TTL：
5. 仅观测字段：
6. 未来参与选路字段：
7. 明确未改：
   - metadata.user_id
   - Session_id
   - prompt_cache_key
   - scheduler 默认顺序
   - sticky key
8. 当前是否达到：
   - 状态层稳定但不接 scheduler，可与 Codex 合版 smoke：是/否
9. 已知风险：
10. 需要 Codex 配合的点：
```

## Routing Contract Invariants

以下语义默认不可私自改动：

- `metadata.user_id`
- `Session_id`
- `prompt_cache_key`
- `X-Newapi-Token`

硬约束：

- 不把用户标识和 session 标识混为一谈。
- 不让 `X-Newapi-Token` 替代 `metadata.user_id` 或 `Session_id`。
- 不私自改变默认 routing / sticky / fallback 行为。
- 不在未告知用户的情况下修改全局配置、不可逆删除、force push、或新增依赖。

## Claude-First Guardrail

这个工作区只有一个最高优先级约束：

- **不能影响 `Claude` 现有可用性**
- **所有涉及 `Claude` 的改动默认按“加固”处理，不按“顺手优化”处理**

凡是涉及下列任一项，默认视为 `Claude-sensitive change`：

- `metadata.user_id`
- `Claude` sticky / session 识别
- `channel_affinity` 的 `Claude` 路径
- `pass_headers` 里的 `Claude` 相关 header
- `newapi -> CRS -> /claude`
- `1M context`
- `Claude OAuth` account 调度、proxy、health、warmup

对 `Claude-sensitive change` 的硬规则：

1. 不允许只凭静态阅读就宣布安全。
2. 不允许把用户身份透传改成 `Claude session key`。
3. 不允许为了兼容别的入口，改变 `Claude` 默认链路语义。
4. 交付前必须明确引用并遵守这些文档：
   - [CRS_MMS_BINDING_RUNBOOK.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/CRS_MMS_BINDING_RUNBOOK.md)
   - [CRS_MMS_QUICKSTART.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/CRS_MMS_QUICKSTART.md)
   - [CRS_MMS_TROUBLESHOOTING_TREE.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/CRS_MMS_TROUBLESHOOTING_TREE.md)
   - [PRIVATE_CRS_SMOKETEST_RUNBOOK.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/PRIVATE_CRS_SMOKETEST_RUNBOOK.md)
5. 若本轮无法完成对应 smoke / log 校验，默认不应宣称“不会影响 Claude”，只能说“未验证”。
6. 若本轮改动触达 `Claude` 主链路，则没有完成 [PRIVATE_CRS_SMOKETEST_RUNBOOK.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/PRIVATE_CRS_SMOKETEST_RUNBOOK.md) 中对应的关键验证项，就不算完成。

## Migrated Context

- 从 `multi-model-switch/` 迁移过来的跨链路文档统一放在：
  - `./docs/`
  - `./scripts/`
  - `./.ai/imported/multi-model-switch/`
- 后续在 `ai-routing/` 工作区继续推进时，优先使用这里的副本，不再把旧目录里的同名文档当成主入口。

## Documentation And Handoff

- 只要落地改动，就在 `./.ai/agent-release-notes.md` 追加记录，不覆盖旧记录。
- `./.ai/agent-release-notes.md` 必须保留在本目录自己的 `.gitignore` 中。
- 若修改的是规则本身，需同步更新相关 `AGENTS.md`，不要只改一个层级。
