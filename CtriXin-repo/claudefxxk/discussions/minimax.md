# Claude 痕迹清理 — 多 Agent 讨论文档

> 扫描时间：2026-04-17
> 扫描范围：全系统 Claude 相关痕迹

---

## 一、待清理目标总览

| 优先级 | 类别 | 路径 | 估算大小 | 风险 |
|--------|------|------|----------|------|
| P1 | Claude App 数据 | `~/Library/Application Support/Claude/` | **636 MB** | 高（对话数据） |
| P1 | 凭证残留 | `~/.claude/settings.json` 的 `env` 块 | 5.9 KB | 极高（Auth Token） |
| P2 | CLI 安装包 | `~/.local/share/claude/` | **386 MB** | 中（两个版本 2.1.109 / 2.1.110） |
| P2 | MMS Session | `~/.config/mms/claude-gateway/s/49647/` | ~数 MB | 中 |
| P2 | CLI 配置目录 | `~/.claude/` | ~7 MB | 低（符号链接为主） |
| P3 | Chrome 扩展 | Chrome profile `claude-code` | 中 | 低 |
| P3 | npm 全局包 | `claude-talk-to-figma-mcp` | — | 低 |
| LOW | 钩子脚本 | `~/.claude/hooks/*.sh` | ~10 KB | 低（孤儿引用） |
| LOW | Skills 符号链接 | `~/.claude/skills/` | 0 | 低（纯链接） |

**总计可清理：~1.0 GB+**

---

## 二、各目标详情

### 2.1 Claude App（网页/桌面版）

**路径：** `~/Library/Application Support/Claude/`
**大小：** 636 MB

**包含内容：**

| 子目录/文件 | 内容 | 风险 |
|------------|------|------|
| `IndexedDB/` | claude.ai 对话数据库 | **极高**（所有对话记录） |
| `Session Storage/` | 会话状态 | 高（对话上下文） |
| `Cache/` | HTTP 缓存 | 低 |
| `GPUCache/` | GPU 着色器缓存 | 低 |
| `Cookies` | 28 KB | 中（登录态） |
| `Local Storage/` | 网站本地存储 | 中 |
| `claude_desktop_config.json` | 无 API key，仅偏好设置 | 低 |
| `claude-code/2.1.78/` | 嵌入式 Claude Code 扩展数据 | 中 |
| `claude-code-vm/` | VM bundle | 低 |
| `vm_bundles/claudevm.bundle` | 捆绑 VM | 低 |
| `sentry/` | 错误报告 | 低 |
| `Crashpad/` | 崩溃报告 | 低 |

**影响范围：**
- 所有与 claude.ai 的对话记录、Prompt、API 使用记录
- Claude Code 扩展的状态和缓存
- 桌面版登录态和偏好设置

**清理方式：** 删除整个 `Claude/` 目录（如果只用 CLI 不需要 App）

---

### 2.2 凭证残留

**路径：** `~/.claude/settings.json`
**大小：** 5.9 KB

**危险内容：**
```json
"env": {
  "ANTHROPIC_AUTH_TOKEN": "mms-bridge-93d3c4819adf42b8849d5c6b41f6058a",
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:57840",
  ...
}
```

**影响范围：**
- MMS Bridge 令牌，可用于临时访问 Claude API
- MMS 会话路由信息

**清理前置动作：** 必须在删除前通过 MMS/Anthropic 仪表板**撤销该 Token**，否则只是删了文件但令牌仍有效。

---

### 2.3 Claude Code CLI 安装

**路径：** `~/.local/share/claude/`
**大小：** 386 MB

| 版本 | 大小 |
|------|------|
| `2.1.109/` | 192.4 MB |
| `2.1.110/` | 193.5 MB |

**二进制入口：** `/Users/xin/.local/bin/claude`

**影响范围：**
- 卸载后 `claude` 命令不可用
- 如果有正在使用的 CLAUDE.md 项目配置，关联项目会受影响

---

### 2.4 MMS Gateway Session

**路径：** `~/.config/mms/claude-gateway/s/49647/`
**大小：** 数 MB

**包含内容：**
- `.claude.json`（UI 配置）
- `.claude/settings.json`（凭证，见 2.2）
- `.mcp.json`（MCP 服务器配置）
- `projects/`（项目索引）
- `subagents/`（子 agent 状态）
- `sessions/`、`transcripts/`、`history.jsonl/`（对话历史）
- `file-history/`（文件操作历史）

**MCP Server 指向：**
```json
"hive"    -> ~/auto-skills/CtriXin-repo/hive/bin/mcp-server.sh
"mindkeeper" -> ~/auto-skills/CtriXin-repo/mindkeeper/dist/server.js
```

**影响范围：** 当前 MMS 会话的所有状态、重建能力、上下文

---

### 2.5 CLI 配置目录

**路径：** `~/.claude/`（符号链接 → `~/.config/mms/claude-gateway/s/49647/.claude/`）
**大小：** ~7 MB（含 MMS session）

