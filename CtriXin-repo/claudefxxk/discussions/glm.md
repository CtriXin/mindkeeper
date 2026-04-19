# Claude 痕迹全盘扫描与资产保全手册

> 更新时间: 2026-04-17 23:00
> 系统: macOS Darwin 24.6.0 | Claude Code v2.1.110
> 原则: **只查不动** — 本文档仅做记录和规划，不执行任何删除/移动操作
> 参考: `~/Downloads/Claude Code 封号机制逆向探查 (1).docx`

---

## 一、封号机制关键信号 (参考文档摘要)

根据逆向分析，Anthropic 的封号检测依赖以下信号层：

### 1.1 每请求必带 (无法关闭)
| 信号 | 说明 |
|------|------|
| **IP 地址 + 地理归属** | TLS 连接层可见，无法隐藏 |
| **TLS 指纹 (JA3/JA4)** | 标识客户端 TLS 实现 |
| **User-Agent** | `claude-code/{version}` |
| **Session ID** | 每次会话唯一 |
| **cch Attestation** | Bun 底层 Zig 代码生成的 hash，验证客户端未被修改 |
| **Attribution Header** | 含 cc_version + 3字符指纹 + cc_entrypoint |

### 1.2 设备持久标识
| 信号 | 位置 |
|------|------|
| **userID** | `~/.claude.json` |
| **anonymousId** | `~/.claude.json` |
| **firstStartTime** | `~/.claude.json` |
| **numStartups** | `~/.claude.json` |
| **tipsHistory** | `~/.claude.json` (使用习惯) |
| **cachedGrowthBookFeatures** | `~/.claude.json` (92 个 feature flag) |
| **statsig stable_id / session_id** | `~/.claude/statsig/` |
| **telemetry** | `~/.claude/telemetry/` |
| **tracking/** | `~/.claude/tracking/` |

### 1.3 环境探测
| 信号 | 说明 |
|------|------|
| **OS + 硬件信息** | 每个遥测事件附带 |
| **运行环境检测** | 检测 Docker/WSL/CI 等 |
| **AI Gateway/代理检测** | 主动检测是否使用代理网关 |
| **git config user.email** | 即使未用 OAuth 也会采集 |
| **GitHub Actions 元数据** | CI 环境自动采集 |

### 1.4 关键警告 (参考文档 9.3 节)
> **关闭遥测本身可能是更大的风险。** 原因：
> 1. 关闭遥测自带地域标签 — 关闭遥测的中文用户比例显著偏高
> 2. 关不掉的远多于关掉的 — IP、TLS 指纹、OAuth Token 等一个都没少
> 3. 关闭遥测会同时关闭付费功能 — GrowthBook 被禁用后 Opus 4.6 1M 静默消失

---

## 二、全盘痕迹清单

### 2.1 二进制文件

| 路径 | 类型 | 大小 |
|------|------|------|
| `~/.local/bin/claude` | symlink → versions/2.1.110 | — |
| `~/.local/share/claude/versions/2.1.109` | Mach-O arm64 | 192 MB |
| `~/.local/share/claude/versions/2.1.110` | Mach-O arm64 (当前) | 194 MB |
| **合计** | | **386 MB** |

二进制内嵌遥测 URL: Datadog, GrowthBook, BigQuery 等上报地址。**修改二进制违反 cch 校验。**

---

### 2.2 设备身份文件 `.claude.json`

| 位置 | 关键字段 | 说明 |
|------|----------|------|
| `~/.config/mms/claude-gateway/.claude.json` | numStartups=261, anonymousId=claudecode.v1.14a04ad4-..., 92个 GrowthBook features | **MMS 网关根设备 ID** |
| `~/.config/mms/accounts/claude-max-justin/.claude.json` | 各账户独立身份 | Justin 账户 |
| `~/.config/mms/accounts/claude-tonnya/.claude.json` | 各账户独立身份 | Tonyya 账户 |
| `~/.claude.json` (真实路径) | **不存在** (当前被 MMS 虚拟化) | — |

**MMS 网关根 `.claude.json` 详细字段：**
```
numStartups: 261
firstStartTime: 2026-03-13T07:50:43.393Z
installMethod: native
anonymousId: claudecode.v1.14a04ad4-cd0b-45b6-b85d-cb5ee9090d13
autoUpdates: false
cachedGrowthBookFeatures: 92 keys (含 tengu_attribution_header, tengu_amber_prism 等)
tipsHistory: 33 keys (含使用习惯记录)
```

---

### 2.3 Keychain 条目 (macOS 系统级)

| 服务名 | 账户 | 创建时间 | 说明 |
|--------|------|----------|------|
| `Claude Safe Storage` | `Claude` | 2026-03-19 | **Claude 桌面应用加密存储密钥** |
| `Claude Safe Storage` | `Claude Key` | 2026-03-19 | **Claude 桌面应用额外密钥** |
| `Claude Code-credentials-e549de00` | `xin` | — | **Claude Code OAuth token (带设备指纹后缀)** |
| `Claude Code-credentials` | `xin` | — | **Claude Code 主凭证** |
| `Claude Code-credentials` | `unknown` | — | **另一组凭证** |

> **注意**: Keychain 条目在 `rm -rf ~/.claude/` 后依然存在。必须用 `security delete-generic-password` 显式删除。

---

### 2.4 `~/.claude/` 当前会话 (MMS 虚拟化)

**虚拟路径**: `/Users/xin/.config/mms/claude-gateway/s/86175/.claude/`
**HOME 映射**: 被设置为 `~/.claude/` (MMS 会话隔离)

| 条目 | 类型 | 实际指向 |
|------|------|----------|
| `settings.json` | 实体文件 | hooks, permissions, statusLine 配置 |
| `settings.json.lock` | 实体文件 | 锁文件 |
| `file-history/` | symlink | `~/.config/mms/projects/.../raw/file-history` |
| `history.jsonl` | symlink | `~/.config/mms/projects/.../raw/history.jsonl` |
| `sessions/` | symlink | `~/.config/mms/projects/.../raw/sessions` |
| `transcripts/` | symlink | `~/.config/mms/projects/.../raw/transcripts` |
| `plans/` | 实体 (空) | — |
| `session-env/` | 实体 | 当前会话 UUID |
| `shell-snapshots/` | 实体 | zsh 环境快照 |
| `plugins/` | 实体 | 33+ 官方插件 + 16+ 外部插件 |
| `known_marketplaces.json` | 实体 | 指向 anthropics/claude-plugins-official |

---

### 2.5 `~/.claude.bak/` 历史数据 (5.4 GB)

这是 MMS 上线前的原始 `~/.claude/` 目录，包含大量追踪数据：

| 目录/文件 | 数量/大小 | 追踪风险 |
|-----------|-----------|----------|
| `telemetry/` | 33 个文件 (~10 MB) | **极高** — 遥测上报数据 |
| `tracking/` | config.json + index.json + projects/ | **极高** — 跟踪配置 |
| `statsig/` | cached evaluations + stable_id + session_id | **极高** — Statsig 追踪 ID |
| `stats-cache.json` | 9.8 KB | **高** |
| `sessions/` | 85 个会话 | **高** — 完整对话记录 |
| `transcripts/` | 80 个转录 | **高** |
| `file-history/` | 88 个目录 | **高** — 文件修改历史 |
| `history.jsonl` | 408 KB / 130 行 | **高** — 命令历史 |
| `debug/` | 222 个文件 | 中 |
| `projects/` | 37 个项目目录 | 中 — 暴露项目结构 |
| `session-env/` | 85 个 | 中 |
| `plans/` | 19 个 | 低 |
| `todos/` | 118 个 | 低 |
| `teams/` | 7 个 | 低 |
| `tasks/` | 9 个 | 低 |
| `backups/` | 6 个 | 低 |
| `ide/` | 10 个 | 低 |
| `paste-cache/` | 36 个 | 低 |
| `image-cache/` | 1 个 | 低 |
| `CLAUDE.md` | 2.3 KB | 需保留 |
| `settings.json` | 1.7 KB | 需保留 (hooks 配置) |
| `settings.local.json` | 2.4 KB | 需保留 |
| `skills/` | 51 个技能 | **需保留** |
| `.claude/` | 嵌套副本 | 同上 |

---

### 2.6 MMS 网关层 (`~/.config/mms/` 4.9 GB)

| 路径 | 内容 | 追踪风险 |
|------|------|----------|
| `config.toml` (26 KB) | 5 账户配置，14+ provider | **高** — 含代理地址 |
| `credentials.sh` (15 KB) | **所有 API key 明文** | **极高** |
| `model-routes.json` (50 KB) | 路由表 + 嵌入 API key | **极高** |
| `claude-gateway/.claude.json` | 设备 ID + 92 GrowthBook flags | **极高** |
| `claude-gateway/.claude/.credentials.json` | Figma OAuth secrets | 高 |
| `claude-gateway/.claude/settings.json` | 网关 settings | 高 |
| `claude-gateway/s/` | 5 个活跃会话 (86175 等) | 高 |
| `accounts/claude-max-justin/` | Justin 账户 .claude.json + settings | 高 |
| `accounts/claude-tonnya/` | Tonyya 账户 .claude.json + settings + 5 备份 | 高 |
| `projects/` | **100+ 项目目录** (hashed keys) | 高 |
| `events/` | 8 个 JSONL 事件日志 (4/12-4/18) | 高 |
| `usage.json` (22 KB) | 每来源用量追踪 | 中 |
| `speed-stats.json` (69 KB) | 模型性能数据 | 低 |
| `health-cache.json` | Provider 健康检查 | 低 |
| `account-guard-state.json` | 账户失败追踪 | 低 |
| `config-audit.jsonl` (73 KB) | 配置变更审计日志 | 中 |
| `lb_debug.log` (10 MB) | 负载均衡调试日志 | 中 |
| `backups/` | 167 个配置备份目录 | 中 |

---

### 2.7 `~/.cc-switch/` (Claude Code 账户切换工具)

| 条目 | 大小 | 说明 |
|------|------|------|
| `cc-switch.db` | 4.8 MB | **账户切换历史数据库** |
| `cc-switch2.db` | 602 KB | 旧版数据库 |
| `settings.json` | 656 B | 切换工具配置 |
| `skills/` | 19 个目录 | 共享技能 (symlink 源) |
| `backups/` | 13 个目录 | 配置备份 |
| `logs/` | 日志 | 操作日志 |
| `skills-review.md` | 5.4 KB | 技能审查记录 |

---

### 2.8 `~/.agents/` (跨产品共享技能)

| 条目 | 说明 |
|------|------|
| `skills/` | 4 个共享技能 (search, web-search, skill-vetter, ai-image-generation) |
| `.skill-lock.json` | 技能锁定状态 |

---

### 2.9 项目级 `.claude/` 目录 (84 个)

分布在以下位置，每个可能含 sessions, memory, project-level CLAUDE.md：

| 类别 | 路径模式 | 数量 |
|------|----------|------|
| auto-skills 主项目 | `~/auto-skills/.claude/` + worktrees | 12 |
| auto-skills 子项目 | `~/auto-skills/CtriXin-repo/*/.claude/` | 7 |
| 游戏项目 | `~/game_center/`, `~/game_robot/` (+worktrees), `~/gamesnest-org/` | 11 |
| 临时 worktree | `~/auto-skills-wt-*/.claude/` | 3 |
| 其他项目 | polymarket, rednote, keypool, knowledge-wiki, copy_calculator 等 | 40+ |
| 编辑器扩展 | `.cursor/`, `.vscode/`, `.trae/` 中的 prettier 扩展 | 4 |
| 杂项 | `~/Downloads/`, `~/bs账号claude/`, `~/vue2-init-*/` 等 | 7 |

---

### 2.10 VS Code / 编辑器生态

| 位置 | 内容 |
|------|------|
| `~/.vscode/extensions/anthropic.claude-code-2.1.112-darwin-arm64` | VS Code Claude 扩展 (当前) |
| `~/.vscode/extensions/anthropic.claude-code-2.1.109-darwin-arm64` | VS Code Claude 扩展 (旧版) |
| `~/Library/Application Support/Code/CachedExtensionVSIXs/anthropic.claude-code-2.1.112-darwin-arm64` | 缓存 VSIX (64 MB) |
| `~/Library/Application Support/Code/CachedExtensionVSIXs/anthropic.claude-code-2.1.109-darwin-arm64` | 缓存 VSIX (63 MB) |
| `~/Library/Application Support/Code/logs/.../Anthropic.claude-code/` | 扩展日志 (2天) |
| `~/Library/Application Support/Zed/external_agents/registry/icons/claude-code-acp.svg` | Zed 编辑器 Claude 图标 |

---

### 2.11 /tmp/ 临时文件

| 路径 | 内容 | 大小 |
|------|------|------|
| `/tmp/claude-501/` | 28 个项目目录 × 多 session task output | 5.4 MB |
| `/tmp/claude-ban-investigation.md` | 封号研究文档 | — |
| `/tmp/claude_doc.md` | 封号研究文档副本 | — |
| `/tmp/fix_us_oracle_claude_network.sh` | Claude 代理部署脚本 | — |
| `/tmp/claude-socks-bridge.service.new` | systemd 服务模板 | — |
| `/tmp/us-cpa-migrate-20260415/` | cli-proxy-api-claude 迁移数据 | — |
| `/tmp/crs-upstream-check/CLAUDE.md` | 上游检查项目 | — |
| `/tmp/hive-*-.claude/` | Hive 测试 worktree | — |

---

### 2.12 代理/网络规则

| 位置 | 内容 |
|------|------|
| `~/Library/Application Support/mihomo-party/work/ruleset/claude.yaml` | Claude 流量路由规则 (anthropic.com, claude.ai, cdn.usefathom.com) |

---

### 2.13 其他 Claude 相关进程

| 项目 | 说明 |
|------|------|
| `~/.codex/` | OpenAI Codex CLI (兄弟产品)，含 ambient-suggestions 等 |
| `.claude/` 在 codex 工作树 | 部分项目同时有 .codex 和 .claude |

---

## 三、你的资产清单 (必须保全)

### 3.1 Hooks (当前会话)

**配置位置**: `settings.json` → `hooks` 字段

| Hook 类型 | Matcher | 脚本 |
|-----------|---------|------|
| SessionStart | (all) | `~/.claude/hooks/map-auto-index.sh` |
| PostCompact | (all) | `~/.claude/read-once/compact.sh` |
| PostCompact | (all) | `multi-model-switch/hooks/hive-compact-hook.sh` |
| PreToolUse | Bash | `~/.claude/hooks/rtk-rewrite.sh` |
| PreToolUse | Read | `READ_ONCE_DIFF=1 ~/.claude/read-once/hook.sh` |
| PreToolUse | WebFetch | `multi-model-switch/hooks/claude-feishu-webfetch-guard.sh` |
| PreCompact | (all) | `multi-model-switch/hooks/hive-compact-hook.sh` |

**脚本物理位置** (都是实体文件，非 symlink)：
- `/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/hooks/` — 8 个 .sh 文件
  - claude-feishu-prompt.sh
  - claude-feishu-webfetch-guard.sh
  - claude-map-auto-index.sh
  - hive-compact-hook.sh
  - read-once-compact.sh
  - read-once-hook.sh
  - rtk-rewrite.sh
  - statusline-command.sh

**保全策略**:
1. Hook 脚本在 `multi-model-switch/hooks/` 中 — **项目 git 管理，不会丢失**
2. `settings.json` 中的 hooks 配置 — **需要备份 settings.json**
3. read-once 目录下的 compact.sh 和 hook.sh — 需要单独备份

---

### 3.2 StatusLine

**当前配置**:
```json
"statusLine": {
  "type": "command",
  "command": "/bin/bash /Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh"
}
```

**物理脚本**: `/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh`

**旧版脚本** (在 .claude.bak 中):
- `~/.claude.bak/statusline-command.sh`
- `~/.claude.bak/statusline-multi.sh`
- `~/.claude.bak/statusline-test.sh`
- `~/.claude.bak/.claude/statusline-command.sh`
- `~/.claude.bak/.claude/statusline-multi.sh`
- `~/.claude.bak/.claude/statusline-test.sh`

**保全策略**: statusline-command.sh 在 git 管理的项目中 — **不会丢失**，只需确保 settings.json 恢复时包含 statusLine 配置。

---

### 3.3 Skills (技能)

**`.claude.bak/skills/` 中有 51 个技能目录**：

| 类型 | 技能 | 数量 |
|------|------|------|
| **Symlink 到项目** | a2a, fight-agent, moebius, excalidraw-agent-local-kit | 4 |
| **Symlink 到 .cc-switch** | agent-reach, codex, connect, gemini-designer, humanizer, infographic-maker, last30days, mcp-builder, pdf, performance, project-tracker, self-improving-agent, skill-creator | 13 |
| **Symlink 到 .agents** | ai-image-generation, search, skill-vetter, web-search, xiaohongshu-ops | 5 |
| **实体目录** | changelog-generator, doc-coauthoring, docx, domain-service-lookup, domain-tool-expert, find-skills, frontend-design, image-enhancer, internal-comms, knowledge-wiki, planning-with-files, pptx, ui-ux-pro-max, webapp-testing, xlsx | 15 |
| **备份目录** | *.backup-20260312-0012 | 13 |

**保全策略**:
- **Symlink 类**: 只要目标目录存在，重建 symlink 即可
- **实体目录类**: 必须备份！这些是唯一副本
- **.cc-switch/skills/**: 是 symlink 的实际目标，必须保留
- **.agents/skills/**: 跨产品共享技能，必须保留

---

### 3.4 MCP 配置

**当前状态**: 所有 settings.json 中 `"mcpServers": {}` — **空配置**

**MCP 插件市场已下载** (33+ 官方插件 + 16+ 外部插件):
- 路径: `~/.claude/plugins/marketplaces/claude-plugins-official/`
- 包含: github, gitlab, discord, figma, linear, playwright, terraform, telegram 等

**结论**: MCP 配置当前为空，无需特殊保全。插件市场可重新下载。

---

### 3.5 CLAUDE.md (全局指令)

**内容** (全局 Agent 行为规则):
```
- 用户说"不对"时立刻停下来转向
- 优先动手实现，减少反复确认
- 技术术语保留英文，其余用中文
- 3步以上复杂任务用 extended thinking
- Plan 执行前自审 5 维
```

**位置**: `~/.claude.bak/CLAUDE.md` 和 `~/.claude.bak/.claude/CLAUDE.md` (内容相同)

**保全策略**: 复制一份到安全位置。内容简短，也可直接记下来重建。

---

### 3.6 Memory 系统

**项目级 Memory** (当前会话):
- `/Users/xin/.config/mms/claude-gateway/s/86175/.claude/projects/-Users-xin-auto-skills/memory/`

**历史 Memory** (.claude.bak):
- `projects/-Users-xin/memory/`
- `projects/-Users-xin-agent-game-site/memory/`
- `projects/-Users-xin--openclaw/memory/`
- `projects/-Users-xin-game-robot/memory/`

**保全策略**: Memory 目录内容可在清理前备份。但 memory 本质上是 Claude 的上下文累积，清理后可以重新建立。

---

### 3.7 Plugins (插件市场)

**路径**: `~/.claude/plugins/marketplaces/claude-plugins-official/`
- 33+ 官方插件
- 16+ 外部插件 (figma, github, gitlab, discord, imessage, telegram, etc.)

**保全策略**: 插件市场可从 GitHub 重新下载 (`anthropics/claude-plugins-official`)。如需保留本地状态，备份整个 plugins 目录。

---

## 四、你可能没考虑到的地方

### 4.1 VS Code 扩展日志
`~/Library/Application Support/Code/logs/*/window*/exthost/Anthropic.claude-code/`
- **包含**: 扩展与 Claude Code 的通信日志
- **风险**: 可能含 session ID、API 调用记录
- **操作**: 这些日志按日期自动轮转，但旧日志可能长期保留

### 4.2 VS Code 缓存 VSIX
`~/Library/Application Support/Code/CachedExtensionVSIXs/anthropic.claude-code-*`
- **包含**: 扩展安装包缓存 (每个 ~63 MB)
- **风险**: 含版本号和平台信息
- **操作**: 删除后 VS Code 会自动重新下载

### 4.3 .cc-switch 数据库
`~/.cc-switch/cc-switch.db` (4.8 MB)
- **包含**: 账户切换历史、配置快照
- **风险**: 可能记录了多个 Claude 账户的切换模式和关联
- **操作**: 这是本地工具，不会上报 Anthropic，但包含敏感信息

### 4.4 84 个项目 .claude 目录
- **每个目录可能包含**: sessions/, memory/, project-level CLAUDE.md, session-env/
- **风险**: 项目路径暴露了完整的目录结构和项目名称
- **操作**: 如果做 Level 5 清理，这些目录中的 sessions 和 transcripts 也需要清理

### 4.5 MMS 账户目录中的 .claude.json
`~/.config/mms/accounts/claude-max-justin/.claude.json`
`~/.config/mms/accounts/claude-tonnya/.claude.json`
- **风险**: 每个账户有独立的设备 ID 和追踪数据
- **操作**: 清理时需要逐个账户处理

### 4.6 Git config user.email 泄露
- **当前**: `user.email=songxin@ushareit.com`
- **风险**: Claude Code 会通过 `git config user.email` 采集邮箱，即使未用 OAuth
- **参考**: 逆向文档 4.3 节 — 邮箱收集优先级: OAuth > 员工邮箱 > git config

### 4.7 MMS events 日志
`~/.config/mms/events/*.jsonl` (8 个文件, 4/12-4/18)
- **风险**: 记录了 MMS 网关的所有事件，可能含请求元数据

### 4.8 config-audit.jsonl
`~/.config/mms/config-audit.jsonl` (73 KB)
- **风险**: 配置变更审计日志，记录了所有配置修改历史

### 4.9 Claude Safe Storage Keychain 条目
- 2 个条目 (`Claude` 和 `Claude Key`)
- **这些是 Claude 桌面应用的密钥**，即使只用 CLI 版也可能存在
- 如果安装过 Claude 桌面版，这些条目会保留 OAuth token

### 4.10 当前运行进程
- **5 个 Claude Code 进程**同时运行 (PID: 86500, 84966, 88106, 85278, 83123)
- **5 个 MMS 网关进程**同时运行
- **1 个 Hive agent 进程** (PID: 32956)
- **多个僵尸 shell 进程** (来自旧 session)
- **风险**: 活跃进程持有内存中的 session 状态

### 4.11 Shell 快照
`~/.claude/shell-snapshots/snapshot-zsh-*.sh`
- **包含**: 完整的 PATH 环境变量和 shell 配置
- **风险**: 暴露系统配置和工具安装路径

---

## 五、保全方案

### 5.1 需要保全的资产 (按优先级)

| 优先级 | 资产 | 位置 | 保全方式 |
|--------|------|------|----------|
| P0 | Hook 脚本 | multi-model-switch/hooks/ | **已在 git 中** — 安全 |
| P0 | StatusLine 脚本 | multi-model-switch/statusline-command.sh | **已在 git 中** — 安全 |
| P0 | settings.json (hooks/statusLine/MCP 配置) | ~/.claude/settings.json | **手动备份** |
| P1 | CLAUDE.md 全局指令 | ~/.claude.bak/CLAUDE.md | **手动备份** |
| P1 | 实体 Skills (15个) | ~/.claude.bak/skills/ 中的非 symlink 目录 | **tar 备份** |
| P1 | .cc-switch/skills/ (19个) | ~/.cc-switch/skills/ | **tar 备份** |
| P1 | .agents/skills/ (4个) | ~/.agents/skills/ | **tar 备份** |
| P2 | Memory 数据 | projects/*/memory/ | **可选备份** |
| P2 | Plugins 市场 | ~/.claude/plugins/ | **可重新下载** |
| P2 | .cc-switch 数据库 | ~/.cc-switch/cc-switch.db | **备份后可清** |

