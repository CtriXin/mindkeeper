# Safe Zone 资产缺口审计报告（v2 — 修正版）

> 生成时间：2026-04-18
> 审计方法：实机验证 `.claude.bak/skills/` 中每个目录的实体/symlink 状态
> 原则：只列清单，不执行任何操作

---

## Safe Zone 现有资产快照

| 类别 | 已有内容 | 数量 |
|------|---------|------|
| **Hooks** | claude-context-restore-hint.sh, map-auto-index.sh, rtk-rewrite.sh, token-monitor-hook.sh | 4 个 |
| **StatusLine** | statusline-command.sh, statusline-multi.sh, statusline-test.sh | 3 个 |
| **Settings** | settings.json, raw_settings.json, settings.json.bak, settings.json.bak-20260407-211929 | 4 个 |
| **Skills** | agentbus, diagramming, docx, excalidraw-agent-local-kit, frontend-design, issue-recorder, mail, map, pilot, planning-with-files, scmp-ops, scmp-self-improve, ui-ux-pro-max, webapp-testing, xlsx | 15 个实体目录 |

---

## 🔴 P0 — 缺少且清理后会永久丢失的资产

### 1. 全局 CLAUDE.md

| 缺失项 | 当前位置 | Safe Zone 状态 | 风险 |
|--------|---------|---------------|------|
| `CLAUDE.md`（全局指令） | `.claude.bak/CLAUDE.md` | ❌ 不存在 | 5 条全局 Agent 行为规则，清理 `.claude.bak/` 后无副本 |

**内容摘要**：
- 用户说"不对"时立刻停下来转向
- 优先动手实现，减少反复确认
- 技术术语保留英文，其余用中文
- 3步以上复杂任务用 extended thinking
- Plan 执行前自审 5 维

### 2. settings.local.json

| 缺失项 | 当前位置 | Safe Zone 状态 |
|--------|---------|---------------|
| `settings.local.json` | `.claude.bak/.claude/settings.local.json` | ❌ 不存在 |

### 3. .claude.bak 中真正的实体 Skills（safe_zone 无副本）

> **重要修正**：经实机验证，以下曾被误认为"实体"的 skill 实际是 **symlink**，清理后可通过重建 symlink 恢复，不会永久丢失：
> - `a2a` → `agent-2-agent` repo
> - `fight-agent` → `fight-agent` repo
> - `gemini-designer` → `.cc-switch/skills/gemini-designer`
> - `humanizer` → `.cc-switch/skills/humanizer`
> - `infographic-maker` → `.cc-switch/skills/infographic-maker`
> - `last30days` → `.cc-switch/skills/last30days`
> - `moebius` → `moebius` repo

**真正是实体目录、safe_zone 中没有的 skill**（9 个）：

| # | Skill 名称 | 说明 |
|---|-----------|------|
| 1 | `changelog-generator` | 变更日志生成 |
| 2 | `doc-coauthoring` | 文档协作 |
| 3 | `domain-service-lookup` | 域服务查询 |
| 4 | `domain-tool-expert` | 域工具专家 |
| 5 | `find-skills` | 技能发现 |
| 6 | `image-enhancer` | 图像增强 |
| 7 | `internal-comms` | 内部通讯 |
| 8 | `knowledge-wiki` | 知识 wiki |
| 9 | `pptx` | PPTX 处理 |

### 4. .cc-switch/skills/ 中的实体技能（与 .claude.bak 有重叠）

Codex backfill 已镜像 16 个。其中 `gemini-designer`、`humanizer`、`infographic-maker`、`last30days`、`moebius` 与 `.claude.bak` 中的 symlink 指向相同目标。

### 5. .agents/skills/ 中的实体技能

| # | Skill 名称 |
|---|-----------|
| 1 | `redirect-manager` |

---

## 🟡 P1 — 建议补（重建成本高或历史价值大）

| # | 缺失项 | 当前位置 | 说明 |
|---|--------|---------|------|
| 1 | **Plugins 市场** | `.claude.bak/plugins/` 或 `~/.claude/plugins/` | 33+ 官方 + 16 外部插件。可重新下载，但本地状态和配置会丢失 |
| 2 | **项目级 Memory 数据** | `~/.claude.bak/projects/*/memory/` | 各项目的上下文记忆，清理后可重新建立 |
| 3 | **Shell Snapshots** | `~/.claude.bak/shell-snapshots/` | ZSH 环境快照，含 PATH 等 |
| 4 | **项目级 Plans** | `~/.claude.bak/plans/` | 19 个 plan markdown |
| 5 | **项目级 Todos** | `~/.claude.bak/todos/` | 118 个 todo |
| 6 | **已知市场索引** | `~/.claude.bak/plugins/known_marketplaces.json` | 插件市场索引 |
| 7 | **RTK.md** | `.claude.bak/RTK.md` | RTK（Rust Token Killer）相关文档 |