**包含内容：**
- `settings.json`（凭证）
- `.mcp.json`（MCP 配置）
- `hooks/`（4 个钩子脚本）
- `skills/`（10 个符号链接 → auto-skills 仓库）
- `plans/`（5 个 plan markdown）
- `read-once/`（compact.sh, hook.sh）
- `shell-snapshots/`（snapshots/, stats.jsonl）
- `projects/`（claudefxxk, auto-skills）
- `commands/`（空）

---

### 2.6 Chrome 扩展

**路径：** `~/Library/Application Support/Google/Chrome/Default/Extensions/` 中的 `claude-code` profile

**影响范围：** Chrome 内使用 Claude Code 扩展的数据（如果有）

---

### 2.7 npm 全局包

**包名：** `claude-talk-to-figma-mcp@0.9.0`

**影响范围：** Figma MCP 集成功能

---

### 2.8 钩子脚本（孤儿引用）

**路径：** `~/.claude/hooks/`

| 脚本 | 大小 | 引用 |
|------|------|------|
| `claude-context-restore-hint.sh` | 3.8 KB | auto-skills 仓库 |
| `map-auto-index.sh` | 880 B | auto-skills 仓库 |
| `rtk-rewrite.sh` | 3.1 KB | RTK（Rust Token Killer） |
| `token-monitor-hook.sh` | 2.2 KB | auto-skills 仓库 |

**清理前置条件：** 如果保留 auto-skills 仓库，这些钩子可能仍被调用

---

### 2.9 Skills 符号链接

**路径：** `~/.claude/skills/`

指向的仓库（符号链接，删除无影响）：
- `diagramming` → `~/auto-skills/CtriXin-repo/diagramming-skill`
- `excalidraw-agent...` → `~/auto-skills/CtriXin-repo/excalidraw-agent-local-kit`
- `hive-a2a` → `~/auto-skills/CtriXin-repo/hive-a2a-skill`
- `hive-discuss` → `~/auto-skills/CtriXin-repo/hive-discuss-skill`
- `issue-recorder` → `~/auto-skills/shared-skills/issue-recorder`
- `mail` → `~/auto-skills/CtriXin-repo/session-mailbox`
- `pilot` → `~/auto-skills/shared-skills/pilot`
- `scmp-ops` → `~/auto-skills/shared-skills/scmp-ops`
- `scmp-self-improve` → `~/auto-skills/shared-skills/scmp-self-improve`

---

## 三、安全清理前置条件

1. **撤销 ANTHROPIC_AUTH_TOKEN**（mms-bridge-93d3c4819adf42b8849d5c6b41f6058a）
   - 通过 MMS 或 Anthropic 仪表板撤销
   - 确保令牌失效后再删除配置文件

2. **确认 Chrome 扩展使用情况**
   - 如果 Chrome 上的 claude-code 扩展有重要数据，先导出

3. **确认 App 使用情况**
   - 如果使用 Claude App（网页/桌面版）有重要对话，先导出

---

## 四、清理后影响评估

| 清理项 | 正面影响 | 负面影响 |
|--------|----------|----------|
| App Data (636 MB) | 清除所有对话记录，保护隐私 | Claude App 本地状态丢失（重新登录） |
| Auth Token (5.9 KB) | 消除安全风险 | MMS 需要重新认证 |
| CLI Install (386 MB) | 释放大量空间 | `claude` 命令不可用 |
| MMS Session | 清除临时会话状态 | 丢失当前上下文和历史 |
| CLI Config (~7 MB) | 清除配置和钩子 | Skills 符号链接失效 |

---

## 五、讨论议题（多 Agent）

1. **Token 撤销顺序**：先撤销还是先删文件？是否有原子性保证？
2. **auto-skills 仓库处理**：清理 Claude 痕迹时是否同时清理 auto-skills 仓库本身？
3. **"未命名文件夹 4" 的微信图片**：这批图片是否 Claude 无关（确认为微信截图）？是否需要进一步人工审核？
4. **Chrome 扩展 vs App**：用户可能只用一个，清理时需要确认优先保留哪个
5. **RTK 依赖**：`rtk-rewrite.sh` 钩子是否影响日常开发？如果 RTK 还有用，清理钩子是否影响 RTK？

---

## 六、清理命令预览（待确认后执行）

```bash
# 1. 撤销 Token（需在仪表板操作，CLI 无法完成）

# 2. 删除 Claude App 数据
rm -rf ~/Library/Application\ Support/Claude/

# 3. 删除 CLI 安装
rm -rf ~/.local/share/claude/
rm -f ~/.local/bin/claude

# 4. 删除 MMS Session（如果彻底不用 MMS）
rm -rf ~/.config/mms/claude-gateway/s/49647/

# 5. 删除 CLI 配置
rm -rf ~/.claude/

# 6. 删除 npm 全局包
npm uninstall -g claude-talk-to-figma-mcp

# 7. 删除 Chrome 扩展（如需要）
# 需要找到具体 extension ID 后删除

# 8. 删除"未命名文件夹 4"（如确认为微信图片）
rm -rf "/Users/xin/Downloads/未命名文件夹 4"
```