### 5.2 备份命令 (一键保全)

```bash
#!/bin/bash
# === Claude 资产保全脚本 ===
# 执行前确保在安全目录下

BACKUP_DIR=~/claude-asset-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

echo "=== 备份 settings.json ==="
# 当前会话 settings
cp ~/.claude/settings.json "$BACKUP_DIR/settings-current.json"
# 历史版本
cp ~/.claude.bak/settings.json "$BACKUP_DIR/settings-bak.json"
cp ~/.claude.bak/settings.local.json "$BACKUP_DIR/settings.local-bak.json"

echo "=== 备份 CLAUDE.md ==="
cp ~/.claude.bak/CLAUDE.md "$BACKUP_DIR/CLAUDE.md"

echo "=== 备份实体 Skills ==="
# 只备份非 symlink 的实体目录
cd ~/.claude.bak/skills/
for d in */; do
  if [ ! -L "$d" ]; then
    cp -r "$d" "$BACKUP_DIR/skill-$d"
    echo "  备份实体技能: $d"
  else
    echo "  跳过 symlink: $d -> $(readlink "$d")"
  fi
done

echo "=== 备份 .cc-switch/skills ==="
cp -r ~/.cc-switch/skills/ "$BACKUP_DIR/cc-switch-skills/"

echo "=== 备份 .agents/skills ==="
cp -r ~/.agents/skills/ "$BACKUP_DIR/agents-skills/"

echo "=== 备份 Memory ==="
cp -r ~/.claude.bak/projects/ "$BACKUP_DIR/projects-memory/" 2>/dev/null

echo "=== 备份 Plugins ==="
cp -r ~/.claude/plugins/ "$BACKUP_DIR/plugins/" 2>/dev/null

echo "=== 备份 .cc-switch 数据库 ==="
cp ~/.cc-switch/cc-switch.db "$BACKUP_DIR/cc-switch.db"

echo "=== 记录 symlink 映射关系 ==="
cd ~/.claude.bak/skills/
for d in */; do
  if [ -L "$d" ]; then
    echo "$d -> $(readlink "$d")" >> "$BACKUP_DIR/symlink-map.txt"
  fi
done

echo ""
echo "=== 备份完成: $BACKUP_DIR ==="
du -sh "$BACKUP_DIR"
```

