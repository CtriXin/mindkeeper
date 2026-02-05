# 📖 AI Skills 使用指南

> **简介**: 本项目中所有AI Skills的使用说明和维护指南

## 目录

- [概述](#概述)
- [现有Skills](#现有skills)
- [如何创建新Skill](#如何创建新skill)
- [常见问题](#常见问题)

---

## 概述

Skills是扩展AI能力的指令集合，定义了特定任务的处理流程。每个Skill包含：
- `SKILL.md`: 主要指令文件
- `scripts/`: (可选) 辅助脚本
- `examples/`: (可选) 示例文件

Skills存放位置：`/Users/xin/auto-skills/.skills/`

## 现有Skills

### 1. domain-service-lookup

**功能**: 根据域名自动查找服务配置

**触发词**:
- "帮我用技能查找 xxx 的配置"
- "帮我找 xxx 的配置"

**用法**:
```bash
python3 /Users/xin/auto-skills/domain-service-lookup/scripts/lookup.py <domain_name>
```

**位置**: `/Users/xin/auto-skills/domain-service-lookup/`

---

### 2. knowledge-wiki

**功能**: 知识库文档管理

**触发词**:
- "记录变更"
- "添加wiki"
- "更新文档"
- "查看变更记录"

**用法**: 按照Skill指令中的步骤操作文档文件

**位置**: `/Users/xin/auto-skills/.skills/knowledge-wiki/`

---

## 如何创建新Skill

### 步骤1: 创建目录结构

```bash
mkdir -p .skills/<skill-name>
```

### 步骤2: 创建SKILL.md

```markdown
---
name: <skill-name>
description: 技能描述，包含触发词
---

# Skill标题

## Description
描述技能功能

## Usage
使用方法

## Requirements
前置要求
```

### 步骤3: (可选) 添加脚本

将辅助脚本放入 `scripts/` 目录

### 步骤4: 更新本文档

在"现有Skills"章节添加新Skill的说明

## 常见问题

### Q: Skill无法触发？

A: 检查SKILL.md中的description是否包含正确的触发词，确保frontmatter格式正确

### Q: 如何调试Skill？

A: 可以先手动执行Skill中的命令，确认命令本身能正常工作

---

*创建日期: 2026-02-04*  
*最后更新: 2026-02-04*
