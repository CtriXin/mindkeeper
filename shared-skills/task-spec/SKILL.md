---
name: task-spec
description: 从飞书任务链接自动生成 .ai/task-spec.json 并跑 gate 验证。用户提到 "拆任务"、"task-spec"、"原子拆分"，或直接给飞书任务链接要求拆分时触发；也响应用户说 "/task-spec" 并附带飞书链接。
---

# task-spec

从飞书任务链接自动生成 .ai/task-spec.json 并跑 gate 验证。

## 触发条件

用户提到 "拆任务"、"task-spec"、"原子拆分"，或直接给飞书任务链接要求拆分时触发。
也响应用户说 "/task-spec" 并附带飞书链接。

## 执行步骤

### 1. 解析输入

从用户消息中提取飞书任务信息：

- 如果是飞书 applink URL（`https://applink.feishu.cn/client/todo/detail?guid=...&suite_entity_num=t...`），提取 `guid` 和 `suite_entity_num`
- 如果是纯 task ID（如 `t102782`），用 `lark-cli task +get-my-tasks` 搜索
- 如果用户给了需求描述但没链接，直接跳到步骤 4

### 2. 拉取任务详情

```bash
lark-cli task tasks get --params '{"task_guid":"<guid>"}' --as user
```

提取：`task_id`、`summary`、`description`、`status`

### 3. 拉取需求文档

如果 description 中包含飞书 wiki/doc 链接：

```bash
lark-cli docs +fetch --doc "<token>" --as user --api-version v2
```

提取：功能范围、页面结构、API 接口、数据源、样式要求

### 4. 匹配 task_type

根据任务描述中的关键词匹配最接近的类型：

| 关键词 | task_type | 参考模板 |
|--------|-----------|---------|
| 复制/域名/绑定/domain | domain-binding | task-spec-domain-binding.json |
| 广告/ad slot/ADX | ads-slot | task-spec-ads-slot.json |
| 埋点/事件/telemetry/pixel | telemetry | task-spec-telemetry.json |
| 新建/新模板/新站/new site | new-site | task-spec-new-site.json |
| 博客/多页面/多篇文章 | multi-page | task-spec-multi-page.json |

如果匹配到多个（如"复制+广告"），用 domain-binding 模板（它已包含 ads 流程）。

### 5. 读取参考模板

```bash
cat .ai/examples/<matched-template>
```

### 6. 生成 task-spec

基于参考模板 + 需求文档，填写 `.ai/task-spec.json`：

**task_metadata 字段（从飞书任务填充）：**
- `task_id`: 飞书 suite_entity_num（如 t102782）
- `source_ref`: 飞书 applink URL
- `task_type`: 步骤 4 匹配的类型
- `target_project`: 从需求或 domain lookup 推断
- `target_repo_path`: 从 target_project 推断
- `intake_status`: APPROVED

**items 数组（从需求文档 + 模板生成）：**
- 复制模板的 items 结构
- 把 subject/target/acceptance 中的占位符替换为实际值
- 根据需求文档补充模板中没有的 items（如特殊 API、特殊页面）
- 确保：
  - 每条 acceptance 的 grep/cmd 用实际值
  - depends_on 链完整
  - 最后两条是 VERIFY 类型（本地 build + 生产验证）
  - 倒数第三条是 DEPLOY 类型

### 7. 跑 gate 验证

```bash
yarn ai:check-task-spec
```

- ✅ 通过：告诉用户 spec 已就绪，可以开始执行
- 🚫 失败：自动修复（补 acceptance、改 subject 糊话、修 depends_on），重新跑 gate，最多重试 2 次
- 仍然失败：展示失败原因，让用户手动修复

### 8. 输出结果

展示拆分摘要：
- task_id / type / items 数量
- items 表格（id | type | subject 缩写 | risk）
- gate 结果（通过/失败）

## 注意事项

- 不要凭空编造域名、service 名、repo 路径。从需求文档或 `rf getcf` 获取。
- acceptance 中的 grep 内容必须是需求文档中实际出现的字符串。
- 如果需求文档中有 wiki 图片，尝试下载并用 image-enhancer 或 vision 分析。
- 如果任务已完成（status=done），在 task-spec 注释中标明"回测"。
- 如果用户说"回测"或"测试拆分"，不要写入 `.ai/task-spec.json`，而是写入独立文件如 `.ai/task-spec-<task-id>.json`。
