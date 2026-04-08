# Task 01 · Hive Composite

## 类型
- 复合任务
- 推荐：交给 Hive
- 难度：高级

## 执行要求
- 这是 `Hive` 任务，不是普通单 agent 任务。
- 必须通过 `Hive orchestrator` 执行或派发，不要由接单 agent 自己直接完成整包分析。
- 执行后必须登记真实 `run id`。

## 目标
从 `cc-mcp-bridge` 中抽出可复用到底座层的能力清单，并给出迁移优先级，不做真实代码迁移。

## 范围
只读分析：
- `/Users/xin/auto-skills/CtriXin-repo/cc-mcp-bridge`
- `/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker`

## 必答输出
1. 一份 capability inventory
2. 每项能力对应文件路径
3. 哪些应直接复用，哪些应重写，哪些应放弃
4. 建议迁移顺序（P0/P1/P2）
5. 风险点

## 强约束
- 不要改代码
- 不要泛泛而谈
- 必须给到明确文件路径
- 以 `cc-official-broker` 为主线，`cc-mcp-bridge` 为底座能力库
- 重点关注：
  - key 管理
  - `allowed_runtime_ids`
  - source IP allowlist
  - sticky/runtime binding
  - runtime disable/drain/health
  - usage/audit/quota

## 结果回写位置
- `./.ai/coord/handoffs/<timestamp>-hive-to-codex-main.md`
- `./.ai/coord/HIVE_RUNS.md`
- `./.ai/iterations/<latest>/PLAN.md` 追加结果摘要

## Run ID 维护
- 真实 `run id` 必须长期维护在：
  - `/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker/.ai/coord/HIVE_RUNS.md`
