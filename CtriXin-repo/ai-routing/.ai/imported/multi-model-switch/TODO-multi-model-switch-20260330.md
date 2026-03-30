# TODO — 四象限管理

## Urgent + Important

### 公司新机器迁移（活跃）

- [ ] **[P0]** 冻结"公司新机器迁移"边界：newapi 以个人正常版本为准，CRS 以 quota-aware-routing 兼容模式为准
  - impact: 5, effort: 4, status: in_progress
  - 详见 [`current.md`](./current.md)
  - source: @user+@agent, created: 2026-03-30
- [ ] 在个人机器先升级并验证新版 CRS，作为公司新机器部署基线 (source: @agent, created: 2026-03-30)
- [ ] 从个人 CRS 与公司 CRS 全量导出可用 OAuth 账户，准备合并导入新机器 (source: @agent, created: 2026-03-30)
- [ ] 在公司新机器重建干净 newapi：仅保留 CRS-OpenAI、CRS-Claude 与国产通道，不继承 libre 历史实验 channel (source: @agent, created: 2026-03-30)
- [ ] 验证公司新机器主链路：direct CRS、newapi → CRS、prompt_cache_key 保留、cached_tokens 与个人基线一致 (source: @agent, created: 2026-03-30)

### MMS vNext Phase 1（即将 worktree 执行）

- [ ] **[P0]** Phase 1 preset schema 规范化 + mms activate（`worktree/preset-schema`）
  - impact: 4, effort: 3, status: ready
  - 详见 [`mms-vnext.md`](./mms-vnext.md) item 1 + 2
  - 碰 `mms_core.py` argparse + schema 读写
  - source: @user, created: 2026-03-30
- [x] **[P0]** Phase 1 debug trace --trace flag（`worktree/debug-trace`）
  - impact: 4, effort: 2, status: completed
  - 详见 [`mms-vnext.md`](./mms-vnext.md) item 3
  - 碰 `mms_core.py` 选择链
  - source: @user, created: 2026-03-30, completed: 2026-03-30

### 独立 Bug

- [ ] **[P0]** Codex context 无限膨胀修复（history.jsonl 无截断）
  - impact: 4, effort: 2, status: pending
  - 详见 [`CODEX_CONTEXT_BLOWUP.md`](./CODEX_CONTEXT_BLOWUP.md)
  - source: @user, created: 2026-03-25
- [ ] **[P0]** 修复 Claude `openai-only provider` 未自动降级断点
  - impact: 3, effort: 2, status: pending
  - source: @user, created: 2026-03-25

## Important + Not Urgent

### MMS vNext Phase 2（负载模式增强 + 能力标签）

- [x] **[P1]** 负载模式 slot 配置灵活化（方向 B，先做）— slot 可命名、可切换、可跨 provider
  - impact: 3, effort: 3
  - source: @user+@claude, created: 2026-03-30, completed: 2026-03-30
- [ ] **[P1]** 负载模式分类维度扩展（方向 A，后做）— classify_task 加上下文长度/语言偏好/工具调用
  - impact: 4, effort: 4
  - source: @user+@claude, created: 2026-03-30
- [ ] **[P1]** preset/profile 导出与导入，敏感字段占位符化（参考 CCR 脱敏策略）
  - impact: 3, effort: 2
  - source: @user, created: 2026-03-30
- [ ] **[P1]** 能力标签与可用性检查（tool use / reasoning / long ctx / bridge required），与负载模式联动
  - impact: 3, effort: 3
  - source: @user, created: 2026-03-30
- [ ] **[P1]** 稳定 model-routes.json schema 作为 MMS ↔ Hive 正式契约
  - impact: 3, effort: 2
  - source: @claude, created: 2026-03-30

### 其他

- [ ] **[P1]** 为 MMS 托管的 Claude session 生成 summary index (source: @user, created: 2026-03-24)
- [ ] **[P1]** 设计并实现 summarize / archive / prune 机制 (source: @user, created: 2026-03-24)
- [ ] **[P1]** provider `model_list_mode` 评估与实现（remote / hybrid / manual） (source: @user, created: 2026-03-24)
- [ ] **[P1]** 在新版 CRS 稳定后逐步启用 quota-aware 排序，不改变现有 sticky key 语义 (source: @agent, created: 2026-03-30)
- [ ] **[P1]** 整理个人正常 newapi 与公司 libre 异常 newapi 的差异 (source: @agent, created: 2026-03-30)

## Urgent + Not Important

- [ ] **[P1]** 补一页 MMS vs CCR 定位对照说明（开源叙事用）
  - 竞品分析已落地 [`ccr-competitive-analysis.md`](./ccr-competitive-analysis.md)，还需转化为面向用户的文档
  - source: @claude, created: 2026-03-30
- [ ] 输出公司新机器切换 runbook：灰度验证、回退策略、旧机器保留时长 (source: @agent, created: 2026-03-30)

## Neither / Deferred

- [ ] **[P2]** 视需要补充 provider 兼容性矩阵状态标签 (source: @user, created: 2026-03-25)
- [ ] **[P2]** 视需要补充 provider 模型别名 / 展示名映射 (source: @user, created: 2026-03-24)
- [ ] **[P2]** 探索 sidecar Web UI 作为管理面（Phase 3） (source: @user+@claude, created: 2026-03-30)
- [ ] **[P2]** adapter/plugin 机制，收敛 provider 差异（Phase 3） (source: @user+@claude, created: 2026-03-30)
- [ ] **[P2]** 团队 preset 分发 / registry（Phase 3） (source: @user+@claude, created: 2026-03-30)

## Archive Pointer

- 已完成项已转存到 `docs/archive/todo-archive-2026-03.md`