### 5.3 恢复步骤 (清理后)

```
1. 安装 Claude Code CLI (npm install -g @anthropic-ai/claude-code 或官方安装脚本)

2. 首次启动 — 会自动生成新的 ~/.claude/ 和 ~/.claude.json

3. 恢复 settings.json:
   - 合并备份的 settings-current.json 中的 hooks 和 statusLine 到新 settings.json
   - 保留新生成的其他字段 (新的 userID 等)

4. 恢复 CLAUDE.md:
   cp backup/CLAUDE.md ~/.claude/CLAUDE.md

5. 恢复 Skills:
   - 重建 symlink 映射 (参考 symlink-map.txt)
   - 复制实体技能到 ~/.claude/skills/

6. 恢复 Plugins:
   cp -r backup/plugins/* ~/.claude/plugins/

7. 恢复 StatusLine:
   - 确保 statusLine-command.sh 路径在 settings.json 中正确
   - 确认 multi-model-switch 仓库已 clone 到正确位置

8. 恢复 Hooks:
   - 确认 multi-model-switch/hooks/ 中所有脚本存在
   - 确认 read-once/ 脚本已恢复
   - 确认 settings.json 中 hooks 配置正确

9. 恢复 MCP:
   - 当前为空配置，无需恢复
   - 如需使用插件，重新从市场安装

10. 登录账户 (如使用 OAuth)
```

