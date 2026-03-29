# Changelog

## v2.1.0 (2026-03-27)

### New Features

- **Bootstrap 自动推送**: `brain_bootstrap` 冷启动时自动匹配 recipe，输出 ≤3 条摘要（score > 0.5）
- **Recipe 衰减检测**: `brain_list` / `brain_recall` / `brain_check` 标记过时 recipe（90天未访问/低置信度/框架过时）
- **Recipe 自动降权**: `brain_check` 时对 accessCount=0 且 180+天的 recipe 降 confidence 到 0.3
- **Board 僵尸 item 检测**: active 但 90+天未更新的 board item 显示 💤 信号
- **Board-Thread-Recipe 三域关联**:
  - `brain_checkpoint` 回执显示关联 board items
  - Board item 标 done 时提示提取 recipe
  - `brain_learn` 自动关联匹配的 board item
- **brain_list 健康摘要**: 显示 recipe 库的活跃/过时/已降权统计

### Improvements

- **Recall 语义升级**: 同义词从 17 组扩到 55+ 组（按前端/后端/DevOps/通用分类）
- **Trigram 模糊匹配**: 精确/子串匹配失败时 fallback（similarity > 0.4）
- **Tags 参与评分**: 精确 +0.5、子串 +0.25（trigger 权重的一半）
- **Query 预处理**: CamelCase/kebab-case 拆分 + 30+ 缩写展开（cfg→config, btn→button 等）
- **Related recipe boost**: 匹配到的 recipe 有 related 字段时 boost 关联 recipe +0.2
- **导出 extractKeywords**: 供 bootstrap/distill/storage 模块复用

### Type Changes

- `RecipeMeta`: 新增 `lastVerified?`, `boardItemId?`, `related?`
- `BoardSignal.type`: 新增 `'stale_item'`
- 新增 `RecipeStalenessSignal` 接口

## v2.0.0 (2026-03-25)

- Recipe 驱动架构：从自由 markdown 迁移到结构化 Recipe（steps/files/gotchas/corrections/changelog）
- 8 个 MCP 工具：brain_learn/recall/list + brain_bootstrap/checkpoint/threads + brain_board/check
- 四象限看板（Board）系统
- Thread 蒸馏与恢复

## v1.0.0 (2026-03-20)

- 初始版本：brain_search/store/recall/bootstrap/checkpoint
- 自由 markdown 知识单元
