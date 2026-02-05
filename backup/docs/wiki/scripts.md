# 📖 脚本使用指南

> **简介**: 项目中所有实用脚本的说明和使用方法

## 目录

- [概述](#概述)
- [部署相关](#部署相关)
- [域名配置](#域名配置)
- [常见问题](#常见问题)

---

## 概述

本项目包含多个自动化脚本，用于简化日常开发和运维工作。

脚本位置：
- `/Users/xin/auto-skills/bin/` - 全局命令
- `/Users/xin/auto-skills/scmp-deploy/scripts/` - SCMP部署脚本
- `/Users/xin/auto-skills/domain-service-lookup/scripts/` - 域名查找脚本

## 部署相关

### deploy

**功能**: 在不打开SCMP图形界面的情况下执行部署

**位置**: `/Users/xin/auto-skills/bin/deploy`

**前置要求**:
1. 首次使用需要登录获取token
2. 将 `/Users/xin/auto-skills/bin` 加入PATH

**首次登录**:
```bash
python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py login --share-id "<share_id>" --prompt-password
```

**使用方法**:
```bash
deploy <server-name>
```

**交互流程**:
1. 输入分支名
2. 输入版本号
3. (可选) 输入tag/path
4. 确认执行部署

---

### service_lookup.py

**功能**: 根据域名查找对应的后端服务

**位置**: `/Users/xin/auto-skills/scmp-deploy/scripts/service_lookup.py`

**使用方法**:
```bash
python3 /Users/xin/auto-skills/scmp-deploy/scripts/service_lookup.py <domain>
```

---

## 域名配置

### domain-service-lookup

**功能**: 自动查找域名配置（封装版）

**位置**: `/Users/xin/auto-skills/domain-service-lookup/scripts/lookup.py`

**使用方法**:
```bash
python3 /Users/xin/auto-skills/domain-service-lookup/scripts/lookup.py <domain>
```

**返回内容**:
- 域名对应的服务名
- 配置文件位置
- 配置内容

---

## PATH设置

将脚本目录加入PATH以便全局使用：

```bash
# 添加到 ~/.zshrc
echo 'export PATH="/Users/xin/auto-skills/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 常见问题

### Q: deploy命令提示token过期？

A: 重新执行登录命令获取新token

### Q: 脚本权限不足？

A: 添加执行权限：
```bash
chmod +x /path/to/script
```

---

*创建日期: 2026-02-04*  
*最后更新: 2026-02-04*