---

## 六、清理级别规划 (未执行，仅规划)

### Level A: 最小清理 (只清追踪字段)
```
目标: 重置设备身份，保留一切功能
操作: 清除 .claude.json 中 userID, anonymousId, firstStartTime, numStartups, tipsHistory
影响: 无
保留: 全部 hooks, skills, statusLine, MCP, memory, 对话历史
```

### Level B: 追踪+遥测清理
```
目标: Level A + 清除所有遥测/统计/跟踪数据
操作: Level A + 删除 telemetry/, statsig/, tracking/, stats-cache.json
影响: 无功能影响
保留: 全部用户资产
```

### Level C: 追踪+历史清理
```
目标: Level B + 清除所有对话记录
操作: Level B + 删除 sessions/, transcripts/, file-history/, history.jsonl, debug/
影响: /resume 不可用
保留: hooks, skills, statusLine, MCP, memory, CLAUDE.md
```

### Level D: 追踪+身份清理
```
目标: Level C + 清除 OAuth 凭证
操作: Level C + 删除 Keychain 中 4 个 Claude 条目 + .claude.json 中 oauthAccount 等字段
影响: 需重新登录
保留: hooks, skills, statusLine, MCP, memory, CLAUDE.md
```

### Level E: 完全重置 (核弹级)
```
目标: 完全清除 Claude Code 一切痕迹
操作:
  1. 执行 5.2 备份脚本
  2. rm -rf ~/.claude/
  3. rm -f ~/.claude.json
  4. 删除 Keychain 4 个条目
  5. rm -rf ~/.claude.bak/
  6. 清理 /tmp/claude-*
  7. 清理 VS Code 扩展日志和缓存 VSIX
  8. 清理 84 个项目 .claude/ 中的 sessions/transcripts
  9. 清理 MMS accounts 中的 .claude.json
  10. rm -rf ~/.cc-switch/cc-switch.db
  11. 清理 shell-snapshots
  12. 按 5.3 步骤恢复
影响: 等同全新安装
保留: 仅 git 管理的脚本 (hooks, statusline-command.sh)
```

