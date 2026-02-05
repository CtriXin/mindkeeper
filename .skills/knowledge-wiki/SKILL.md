---
name: knowledge-wiki
description: |
  全局知识库文档管理技能。可在任何项目中使用。
  触发词："帮我记录改动"、"帮我记文档到wiki"、"记录变更"、"添加wiki"、"更新文档"、"查看变更记录"。
  使用方式：直接告诉AI要记录什么内容，AI会自动按照统一格式写入知识库。
---

# 📚 Knowledge Wiki Skill (全局知识库技能)

## Description (描述)

这是一个**全局技能**，可以在任何项目开发时调用，用于：
- 记录迭代更新、功能开发、脚本创建、Bug修复
- 维护Wiki知识文档
- 查询历史变更

## ⚠️ 重要：绝对路径

知识库位置是固定的，使用绝对路径：

```
/Users/xin/auto-skills/docs/
```

无论当前在哪个项目工作，都将变更记录到这个统一位置。

## 文档结构

```
/Users/xin/auto-skills/docs/
├── README.md           # 知识库入口
├── CHANGELOG.md        # 变更总览（时间线索引）
├── index.html          # 网页查看器
├── changelog/          # 详细变更记录（按日期）
│   └── YYYY-MM-DD.md   # 每天的变更详情
├── wiki/               # 知识Wiki（按主题）
│   ├── skills.md       # AI Skills文档
│   ├── scripts.md      # 脚本使用指南
│   └── ...
└── templates/          # 文档模板
    ├── changelog-entry.md  # 变更记录模板
    └── wiki-article.md     # Wiki文章模板
```

## 使用场景

### 场景1: 记录变更 / 记录改动

当用户说：
- "帮我记录改动"
- "帮我记录这次变更"
- "记录一下刚才的改动"
- "把这次修改记录到文档"

**操作步骤：**

1. **获取当前日期**，格式为 `YYYY-MM-DD`

2. **检查当天文件是否存在**：
```bash
ls /Users/xin/auto-skills/docs/changelog/
```

3. **读取模板格式**（如需要）：
```bash
cat /Users/xin/auto-skills/docs/templates/changelog-entry.md
```

4. **创建或追加到当天的changelog文件**：
   - 路径：`/Users/xin/auto-skills/docs/changelog/YYYY-MM-DD.md`
   - 如果文件已存在，在末尾追加新的变更记录（用 `---` 分隔）
   - 如果文件不存在，创建新文件

5. **更新 CHANGELOG.md 索引**：
   - 路径：`/Users/xin/auto-skills/docs/CHANGELOG.md`
   - 在对应月份下添加条目

**变更记录必须包含以下要素**：

```markdown
## 🏷️ [类型] 变更标题

> **摘要**: 一句话描述

### 📋 基本信息
| 项目 | 内容 |
|------|------|
| **变更类型** | `✨ FEATURE` / `🔧 UPDATE` / `🐛 BUGFIX` / `📜 SCRIPT` |
| **影响范围** | 涉及的模块/项目 |
| **相关文件** | 关键文件路径 |

### 🎯 背景与目标
- 问题/需求描述
- 期望目标

### 🔄 实现过程
简要步骤

### ❗ 遇到的问题
- 问题现象
- 原因
- 解决方案

### ✅ 最终结果
- 完成状态

### 📝 经验总结
- 学习心得
```

### 场景2: 记文档到Wiki

当用户说：
- "帮我记文档到wiki"
- "帮我写个wiki文档"
- "创建一个xxx的知识文档"

**操作步骤：**

1. 读取Wiki模板：
```bash
cat /Users/xin/auto-skills/docs/templates/wiki-article.md
```

2. 在 `wiki/` 目录创建新文件：
   - 路径：`/Users/xin/auto-skills/docs/wiki/<topic>.md`

3. 更新 `/Users/xin/auto-skills/docs/README.md` 添加导航链接

4. 更新 `/Users/xin/auto-skills/docs/wiki/skills.md`（如果是新Skill的文档）

### 场景3: 查看历史变更

当用户说：
- "查看最近的变更"
- "看看上次改了什么"

**操作步骤：**

1. 读取变更总览：
```bash
cat /Users/xin/auto-skills/docs/CHANGELOG.md
```

2. 根据需要读取具体日期的详细记录：
```bash
cat /Users/xin/auto-skills/docs/changelog/YYYY-MM-DD.md
```

## 变更类型标签

| 标签 | 使用场景 |
|------|----------|
| `✨ FEATURE` | 新功能开发 |
| `🔧 UPDATE` | 现有功能改进 |
| `🐛 BUGFIX` | Bug修复 |
| `📜 SCRIPT` | 新脚本创建 |
| `📖 DOCS` | 文档更新 |
| `🔨 REFACTOR` | 代码重构 |
| `⚡ PERF` | 性能优化 |

## 跨项目使用说明

当在其他项目（如广告配置、网站开发等）工作时：

1. AI会自动识别触发词（"帮我记录改动"、"帮我记文档到wiki"等）
2. AI使用此Skill中的绝对路径访问知识库
3. 记录内容会包含当前项目的上下文信息
4. 所有记录统一存储在 `/Users/xin/auto-skills/docs/`

## 路径常量（必须使用这些绝对路径）

```
DOCS_ROOT     = /Users/xin/auto-skills/docs/
CHANGELOG_DIR = /Users/xin/auto-skills/docs/changelog/
WIKI_DIR      = /Users/xin/auto-skills/docs/wiki/
TEMPLATE_DIR  = /Users/xin/auto-skills/docs/templates/
CHANGELOG_MD  = /Users/xin/auto-skills/docs/CHANGELOG.md
README_MD     = /Users/xin/auto-skills/docs/README.md
```

## 注意事项

- ✅ 所有文档使用中文编写
- ✅ 变更记录按日期组织，同一天的多个变更放在同一个文件
- ✅ Wiki文档按主题分类，保持独立性
- ✅ 使用统一的Markdown格式
- ✅ 每次变更后更新 CHANGELOG.md 索引
- ✅ 记录中应包含当前工作的项目/仓库信息，方便追溯