---

## 🟢 P2 — 可选补（有替代恢复途径）

| # | 缺失项 | 当前位置 | 说明 |
|---|--------|---------|------|
| 1 | **.claude.json 历史备份** | `~/.claude.bak/backups/.claude.json.backup.*` | 5 个时间戳备份，含旧 userID，不建议恢复 |
| 2 | **Debug 日志** | `~/.claude.bak/debug/` | 222 个文件，调试用途 |
| 3 | **Session 历史** | `~/.claude.bak/sessions/`, `transcripts/`, `file-history/` | 85 个会话，清理后 /resume 不可用 |
| 4 | **Stats 缓存** | `~/.claude.bak/stats-cache.json` | 统计缓存 |
| 5 | **Claude 使用缓存** | `~/.claude.bak/claude-usage-cache.json` | 用量缓存 |

---

## 当前 Session settings.json 中的悬空 Hook 路径

以下 hook 配置指向的路径**当前已不存在**，但功能等价脚本在 safe_zone 或 repo 中：

| Hook 事件 | 配置引用的悬空路径 | 实际存在的替代脚本 |
|-----------|-------------------|------------------|
| SessionStart | `~/.claude/hooks/map-auto-index.sh` | `multi-model-switch/hooks/claude-map-auto-index.sh`（repo，git 管理） |
| PostCompact | `~/.claude/read-once/compact.sh` | `multi-model-switch/hooks/read-once-compact.sh`（repo，git 管理） |
| PreToolUse (Bash) | `~/.claude/hooks/rtk-rewrite.sh` | `multi-model-switch/hooks/rtk-rewrite.sh`（repo）或 `safe_zone/hooks/rtk-rewrite.sh`（3.1KB，safe_zone 版更完整） |
| PreToolUse (Read) | `~/.claude/read-once/hook.sh` | `multi-model-switch/hooks/read-once-hook.sh`（repo，git 管理） |

> **关键注意**：`multi-model-switch` 中的脚本名称与 settings.json 引用的不同，恢复时必须核对或修改配置。

---

## 资产实体 vs symlink 对照表

| Skill | 在 .claude.bak 中的类型 | 指向目标 | safe_zone 中是否有 |
|-------|------------------------|---------|-------------------|
| a2a | symlink | `agent-2-agent` repo | ❌（repo 在即可重建） |
| fight-agent | symlink | `fight-agent` repo | ❌（repo 在即可重建） |
| gemini-designer | symlink | `.cc-switch/skills/gemini-designer` | ✅（cc-switch 有实体） |
| humanizer | symlink | `.cc-switch/skills/humanizer` | ✅（cc-switch 有实体） |
| infographic-maker | symlink | `.cc-switch/skills/infographic-maker` | ✅（cc-switch 有实体） |
| last30days | symlink | `.cc-switch/skills/last30days` | ✅（cc-switch 有实体） |
| moebius | symlink | `moebius` repo | ❌（repo 在即可重建） |
| changelog-generator | **实体** | — | ❌ |
| doc-coauthoring | **实体** | — | ❌ |
| domain-service-lookup | **实体** | — | ❌ |
| domain-tool-expert | **实体** | — | ❌ |
| find-skills | **实体** | — | ❌ |
| image-enhancer | **实体** | — | ❌ |
| internal-comms | **实体** | — | ❌ |
| knowledge-wiki | **实体** | — | ❌ |
| pptx | **实体** | — | ❌ |

---

## 一键补充命令

```bash
# 补全局 CLAUDE.md
cp ~/.claude.bak/CLAUDE.md ~/claude_safe_zone/CLAUDE.md

# 补 settings.local.json
cp ~/.claude.bak/.claude/settings.local.json ~/claude_safe_zone/settings.local.json 2>/dev/null

# 补真正的实体 skills（只补 9 个，不是 16 个）
mkdir -p ~/claude_safe_zone/skills-bak-entities
cd ~/.claude.bak/skills/
for skill in changelog-generator doc-coauthoring domain-service-lookup domain-tool-expert find-skills image-enhancer internal-comms knowledge-wiki pptx; do
  if [ -d "$skill" ] && [ ! -L "$skill" ]; then
    cp -r "$skill" ~/claude_safe_zone/skills-bak-entities/ && echo "✓ $skill"
  fi
done

# 补 plugins
cp -r ~/.claude.bak/plugins/ ~/claude_safe_zone/plugins/ 2>/dev/null

# 补 RTK.md
cp ~/.claude.bak/RTK.md ~/claude_safe_zone/RTK.md 2>/dev/null
```

---

*本文档基于实机验证结果生成，所有实体/symlink 状态已逐条确认。*