---

## 七、关键提醒

### 7.1 关闭遥测的风险
> 摘自参考文档 9.3 节:
> - 关闭遥测自带地域标签，中文社区关闭遥测比例显著偏高
> - 关不掉的 (IP, TLS 指纹, OAuth Token) 远多于关得掉的
> - **关闭遥测 = 关闭 GrowthBook = 付费功能降级 (Opus 1M 消失, Fast Mode 不可用)**
>
> 当前 MMS 架构已通过本地代理绕过直连，`CLAUDE_CODE_ATTRIBUTION_HEADER=0` 已设置。

### 7.2 无法规避的硬性检测
- **cch Attestation**: Bun Zig 层生成，JS/TS 层无法修改
- **TLS 指纹**: 网络层始终可见
- **IP 地理归属**: 连接层信息
- **API 调用模式**: 频率和时间分布

### 7.3 清理后验证清单
```
□ 检查 ~/.claude.json 是否有新 userID (首次启动自动生成)
□ 检查 Keychain: security find-generic-password -s "Claude Code-credentials" 2>/dev/null
□ 检查 ~/.claude/telemetry/ 是否为空
□ 检查 ~/.claude/statsig/ 是否为空
□ 检查 settings.json 中 hooks 和 statusLine 是否完整
□ 检查 skills/ 目录是否完整
□ 检查 CLAUDE.md 是否存在
□ 启动 Claude Code 验证功能正常
□ 运行一个简单命令验证 hooks 生效
□ 检查 statusLine 是否显示
```

---

## 八、文件索引 (全部扫描结果汇总)

### 高追踪风险 (建议清理)
```
~/.config/mms/claude-gateway/.claude.json          # 设备 ID + 92 GrowthBook flags
~/.claude.bak/telemetry/                            # 33 个遥测文件
~/.claude.bak/tracking/                             # 跟踪配置
~/.claude.bak/statsig/                              # Statsig stable_id + session_id
~/.claude.bak/stats-cache.json                      # 统计缓存
~/.config/mms/accounts/*/claude.json                # 账户级设备 ID
```

### 中追踪风险 (建议按需清理)
```
~/.claude.bak/sessions/                             # 85 个会话
~/.claude.bak/transcripts/                          # 80 个转录
~/.claude.bak/file-history/                         # 88 个文件历史
~/.claude.bak/history.jsonl                         # 命令历史
~/.claude.bak/debug/                                # 222 个调试文件
~/.config/mms/claude-gateway/s/*/                   # 5 个活跃会话
~/.config/mms/events/*.jsonl                        # 8 个事件日志
~/.config/mms/config-audit.jsonl                    # 配置审计日志
/tmp/claude-501/                                    # 临时会话数据
84 个项目 .claude/ 目录                              # 项目级数据
```

### 需保留资产 (P0)
```
multi-model-switch/hooks/*.sh                       # Hook 脚本 (git 管理)
multi-model-switch/statusline-command.sh            # StatusLine 脚本 (git 管理)
~/.claude/settings.json                             # hooks + statusLine 配置
~/.claude.bak/settings.json                         # 历史配置
~/.claude.bak/settings.local.json                   # 历史本地配置
```

### 需保留资产 (P1)
```
~/.claude.bak/CLAUDE.md                             # 全局指令
~/.claude.bak/skills/ (15个实体目录)                  # 实体技能
~/.cc-switch/skills/                                # 共享技能
~/.agents/skills/                                   # 跨产品技能
~/.cc-switch/cc-switch.db                           # 切换历史
```

### Keychain 条目 (需显式删除)
```
security delete-generic-password -s "Claude Safe Storage" -a "Claude"
security delete-generic-password -s "Claude Safe Storage" -a "Claude Key"
security delete-generic-password -s "Claude Code-credentials-e549de00" -a "xin"
security delete-generic-password -s "Claude Code-credentials" -a "xin"
security delete-generic-password -s "Claude Code-credentials" -a "unknown"
```

### VS Code 相关 (可选清理)
```
~/.vscode/extensions/anthropic.claude-code-*/
~/Library/Application Support/Code/CachedExtensionVSIXs/anthropic.claude-code-*
~/Library/Application Support/Code/logs/*/window*/exthost/Anthropic.claude-code/
```

---

## 九、MMC/MMS 安全架构评估

> 基于 `multi-model-switch/` 源码审计 + 全盘扫描结果

### 9.1 MMC 已经做得很好的部分

