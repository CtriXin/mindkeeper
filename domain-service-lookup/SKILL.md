---
name: domain-service-lookup
description: 自动根据域名查找服务、切换分支并获取配置。可使用中文指令触发，如“帮我用技能查找 xxx 的配置”或“帮我找 xxx 的配置”。
---

# Domain Service Lookup (域名服务查询)

## Description (描述)

This skill automates the workflow of:
(此技能自动化以下工作流：)

1.  Resolving a domain name to its backend service. (将域名解析为其后端服务)
2.  Locating the local git repository. (定位本地 git 仓库)
3.  Switching to the production branch. (切换到生产环境分支)
4.  Extracting the domain's configuration (supports JSON and `web-configs.ts`). (提取域名配置，支持 JSON 和 `web-configs.ts`)

It uses the local `service_lookup.py` script and searches standard project paths.
(它使用本地 `service_lookup.py` 脚本并搜索标准项目路径。)

## Usage (用法)

When you need to find the config for a specific domain, or when the user asks:
(当你需要查找特定域名的配置时，或者当用户询问：)
- "帮我用技能查找 xxx 的配置"
- "帮我找 xxx 的配置"

Run the following command:
(运行以下命令：)

```bash
python3 scripts/lookup.py <domain_name>
```

## Requirements (要求)

-   The `service_lookup.py` script must exist at `/Users/xin/auto-skills/scmp-deploy/scripts/service_lookup.py`.
-   The local repository must be within `/Users/xin`.
