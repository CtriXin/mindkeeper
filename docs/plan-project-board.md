# MindKeeper Project Board 功能规划

## 目标

给 MindKeeper 添加项目级四象限看板 + 备忘 + 提醒能力，替代部分 DST thread 历史展示，让 `brain_bootstrap` 默认展示项目级状态而非对话级。

## 核心变更

### 1. 新增工具：`brain_board`

读写项目的 board.yaml，支持四象限 + 备忘。

**存储路径**：`~/.sce/boards/<project-slug>.yaml`

**board.yaml schema**：

```yaml
project: mindkeeper          # 项目名
repo: /path/to/mindkeeper  # 可选，关联 repo
last_updated: 2026-03-27
stale_warning_days: 14

quadrants:
  q1_urgent_important:
    - id: mk-001
      title: "bootstrap UX 优化"
      deadline: 2026-03-30
      status: active        # active | done | archived
      created: 2026-03-25
  q2_important:
    - id: mk-002
      title: "recipe 跨项目复用"
      status: active
      created: 2026-03-24
  q3_urgent:
    []
  q4_someday:
    []

memos:
  - text: "feature-x 分支已归档"
    created: 2026-03-27
```

**操作**：
- `brain_board(project, action="read")` — 读取指定项目的 board
- `brain_board(project, action="write", data={...})` — 创建/更新 board
- `brain_board(project, action="add_item", quadrant="q1", item={...})` — 添加条目
- `brain_board(project, action="update_item", id="mk-001", changes={...})` — 更新条目
- `brain_board(project, action="list")` — 列出所有项目 board 摘要
- `brain_board(project, action="add_memo", text="...")` — 添加备忘

### 2. 新增工具：`brain_check`

扫描所有 board，返回需要关注的信号（给 brain_bootstrap 调用）。

**输出格式**（只返回有信号的项，避免 token 浪费）：

```
项目看板:
  mindkeeper   — 3项待办, 1项快到期(3天)
  mms          — ⚠️ 18天无更新
  hive-discuss — ✅ 无待办
```

**信号类型**：
- deadline_soon: deadline 在 N 天内（默认 7 天）
- stale_project: 超过 stale_warning_days 无更新
- overdue: 已过 deadline
- active_count: 有活跃待办

### 3. 改造 `brain_bootstrap`

**当前行为**：读最近 thread，返回 next action（对话级）
**新行为**：
- 不传 thread → 显示项目看板 + 最近对话列表（项目级）
- 传 thread → 恢复具体对话（不变，向后兼容）

**新默认输出**：

```
项目看板:
  mindkeeper   — 3项待办, 1项快到期(3天)
  mms          — ⚠️ 18天无更新

最近对话:
  mindkeeper/  dst-20260327-xxx  dst-20260326-xxx
  mms/         dst-20260320-xxx
```

### 4. 提醒机制

基于 `board.yaml` 的 deadline + stale_warning_days，通过 `brain_check` 在每次 bootstrap 时自动检查。

不需要额外 daemon 或 cron，保持轻量。未来可选：OpenClaw bridge 做主动推送。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/types.ts` | 新增 Board/BoardItem/Memo 类型 |
| `src/storage.ts` | 新增 board CRUD + check 扫描逻辑 |
| `src/router.ts` | 注册 brain_board / brain_check 工具 |
| `src/server.ts` | 如需改动（通常不需要） |
| `src/cli.ts` | `dst` 命令默认展示项目级（无 thread 参数时） |

## 不做的事

- 不依赖 OpenClaw（bridge 是未来可选适配器）
- 不引入 cron/daemon
- 不引入数据库（纯 YAML + JSONL）
- 不改现有 thread/checkpoint/recipe 功能

## 已决策（hive-discuss 结论）

1. **board 和 memory 不合并** — board 管时间敏感的任务优先级，memory 管已蒸馏的稳定知识，概念不同
2. **象限分类用混合模式** — 新条目默认 Q2（重要不紧急），用户通过 `priority` 参数覆盖
3. **归档策略** — done 的条目保留 30 天后自动移入 `_archive.yaml`，防止膨胀
4. **brain_check 加 mtime 检查** — 不仅 bootstrap 时扫描，board.yaml 的 mtime 变化时也触发
5. **存储保持 YAML** — 与现有 thread/recipe 风格一致，人类可读可编辑

## 剩余开放问题

1. memo 和 recipe 的边界在哪？什么该进 memo 什么进 recipe？

1. board.yaml 和内置 memory（project 类型）会不会功能重叠？要不要合并？
2. `brain_check` 的信号阈值（deadline 7天？stale 14天？）应该可配还是写死？
3. 四象限的分类由谁决定 — agent 自动判断还是用户手动指定？
4. memo 和 recipe 的边界在哪？什么该进 memo 什么该进 recipe？
5. 是否需要一个 `brain_board_rm` 来清理已完成/归档项，还是只改 status？