| 防护层 | 实现方式 | 源码位置 |
|--------|----------|----------|
| **HOME 隔离** | 每个 MMC 会话获得独立 HOME 目录 | `mmc_core.py:459` `_reserve_session_home()` |
| **环境变量清除** | 所有 `ANTHROPIC_*`, `CLAUDE_CODE_*`, `HOME`, `XDG_*`, proxy vars 从父进程剥离 | `mmc_core.py:201-207` `_DANGEROUS_PARENT_ENV_PREFIXES` |
| **非必要流量禁用** | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 全局设置 | `mmc_core.py:171-174`, `mms_launchers.py:3587` |
| **Attribution 控制** | `CLAUDE_CODE_ATTRIBUTION_HEADER=0` (MMS 模式) + 空 attribution 设置 | `mms_launchers.py:2904,2923,4741` |
| **Header 白名单** | Bridge 只放行 `User-Agent`, `x-app`, `anthropic-version`, `anthropic-beta` | `mms_bridge.py:122-128` |
| **敏感模式白名单** | 可切换到 `minimal_claude_header_passthrough` 只放行 `anthropic-version` + `anthropic-beta` | `mms_bridge.py:131-134` |
| **API Key 替换** | 所有转发请求使用 gateway key，不泄露客户端 token | `mms_bridge.py:1796` |
| **探测元数据中性化** | Provider 探测使用随机 `device-{nonce}`, `session-{nonce}`，不含账户信息 | `mms_launchers.py:4368-4378` |
| **会话所有权验证** | Session resume 需要 owner fingerprint 匹配 | `mmc_core.py:1502-1525` |
| **账户状态白名单** | OAuth token 只保留必要字段，过滤敏感数据 | `mmc_core.py:105-128` |
| **Proxy Guard** | 强制所有流量通过 SOCKS/HTTP 代理，防止直连 | `mmc_proxy_guard.py` |
| **Install Method** | 设置为 `"mmc"` 而非 Claude Code 默认值 | `mmc_core.py:688` |

### 9.2 MMC 的薄弱项 (本次扫描确认)

#### 薄弱点 1: **请求体 metadata.user_id 不做归一化** (高风险)

Claude Code 在每个 API 请求的 body 中发送：
```json
{
  "metadata": {
    "user_id": "{\"device_id\":\"...\", \"session_id\":\"...\"}"
  }
}
```

**现状**: `mms_bridge.py` 将请求体原样透传，不做任何 metadata 字段的重写或归一化。
- 源码搜索确认：bridge 中只有 `model` 名称替换和 `cache_control` 处理，无 metadata/user_id 处理
- 每个会话的 device_id 仍由 Claude Code 自行生成，MMC 不干预

**影响**: Anthropic 服务端可以看到来自不同 MMC 会话的不同 device_id，可以据此关联多个会话属于同一物理设备。

#### 薄弱点 2: **x-stainless-* Header 泄露 SDK 环境** (中风险)

```python
# mms_bridge.py:137-139
_CLAUDE_HEADER_PREFIX_PASSTHROUGH = (
    "x-stainless-",
)
```

**现状**: `x-stainless-*` 前缀的 header 全部放行。这些是 Anthropic SDK 的遥测 header，可能包含：
- `x-stainless-lang`: 编程语言版本
- `x-stainless-os`: 操作系统信息
- `x-stainless-runtime`: 运行时版本
- `x-stainless-package-version`: SDK 版本

**影响**: 即使 MMC 做了 HOME 隔离，这些 SDK 级别的环境指纹在所有会话中一致，可以用于关联。

#### 薄弱点 3: **User-Agent 未归一化** (低-中风险)

```python
# mms_bridge.py:122-128
_CLAUDE_HEADER_PASSTHROUGH = (
    "User-Agent",
    ...
)
```

**现状**: Claude Code 的 User-Agent (如 `claude-code/2.1.110`) 原样传递给上游。虽然可以通过 `strip_upstream_user_agent` 选项移除，但不是默认行为。

**影响**: 版本号泄露 + 指纹一致性。

#### 薄弱点 4: **System Prompt <env> 块未清理** (高风险)

Claude Code 自动在每个请求的 system prompt 中注入：
```
<env>
Platform: darwin
Shell: /bin/zsh
OS Version: Darwin 24.6.0
Working directory: /Users/xin/auto-skills/...
</env>
```

**现状**: Bridge 不解析或修改 system prompt 内容。工作目录包含真实用户名路径 (`/Users/xin/...`)。

**影响**: 这是最直接的指纹泄露之一 — 真实用户名、完整目录结构、OS 版本全部暴露给 Anthropic。

#### 薄弱点 5: **GrowthBook/遥测仅靠单 Flag** (中风险)

**现状**: 唯一的遥测防护是 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`。
- 无 DNS 级别阻断 (无 /etc/hosts, 无 Clash 规则)
- 无 proxy 级别过滤特定遥测域名
- 无法验证该 flag 是否真正抑制所有遥测

**风险**: 如果 Claude Code 更新后不再完全遵守该 flag，或者有硬编码的上报路径绕过它，则无防御层。

#### 薄弱点 6: **MMC 模式不设置 Attribution Header** (低风险)

**现状**: `CLAUDE_CODE_ATTRIBUTION_HEADER=0` 只在 MMS 模式自动设置。
MMC 模式中它只在白名单中 (允许手动传入)，但不默认设置。
```python
# mmc_core.py:79 — 仅在 ALLOWED 列表中，不在默认 env 中
_ALLOWED_LAUNCH_ENV_KEYS = [..., "CLAUDE_CODE_ATTRIBUTION_HEADER", ...]
```

**影响**: MMC 会话可能发送 attribution header (含 billing fingerprint hash)。

#### 薄弱点 7: **Gateway 模式共享 HOME 目录** (中风险)

**现状**: MMS gateway 模式下所有会话共享 `~/.config/mms/claude-gateway/` 作为 HOME。
- `.claude.json` 中的 `userID`, `numStartups=261`, `firstStartTime` 全部共享
- 5 个活跃 gateway 会话使用同一个设备身份

**影响**: 无法在 gateway 模式下实现身份隔离。所有会话呈现为同一设备。

#### 薄弱点 8: **无 Billing Header 拦截** (中风险)

**现状**: Bridge 不主动拦截或清除 `x-anthropic-billing-header`。
- 虽然 `ATTRIBUTION_HEADER=0` (MMS) 应该阻止 Claude Code 生成此 header
- 但 Bridge 层没有双保险机制
- MMC 模式下 (薄弱点 6) 更没有保护

#### 薄弱点 9: **无硬件指纹归一化** (低-中风险)

**现状**: Claude Code 采集 `constrainedMemory`(物理内存), `rss`, `heapTotal`, `heapUsed` 等进程指标。
MMC 不做归一化。多台物理机使用同一账户时，硬件差异可被用于区分设备。

#### 薄弱点 10: **Prompt Cache Key 未归一化** (低风险)

不同会话的 system prompt 内容 (特别是 `<env>` 块) 不同，导致 prompt cache key 不同。
Anthropic 可以据此判断是不同设备/环境发出的请求。

---

### 9.3 cc-gateway (motiful/cc-gateway) 对比分析

> 项目地址: https://github.com/motiful/cc-gateway
> 版本: v0.2.0-alpha | MIT License
> 发布: 2026-04-02

#### 设计理念差异

| 维度 | MMC/MMS | cc-gateway |
|------|---------|------------|
| **定位** | 多账户会话启动器 + 负载均衡路由器 | API 身份归一化网关 |
| **信任模型** | 信任 Claude Code 遵守 DISABLE_NONESSENTIAL_TRAFFIC | 不信任客户端，proxy 层全量重写 |
| **核心能力** | HOME 隔离、env 剥离、路由分发 | 40+ 维度指纹归一化、billing 清除 |
| **多账户** | 原生支持，会话级隔离 | 单身份，多设备归一到同一身份 |
| **路由能力** | 14+ provider, 智能路由, 3 层模型分级 | 单上游 (api.anthropic.com) |

#### cc-gateway 做了什么 MMC 没做的

| 能力 | cc-gateway | MMC 现状 |
|------|-----------|---------|
| **metadata.user_id 重写** | → canonical device_id | 原样透传 |
| **email 归一化** | → canonical email | 不处理 |
| **env 对象替换 (40+ 字段)** | 整个对象替换 | 不处理 |
| **system prompt <env> 清理** | Platform/Shell/OS/WorkingDir 全部替换为标准值 | 不处理 |
| **User-Agent 归一化** | → canonical CC version | 原样透传 |
| **x-stainless-* 清除** | 清除 | 透传 |
| **billing header 清除** | 完全移除 (HTTP header + system prompt block) | 依赖 flag |
| **硬件指纹归一化** | constrainedMemory/RSS/heap 全部替换为标准值 | 不处理 |
| **baseUrl/gateway 泄露字段** | 从 analytics event 中清除 | 不处理 |
| **DNS 级阻断** | 提供 Clash 规则模板 | 无 |
| **OAuth 集中管理** | Gateway 统一刷新 token，客户端不接触 platform.claude.com | 各会话各自管理 |
| **零登录客户端** | 单脚本启动，无需浏览器 OAuth | 需要 Keychain OAuth |
| **跨设备统一身份** | 多台设备呈现为同一设备 | 无此设计 |

#### MMC 做了什么 cc-gateway 没做的

| 能力 | MMC | cc-gateway |
|------|-----|-----------|
| **多 provider 路由** | 14+ provider, 智能负载均衡, 健康检查 | 单上游 |
| **多模型分级** | light/medium/heavy 3 层模型路由 | 无 |
| **多 CLI 支持** | Claude Code + Codex + Gemini | 仅 Claude Code |
| **OAuth 多账户** | 5 个账户独立隔离 | 单账户 |
| **TUI 管理** | 完整终端 UI | 无 UI |
| **会话恢复** | /resume 跨会话 | 无 |
| **Speed Stats** | 模型性能追踪 | 无 |
| **本地模型** | 支持本地/私有 provider | 仅 Anthropic |
| **MCP 插件生态** | 33+ 插件市场 | 无 |
| **Hooks/Skills/StatusLine** | 完整自定义能力 | 无 |

#### 风险评估

| 风险维度 | MMC 评分 | cc-gateway 评分 | 说明 |
|----------|---------|-----------------|------|
| 请求体身份泄露 | **弱** | **强** | MMC 不处理 metadata.user_id |
| Header 指纹泄露 | **中** | **强** | MMC 透传 x-stainless-* |
| System Prompt 泄露 | **弱** | **强** | MMC 不清理 <env> 块 |
| 遥测阻断 | **中** | **强** | MMC 单 flag, cc-gateway DNS 级 |
| 多设备统一性 | **弱** | **强** | MMC 各会话独立 device_id |
| 多账户管理 | **强** | **弱** | cc-gateway 只管单账户 |
| 路由灵活性 | **强** | **弱** | cc-gateway 单上游 |
| 生产稳定性 | **中** | **低** | cc-gateway alpha 版 |

---

### 9.4 结论与建议

#### MMC 不是薄弱，是定位不同

MMC 本质上是一个**会话隔离 + 多账户路由器**，不是一个**身份归一化网关**。它在自己的定位上做得很好：
- HOME 隔离防止了跨账户数据泄露
- 环境剥离防止了父进程信息泄露
- 探测元数据使用了中性随机值
- Proxy Guard 强制了流量路径

#### 真正的薄弱点在于: Bridge 层缺少深度请求/响应改写

如果要在 MMC 中补强，最关键的 3 个改进点：

1. **在 `mms_bridge.py` 中增加请求体 metadata.user_id 归一化** — 替换为 canonical device_id
2. **在 `mms_bridge.py` 中增加 system prompt <env> 块清理** — 替换为标准值
3. **移除 x-stainless-* 的透传** — 或归一化为标准值

这 3 点补上后，MMC 的隐私保护将达到 cc-gateway 同等水平，同时保留多账户/多 provider 的架构优势。

#### cc-gateway 值得关注但不适合直接替代

- **优势**: 身份归一化做得更深入，DNS 级阻断是额外防御层
- **劣势**: alpha 版本、单账户、无路由、无 TUI、无多 CLI
- **建议**: 可以借鉴其 body/header/prompt 改写策略，移植到 MMC bridge 层
- **风险**: 项目很新 (2026-04-01 首发)，社区验证不足，且明确标注 "Test with a non-primary account first"

---

## 十、本次扫描未覆盖 / 后续建议

| 项目 | 说明 |
|------|------|
| **网络层抓包验证** | 建议用 mitmproxy 抓一次完整请求，验证 MMC bridge 实际透传了哪些字段 |
| **cc-gateway 源码审计** | 建议克隆源码仔细审查，特别是 body rewriting 逻辑 |
| **Clash 规则** | 考虑在 MMC 中增加类似 cc-gateway 的 Clash DNS 规则作为额外防御层 |
| **Bridge 层深度改写** | 最高优先级 — 在 `_GatewayBridgeHandler` 中增加 metadata/prompt 归一化 |
| **TLS 指纹** | 两者都无法处理 TLS JA3/JA4 指纹，需要网络层方案 |

---

## 十一、`claude_safe_zone/` 已保全资产审计

> 位置: `/Users/xin/claude_safe_zone/` (4.2 MB)
> 状态: 部分痕迹已被移入此处，以下审计当前会话哪些引用已断链

### 11.1 safe_zone 内容清单

```
claude_safe_zone/
├── hooks/
│   ├── .rtk-hook.sha256                    # RTK hook 完整性 hash
│   ├── claude-context-restore-hint.sh      # 3.9 KB — 上下文恢复提示
│   ├── map-auto-index.sh                   # 880 B  — 自动索引映射
│   ├── rtk-rewrite.sh                      # 3.1 KB — RTK 工具重写
│   └── token-monitor-hook.sh               # 2.2 KB — Token 监控
├── skills/
│   ├── agentbus/          # NEW (不在 .claude.bak 中)
│   ├── diagramming/       # NEW
│   ├── docx/              # 与 .claude.bak 重叠
│   ├── excalidraw-agent-local-kit/  # 重叠
│   ├── frontend-design/   # 重叠
│   ├── issue-recorder/    # NEW
│   ├── mail/              # NEW
│   ├── map/               # NEW
│   ├── pilot/             # NEW
│   ├── planning-with-files/  # 重叠
│   ├── scmp-ops/          # NEW
│   ├── scmp-self-improve/ # NEW
│   ├── ui-ux-pro-max/     # 重叠
│   ├── webapp-testing/    # 重叠
│   └── xlsx/              # 重叠
├── settings.json          # 4.7 KB — 完整版 (含 agent-im hooks)
├── raw_settings.json      # 4.7 KB — 同上 (备份)
├── settings.json.bak      # 3.0 KB — 旧版
├── settings.json.bak-20260407-211929  # 3.1 KB — 更旧版
├── statusline-command.sh  # 15 KB — 完整 statusline 脚本
├── statusline-multi.sh    # 94 B  — 多行 statusline
└── statusline-test.sh     # 364 B — 测试脚本
```

### 11.2 当前会话断链分析

当前会话 settings.json 引用了以下路径，其中 **4 个已断链** (文件被移到 safe_zone)：

| Hook 路径 | 当前状态 | 替代位置 |
|-----------|----------|----------|
| `~/.claude/hooks/map-auto-index.sh` | **MISSING** | safe_zone/hooks/ 或 MMS hooks/claude-map-auto-index.sh |
| `~/.claude/hooks/rtk-rewrite.sh` | **MISSING** | safe_zone/hooks/ 或 MMS hooks/rtk-rewrite.sh |
| `~/.claude/read-once/compact.sh` | **MISSING** | MMS hooks/read-once-compact.sh |
| `~/.claude/read-once/hook.sh` | **MISSING** | MMS hooks/read-once-hook.sh |
| MMS hooks/hive-compact-hook.sh | OK | 在 git 仓库中 |
| MMS hooks/claude-feishu-webfetch-guard.sh | OK | 在 git 仓库中 |

**影响**: 当前会话中 SessionStart、PreToolUse(Bash)、PreToolUse(Read)、PostCompact 的 hook 可能静默失败。

### 11.3 safe_zone settings.json 比 当前会话多出的内容

safe_zone 的 settings.json 是更完整的版本，包含当前会话**没有**的 hook 事件：

| Hook 事件 | safe_zone 引用 | 当前会话 | 脚本位置 |
|-----------|---------------|---------|---------|
| **SessionStart** | agent-im/hooks/session-start.sh | 无 | 脚本存在 |
| **Stop** | agent-im/hooks/session-end.sh | 无 | 脚本存在 |
| **Notification** | agent-im/hooks/notification.sh | 无 | 脚本存在 |
| **PostToolUse** | agent-im/hooks/post-tool-use.sh | 无 | 脚本存在 |
| **UserPromptSubmit** | agent-im/hooks/user-prompt.sh | 无 | 脚本存在 |
| **UserPromptSubmit** | token-monitor-hook.sh | 无 | 在 safe_zone 中 |
| **SessionStart** | claude-context-restore-hint.sh | 无 | 在 safe_zone 中 |
| **PostToolUseFailure** | SUPERSET_HOME_DIR/notify.sh | 无 | 条件执行 |
| **PermissionRequest** | SUPERSET_HOME_DIR/notify.sh | 无 | 条件执行 |

> `SUPERSET_HOME_DIR` 在当前会话中未设置，这些 hook 为条件执行，不影响当前功能。

### 11.4 Skills 覆盖分析

| 类别 | 数量 | 说明 |
|------|------|------|
| safe_zone 独有 (NEW) | 8 | agentbus, diagramming, issue-recorder, mail, map, pilot, scmp-ops, scmp-self-improve |
| 双方共有 | 8 | docx, excalidraw-agent-local-kit, frontend-design, planning-with-files, ui-ux-pro-max, webapp-testing, xlsx, (+1) |
| 仅 .claude.bak 有 | 22 | symlink 类 (a2a, moebius 等) + backup 目录 + 实体目录 (changelog, pptx 等) |

**注意**: .claude.bak 中仍有的 22 个技能未进入 safe_zone：
- **Symlink 类** (a2a→agent-2-agent, moebius→moebius repo, fight-agent 等): 目标仓库仍存在
- **Backup 目录** (*.backup-20260312-0012, 共 9 个): 历史备份
- **实体目录** (changelog-generator, doc-coauthoring, domain-service-lookup, domain-tool-expert, find-skills, image-enhancer, internal-comms, knowledge-wiki, pptx, 共 9 个): 这些仍有唯一内容

### 11.5 恢复检查清单

恢复时需要确保以下映射关系正确：

```
~/.claude/hooks/map-auto-index.sh        ← safe_zone/hooks/map-auto-index.sh
                                          ← 或 MMS hooks/claude-map-auto-index.sh (不同名!)
~/.claude/hooks/rtk-rewrite.sh           ← safe_zone/hooks/rtk-rewrite.sh
                                          ← 或 MMS hooks/rtk-rewrite.sh (不同版本!)
~/.claude/hooks/claude-context-restore-hint.sh ← safe_zone/hooks/
~/.claude/hooks/token-monitor-hook.sh    ← safe_zone/hooks/
~/.claude/read-once/compact.sh           ← MMS hooks/read-once-compact.sh (不同名!)
~/.claude/read-once/hook.sh              ← MMS hooks/read-once-hook.sh (不同名!)
```

> **关键注意**: MMS 项目中的脚本名称与 settings.json 引用的不同：
> - `claude-map-auto-index.sh` ≠ `map-auto-index.sh`
> - `read-once-compact.sh` ≠ `compact.sh`
> - `read-once-hook.sh` ≠ `hook.sh`
> - safe_zone 中的 `rtk-rewrite.sh` (3.1KB) ≠ MMS 中的 `rtk-rewrite.sh` (1.8KB)
>
> 恢复时必须使用 **safe_zone 中的版本** 或创建正确命名的 symlink。

### 11.6 safe_zone 中缺少但恢复时可能需要的

| 文件 | 位置 | 说明 |
|------|------|------|
| read-once/compact.sh | 仅 MMS hooks/read-once-compact.sh | 需要重命名 |
| read-once/hook.sh | 仅 MMS hooks/read-once-hook.sh | 需要重命名 |
| CLAUDE.md | .claude.bak/CLAUDE.md | 全局指令 |
| .claude.bak 中 22 个未迁移的 skills | .claude.bak/skills/ | 部分为实体目录 |
| MCP 配置 | 当前为空 | 无需迁移 |

---

*本文档为纯扫描记录和规划，不执行任何修改操作。所有清理需用户确认后手动执行。*
