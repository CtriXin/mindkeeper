# Claude 痕迹全量扫描 + Hook/Skill/MCP/StatusLine 保全指南

> 生成时间: 2026-04-17
> 扫描范围: macOS 全盘 (绝对路径) + MMS 网关层 + 浏览器 + IDE + 备份归档
> 前提约束: **不删除、不移动任何文件** — 仅扫描、仅落文档

---

## 一、系统架构说明

本机使用 **MMS (Model Management Service) 网关**运行 Claude Code，而非标准安装:

```
标准 Claude Code:    ~/.claude/         + ~/.claude.json
MMS 网关实例化:      ~/.config/mms/claude-gateway/s/{session_id}/.claude/ + .claude.json
                     ^ 当前实例: s/84756/
MMS 项目数据:        ~/.config/mms/projects/{project_id}/claude/raw/
                     ^ 当前项目: ccb2f97bfbcf9c5c
MMS 全局层:          ~/.config/mms/claude-gateway/.claude/ + .claude.json
```

**关键认知**: `~/.claude/` 在本机**不存在**（已被 MMS 替代）。settings.json 里引用的 `/Users/xin/.claude/hooks/` 等路径也是悬空的——是之前实例的残留引用。

---

## 二、全盘扫描结果 (逐层列出)

### 2.1 MMS 网关层 (核心)

| 路径 | 状态 | 大小 | 说明 |
|------|------|------|------|
| `~/.config/mms/` | 存在 | 4.9G | MMS 总目录 |
| `~/.config/mms/claude-gateway/.claude/` | 存在 | 7.4M | 全局 Claude 数据 |
| `~/.config/mms/claude-gateway/.claude.json` | 存在 | 12K | 全局配置 |
| `~/.config/mms/claude-gateway/.claude/CLAUDE.md` | 存在 (symlink) | -> `/Users/xin/.claude/CLAUDE.md` (目标不存在) | 全局指令 |

**当前实例 s/84756**:
| 字段 | 值 |
|------|-----|
| `userID` | `642c3eed2746ebd314bebd5adee769a1ad89284e784455e04b4574a680bacb1a` |
| `firstStartTime` | `2026-04-18T02:54:29.114Z` |
| `numStartups` | `1` |
| `lastOnboardingVersion` | `2.1.110` |
| `githubRepoPaths` | 1 个 |
| `projects` | 2 个 |
| `opusProMigrationComplete` | true |

**其他 MMS 实例** (共 5 个，均含 `.claude.json` + `.claude/`):
- `s/83050` (4.8M)
- `s/85223` (4.8M)
- `s/86175` (5.1M)
- `s/88047` (4.6M)

### 2.2 MMS 多账号层

**活跃账号** (3 个含 Claude 数据):
| 账号 | .claude.json | .claude/ | 大小 |
|------|-------------|----------|------|
| `claude-max-justin` | 是 | 是 | 4.0K + 4.0K |
| `claude-tonnya` | 是 | 是 | 8.0K + 44K |
| `alex-codex` | 否 | 否 | — |
| `gemini-alex-father` | 否 | 否 | — |
| `gemini1` | 否 | 否 | — |

**归档账号** (`accounts-archived/`):
| 归档 | .claude.json | .claude/ | 大小 |
|------|-------------|----------|------|
| `expired-oauth-20260411-112809/boss2-claude/` | 是 (88K) | 是 (336K) | 含 4 份 .claude.json 备份 |
| `expired-oauth-20260411-112809/apple-codex/s/29691/` | 是 (132K) | — | — |

### 2.3 MMC 层 (另一套管理器)

| 路径 | 状态 | 大小 |
|------|------|------|
| `~/.config/mmc/accounts/default/.claude.json` | **存在** (含 userID, oauthAccount, projects) | — |
| `~/.config/mmc/accounts/default/.claude/` | **存在** | — |

**这是独立于 MMS 的另一份 Claude 实例。**

### 2.4 MMS Backups (3.4G, 9 份归档)

| 归档名 | 大小 | 含 Claude 数据 |
|--------|------|---------------|
| `ccs-20260313-213545` | 190M | 是 (深层) |
| `codex-claude-state-clean-20260415-165344` | 1.8G | 是 |
| `config-migrate-20260313-220914` | 783M | 是 |
| `config-migrate-20260313-221010` | 186M | 是 |
| `config-migrate-20260313-221212` | 186M | 是 |
| `config-migrate-20260313-223332` | 186M | 是 |
| `mms-20260313-213545` | 8.0K | 是 |
| `provider-rename-20260313-223650` | 8.0K | 是 |
| `provider-rename-20260313-224114` | 186M | 是 |

### 2.5 CLI 安装物

| 路径 | 状态 | 大小 | 说明 |
|------|------|------|------|
| `~/.local/bin/claude` | 存在 (symlink) | 0B | -> `~/.local/share/claude/versions/2.1.110` |
| `~/.local/share/claude/versions/2.1.109` | 存在 | 192M | 旧版二进制 |
| `~/.local/share/claude/versions/2.1.110` | 存在 | 194M | 当前版本 |
| `~/.local/state/claude/locks` | 存在 | 0B | 锁文件 |
| `~/.local/state/claude/staging` | 存在 | 0B | 更新暂存 |
| `~/.cache/claude/` | 存在 | 0B | 缓存目录 |

### 2.6 Claude Desktop App

| 路径 | 状态 | 大小 |
|------|------|------|
| `/Applications/Claude.app` | 存在 | 567M |
| `~/Library/Caches/com.anthropic.claudefordesktop` | 存在 | 148K |
| `~/Library/Caches/com.anthropic.claudefordesktop.ShipIt` | 存在 | 8.0K |
| `~/Library/HTTPStorages/com.anthropic.claudefordesktop` | 存在 | 80K (sqlite + shm + wal) |
| `~/Library/Preferences/com.anthropic.claudefordesktop.plist` | **不存在** | — |
| `~/Library/Application Support/Claude` | **不存在** | — |

### 2.7 IDE 集成

| 路径 | 状态 | 大小 |
|------|------|------|
| `~/.vscode/extensions/anthropic.claude-code-2.1.109-darwin-arm64` | 存在 | 201M |
| `~/.vscode/extensions/anthropic.claude-code-2.1.112-darwin-arm64` | 存在 | 203M |
| Zed `claude-code-acp` | **不存在** | — |

### 2.8 浏览器

| 路径 | 状态 | 说明 |
|------|------|------|
| Chrome IndexedDB `*claude*` | **未发现** | 可能被之前清理过 |
| Chrome NativeMessagingHosts `com.anthropic*` | **未发现** | — |
| `com.openai.atlas` 中的 Claude 图片 | 存在 | 仅是 Atlas 内置的模型图标，非痕迹 |

### 2.9 Keychain

| 条目 | 状态 |
|------|------|
| `claude-code` | **不存在** |
| `claude-code-credentials` | **不存在** |

### 2.10 Shell 痕迹

**`.zsh_history`**: 517 行包含 "claude"
**`.bash_history`**: 2 行包含 "claude"

**`.zshrc`** 中 9 行涉及 Claude:
- L227-231: `claude_safe()` 函数
- L304-310: `claudep()` 包装函数 + `alias ccp='claudep'`
- L324: MMS statusline 注释

---

## 三、Hook / Skill / MCP / StatusLine 现状与保全方案

### 3.1 现状盘点 (关键发现)

**settings.json 里配置的 hooks**:

| Hook 类型 | 触发条件 | 命令 | 脚本存在? |
|-----------|---------|------|----------|
| SessionStart | 全部 | `/bin/bash /Users/xin/.claude/hooks/map-auto-index.sh` | **不存在** |
| PostCompact | 全部 | `/Users/xin/.claude/read-once/compact.sh` | **不存在** |
| PostCompact | 全部 | `bash .../multi-model-switch/hooks/hive-compact-hook.sh` | 存在 |
| PreToolUse (Bash) | Bash 工具 | `/Users/xin/.claude/hooks/rtk-rewrite.sh` | **不存在** |
| PreToolUse (Read) | Read 工具 | `READ_ONCE_DIFF=1 /Users/xin/.claude/read-once/hook.sh` | **不存在** |
| PreToolUse (WebFetch) | WebFetch 工具 | `.../multi-model-switch/hooks/claude-feishu-webfetch-guard.sh` | 存在 |
| PreCompact | 全部 | `bash .../multi-model-switch/hooks/hive-compact-hook.sh` | 存在 |
| **statusLine** | — | `.../multi-model-switch/statusline-command.sh` | 存在 |

**关键结论**:
1. settings.json 里有 **4 个 hook 脚本引用的是悬空路径** (`/Users/xin/.claude/hooks/...` 和 `/Users/xin/.claude/read-once/...`) — 这些脚本不存在了，说明之前某次清理/迁移时丢失了
2. **真正存活的** 自定义组件都在 `multi-model-switch` 仓库里:
   - `hooks/hive-compact-hook.sh` (PostCompact + PreCompact)
   - `hooks/claude-feishu-webfetch-guard.sh` (PreToolUse WebFetch 守卫)
   - `statusline-command.sh` (状态栏)

**Skills**: 当前实例 s/84756 没有 `skills/` 目录。全局 `.claude/skills/` 也不存在。
**MCP**: `.mcp.json` 不存在于当前实例或全局层。
**Commands**: `commands/` 目录不存在。
**CLAUDE.md**: 全局层有一个 symlink 指向 `/Users/xin/.claude/CLAUDE.md`，但该目标不存在。

### 3.2 能保住的部分

| 组件 | 当前状态 | 能否保住 | 说明 |
|------|---------|---------|------|
| hooks (4个悬空) | 脚本已不存在 | **保不了** | 源文件已丢失，settings.json 里的引用是残留 |
| hooks (2个存活) | `multi-model-switch/hooks/` | **能保住** | 这些在独立仓库里，不受 Claude 清理影响 |
| statusLine | `multi-model-switch/statusline-command.sh` | **能保住** | 同上，在独立仓库 |
| skills | 不存在 | **无** | 当前没有 |
| MCP | `.mcp.json` 不存在 | **无** | 当前没有 |
| commands | 不存在 | **无** | 当前没有 |
| CLAUDE.md | symlink 指向不存在目标 | **保不了** | 目标已丢失 |
| permissions | settings.json 中 | **能保住** | 可备份 settings.json 非追踪部分 |
| env | settings.json 中 | **能保住** | 可备份 env 配置 |

### 3.3 怎么保 (备份步骤)

```bash
# 1. 备份 settings.json 中有价值的非追踪配置
python3 -c "
import json
with open('/Users/xin/.config/mms/claude-gateway/s/84756/.claude/settings.json') as f:
    d = json.load(f)

# 提取有用的部分
backup = {
    'env': d.get('env', {}),
    'permissions': d.get('permissions', {}),
    'model': d.get('model'),
    'hooks': d.get('hooks', {}),
    'statusLine': d.get('statusLine', {}),
    'includeCoAuthoredBy': d.get('includeCoAuthoredBy'),
    'promptSuggestionEnabled': d.get('promptSuggestionEnabled'),
    'skipDangerousModePermissionPrompt': d.get('skipDangerousModePermissionPrompt'),
}
with open('/Users/xin/auto-skills/CtriXin-repo/claudefxxk/backup-settings.json', 'w') as f:
    json.dump(backup, f, indent=2)
print('Backup saved to backup-settings.json')
"

# 2. 确认 multi-model-switch 仓库的 hooks 和 statusline 是安全的
#    这些在 git 仓库里，不需要额外备份
ls /Users/xin/auto-skills/CtriXin-repo/multi-model-switch/hooks/
ls /Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh
```

### 3.4 清理后怎么恢复

**如果你做了 Level 5 (完全删除 `.claude/` 和 `.claude.json`)**:

```bash
# 恢复步骤
TARGET="/Users/xin/.config/mms/claude-gateway/s/{你的新session_id}/.claude/"

# 1. 从备份恢复 settings.json (去掉追踪字段后)
cp /Users/xin/auto-skills/CtriXin-repo/claudefxxk/backup-settings.json "$TARGET/settings.json"

# 2. 修正 settings.json 中的悬空 hook 路径
#    去掉指向 /Users/xin/.claude/hooks/ 的 4 个不存在的 hook
#    保留指向 multi-model-switch 的 3 个存活的 hook

# 3. hooks 和 statusline 不需要恢复——它们在 multi-model-switch 仓库里
#    只要 settings.json 正确引用即可

# 4. 如果之前有 CLAUDE.md，重新创建
#    (原文件已丢失，需要重新编写)
```

---

## 四、之前没提到但有用的部分

### 4.1 MMS 多实例交叉污染

当前 MMS 网关下有 **5 个独立 session** (83050, 84756, 85223, 86175, 88047)，**每个都有一份完整的 `.claude.json` + `.claude/`**。如果目标是"清除所有痕迹"，这些全清才算清。只清当前实例 = 没清。

### 4.2 MMC 独立实例

`~/.config/mmc/accounts/default/` 下有一套**独立于 MMS 的** Claude 实例，含 `userID`、`oauthAccount`、`projects`。这是另一个管理器，容易被漏掉。

### 4.3 归档备份链 = 复活点

`~/.config/mms-backups/` 里 3.4G 的 9 份归档，以及 `accounts-archived/` 里的过期 OAuth 账号备份。**如果不清这些，旧身份可以从备份中恢复**。这是清理后最容易"死灰复燃"的路径。

### 4.4 CLI 二进制 = 安装铁证

`~/.local/share/claude/versions/` 里 386M 的二进制文件。即使账号清了、数据清了，这个目录还在 = "这台机器装过 Claude CLI"的铁证。

### 4.5 Desktop App 缓存未清

`~/Library/Caches/com.anthropic.claudefordesktop` 和 `~/Library/HTTPStorages/com.anthropic.claudefordesktop` 仍然存在，含 Cache.db 和 sqlite 数据库。虽然 Application Support/Claude 不存在了，但缓存层还在。

### 4.6 Shell History = 人类可读痕迹

`.zsh_history` 里 517 行含 "claude"。包括安装命令、MCP 配置、dangerously 模式运行等。如果目标是"消痕"，这层需要处理。

### 4.7 .zshrc 中的 Claude 函数

`claude_safe()` 和 `claudep()` 函数 + `ccp` alias。这些是个人工作流的一部分，不影响程序但暴露使用历史。

### 4.8 VS Code 扩展 = 400M+ 安装物

两个版本的 Anthropic VS Code 扩展共 404M。如果目标是"看起来没装过"，需要处理。

---

## 五、完整痕迹清单 (按清理必要性排序)

### Tier 0: 身份追踪 (必须清)

| 路径 | 追踪字段 | 风险 |
|------|---------|------|
| `~/.config/mms/claude-gateway/s/84756/.claude.json` | `userID`, `firstStartTime`, `numStartups` | 高 |
| `~/.config/mms/claude-gateway/s/83050/.claude.json` | 同上 | 高 |
| `~/.config/mms/claude-gateway/s/85223/.claude.json` | 同上 | 高 |
| `~/.config/mms/claude-gateway/s/86175/.claude.json` | 同上 | 高 |
| `~/.config/mms/claude-gateway/s/88047/.claude.json` | 同上 | 高 |
| `~/.config/mms/claude-gateway/.claude.json` | 全局 userID | 高 |
| `~/.config/mmc/accounts/default/.claude.json` | `userID`, `oauthAccount` | 高 |
| `~/.config/mms/accounts/claude-max-justin/.claude.json` | 同上 | 高 |
| `~/.config/mms/accounts/claude-tonnya/.claude.json` | 同上 | 高 |
| `~/.config/mms/accounts-archived/*/`*`/.claude.json` | 过期但仍有 userID | 中 |

### Tier 1: 本地记忆 (建议清)

| 路径 | 内容 | 风险 |
|------|------|------|
| `~/.config/mms/claude-gateway/s/*/.claude/` | sessions, history, file-history, transcripts | 高 |
| `~/.config/mms/claude-gateway/.claude/` | 全局会话数据 | 高 |
| `~/.config/mms/projects/ccb2f97bfbcf9c5c/claude/raw/` | sessions(20K), file-history(40K), history.jsonl(8K) | 高 |
| `~/.config/mmc/accounts/default/.claude/` | 同上 | 高 |
| `~/.config/mms/accounts/*/`*`/.claude/` | 同上 | 高 |

### Tier 2: 备份/归档 (建议清)

| 路径 | 大小 | 风险 |
|------|------|------|
| `~/.config/mms-backups/` | 3.4G (9份) | 高 (复活点) |
| `~/.config/mms/accounts-archived/` | 含旧账号数据 | 高 |

### Tier 3: 安装痕迹 (可选清)

| 路径 | 大小 | 说明 |
|------|------|------|
| `/Applications/Claude.app` | 567M | Desktop 应用 |
| `~/.local/share/claude/versions/` | 386M | CLI 二进制 |
| `~/.local/bin/claude` | symlink | CLI 入口 |
| `~/.local/state/claude/` | 0B | 状态目录 |
| `~/.cache/claude/` | 0B | 缓存目录 |
| `~/.vscode/extensions/anthropic.claude-code-*` | 404M | VS Code 扩展 |
| `~/Library/Caches/com.anthropic.claudefordesktop` | 148K | Desktop 缓存 |
| `~/Library/HTTPStorages/com.anthropic.claudefordesktop` | 80K | Desktop HTTP 存储 |

### Tier 4: 人类可读痕迹 (按需清)

| 路径 | 内容 | 说明 |
|------|------|------|
| `~/.zsh_history` | 517 行 | 命令历史 |
| `~/.bash_history` | 2 行 | bash 历史 |
| `~/.zshrc` | 9 行 | Claude 相关函数/alias |

### 不误删的白名单

以下路径**包含 "claude" 字样但不应该删除**:
- `~/.cursor/extensions/esbenp.prettier-vscode-*/.claude` — Cursor 的内部文件
- `~/.cursor/extensions/esbenp.prettier-vscode-*/CLAUDE.md` — 同上
- `com.openai.atlas/.../claude3haiku.png` — Atlas 的模型图标
- 仓库中仅"提到 Claude"的文档

---

## 六、Hook/Skill/MCP/StatusLine 决策树

```
你想清到什么程度?
│
├─ A. 只清身份追踪 (Tier 0)
│   └─ hooks/skills/statusLine 不受影响，它们不在追踪字段里
│
├─ B. 清身份 + 本地记忆 (Tier 0 + Tier 1)
│   └─ settings.json 会被删 → 但 hooks 脚本本身在 multi-model-switch 仓库里
│   └─ 恢复时从 backup-settings.json 重新写入 settings.json 即可
│
├─ C. 全清 (Tier 0-3)
│   └─ 同上 + VS Code 扩展和 CLI 二进制被删
│   └─ hooks/statusLine 仍然安全 (在独立 git 仓库)
│   └─ 需要: 重新安装 Claude CLI + 恢复 settings.json
│
└─ D. 人类可读也清 (Tier 0-4)
    └─ .zshrc 中的 claude 函数会被删 → 手动编辑 .zshrc 去掉相关段
    └─ hooks/statusLine 仍然安全 (在 git 仓库)
```

**核心结论**: 你提到的 hooks/skills/mcp/statusline 中:
- **hooks**: 4 个已丢失(悬空引用)，2 个存活(在 multi-model-switch 仓库)
- **skills**: 当前不存在，无损失
- **mcp**: 当前不存在，无损失
- **statusLine**: 存活，在 multi-model-switch 仓库
- **能保住的都已经在 git 仓库里了**，清 Claude 不影响它们
- **保不住的已经丢了**，settings.json 里残留的是悬空引用

---

## 七、MMC / MMS 架构安全评估 + cc-gateway 对比

### 7.1 更新后 MMC 的实际安全性验证

**你的判断**: "更新后的 MMC 已经安全很好了"

**本次全盘扫描验证结果**: **基本正确，但仍有薄弱项**。

#### 7.1.1 MMC 已做好的防御 (已验证代码层面)

| 防御层 | 代码证据 | 评估 |
|--------|---------|------|
| **HOME 隔离** | `_build_process_env()` 中 `env["HOME"] = str(session_home)` + 完整 XDG 重定向 | 完善 |
| **环境变量白名单** | `_ALLOWED_LAUNCH_ENV_KEYS` 仅 14 个键被允许透传 | 完善 |
| **嵌套 Session 检测** | `_ensure_not_nested_session()` 检查 `MMC_SESSION_HOME` 环境变量 | 已修复 (原 mmc.md 中列为 P1) |
| **Proxy 强制路由** | `_resolve_proxy_launch_target()` 强制要求 `--proxy http://127.0.0.1:31xxx` | 完善 |
| **Proxy Guard 健康检查** | `_enforce_proxy_guard_or_exit()` 检测 DNS/DNS leak/出口 IP/NO_PROXY 冲突 | 完善 |
| **运行时 Proxy Guard** | `_start_session_proxy_guard()` 独立线程守护，失败即杀子进程 | 完善 |
| **进程树强杀 + TTY 恢复** | `_terminate_child_process()` SIGTERM→SIGKILL + `_restore_tty_state()` 调用 `stty sane` | 已修复 (原 mmc.md 中列为 P1) |
| **OAuth 账号绑定** | `binding_matches_owner()` 校验 route 与 OAuth account 一致性 | 完善 |
| **Keychain symlink** | `_link_keychains_only()` 仅 symlink Keychains 目录，不复制 | 合理 |
| **Session PID 印记** | `_write_session_pid_stamp_path()` + stale cleanup | 完善 |
| **并发上限** | `_reserve_session_home()` 限制 `_MAX_LIVE_SESSIONS` | 完善 |
| **Binary 路径安全** | `_assert_safe_binary_path()` 禁止敏感路径 token | 完善 |

#### 7.1.2 MMC 仍然存在的薄弱项

**薄弱项 1: MMC `.claude.json` 含完整 OAuth 凭据**

```
mmc .claude.json 字段:
  userID: 193a96d42254a18ae...
  oauthAccount:
    accountUuid: d09b3f48-6fd4-4360-81fc...
    emailAddress: hatchwhittemore87@gmail.com
    organizationUuid: c3a34876-7b7a-4cd0-af7a...
    billingType: google_play_subscription
```

MMC 的 `.claude.json` 保存了完整的 OAuth 账号信息 (email、UUID、billingType)。如果这个文件被泄露，等于暴露了账号身份。MMC 本身不加密这个文件。

**薄弱项 2: MMC 没有自己的遥测/指纹剥离**

MMC 做的是**隔离** (HOME 重定向 + proxy 路由)，**不是重写**。Claude Code 发出的遥测请求中的 `device_id`、`env` 对象 (40+ 字段)、`User-Agent`、`x-anthropic-billing-header` 等**全部原样发送给上游 proxy**。如果上游 proxy (如 MMS) 不做重写，Anthropic 仍然能看到完整指纹。

MMC 假设上游 proxy 会处理这些——它自己不处理。

**薄弱项 3: 当前 launcher.json 配置为 `bypass: true`**

```json
{
  "proxy": "http://127.0.0.1:31001",
  "bypass": true,
  ...
}
```

`bypass: true` 意味着启动时传入 `--dangerously-skip-permissions`。这不是安全漏洞，但是意味着 MMC session 默认跳过了 Claude 的权限确认。

**薄弱项 4: MMC settings.json 为空**

当前 MMC 的 `~/.config/mmc/accounts/default/.claude/settings.json` 是空对象 `{}`。说明 MMC 没有注入 hooks (虽然 `_build_builtin_hook_settings()` 代码存在但没生效)。这意味着 MMC session 的 hook 配置依赖 MMS 层或手动注入。

**薄弱项 5: IPv6 穿透风险 (mmc.md 中的 P1 仍未修)**

`_build_process_env()` 中没有注入 `NODE_OPTIONS` 或 DNS 排序参数来强制 IPv4。代码中 `--force-ipv4` 参数已被标记为 `raise SystemExit` (显式拒绝)。MMC 认为"应该在系统层网络策略解决"，但这仍然是一个潜在穿透路径。

**薄弱项 6: 多 MMS/MMC 实例交叉**

当前机器同时存在:
- MMS: 5 个 session + 全局层 + 3 个活跃账号
- MMC: 1 个默认账号 + 2 个项目
- mms-backups: 9 份归档

MMC 只管自己的 `~/.config/mmc/`，**不管 MMS 的数据**。如果你在 MMC session 里操作，MMS 的 session 数据和追踪指纹仍然在积累。MMC 不能帮你"清 MMS 的痕迹"。

### 7.2 cc-gateway 项目分析

**项目**: https://github.com/motiful/cc-gateway
- Stars: 2,670 | Forks: 468
- 语言: TypeScript
- 创建: 2026-03-31 (仅 17 天前)
- 最后更新: 2026-04-02 (v0.2.0)

#### 7.2.1 cc-gateway 做什么

它是一个 **反向代理**，位于 Claude Code 和 Anthropic API 之间:

```
Claude Code → cc-gateway (:8443) → api.anthropic.com
```

核心能力:
1. **身份重写**: `device_id`、`email`、`user_id` → 规范化为单一身份
2. **环境指纹替换**: 40+ 字段 `env` 对象整体替换
3. **系统提示重写**: `<env>` 块中的 Platform/Shell/OS/Working directory 重写
4. **账单头剥离**: 移除 `x-anthropic-billing-header` (跨 session prompt cache 共享，节省 ~85%)
5. **进程指标模糊化**: RAM/RSS/heap 标准化
6. **集中 OAuth**: 网关管理 token 刷新，客户端不接触 `platform.claude.com`
7. **零登录客户端**: 每个用户一个 launcher 脚本，无需配置

#### 7.2.2 cc-gateway vs MMC vs MMS 对比

| 维度 | cc-gateway | MMC | MMS |
|------|-----------|-----|-----|
| **定位** | 反向代理 (网络层) | 隔离启动器 (进程层) | 多模型路由+代理 (应用层) |
| **指纹重写** | 是 (40+ 字段) | 否 (依赖上游) | 是 (通过 env 注入) |
| **HOME 隔离** | 否 | 是 (完整 XDG 重定向) | 是 (MMS 路径映射) |
| **OAuth 管理** | 是 (自动刷新) | 是 (导入/合并) | 是 (桥接) |
| **多账号** | 是 (client-per-user) | 是 (account home) | 是 (multi-account) |
| **代理检测** | Clash 规则 (网络层) | Proxy Guard (应用层) | 路由层 |
| **部署方式** | Docker / 本地 | Python CLI | Python CLI |
| **开源** | 是 (MIT, 2.6k stars) | 否 (私有) | 否 (私有) |
| **维护状态** | 活跃 (但 4/2 后无更新) | 活跃 | 活跃 |

#### 7.2.3 cc-gateway 的局限性

1. **MCP 旁路**: `mcp-proxy.anthropic.com` 是硬编码的，不走 `ANTHROPIC_BASE_URL`。cc-gateway 建议用 Clash 阻止。MMC 同样不处理 MCP 旁路。

2. **CC 更新风险**: 文档明确警告 "New Claude Code versions may introduce new telemetry fields or endpoints"。Claude Code 更新后可能绕过网关。MMC 通过白名单 env 防御了这一点。

3. **仅处理 API 流量**: cc-gateway 只重写发送到 Anthropic 的 HTTP 请求。本地 `.claude.json` 中的 `userID`、`firstStartTime` 等字段**不被重写**。MMC 通过 HOME 隔离让每个 session 有独立 `.claude.json`。

4. **维护停滞**: 最后 commit 是 2026-04-02 (15天前)，issue #18 "我怀疑这个项目已经失效了" 和 #21 "出现了429情况" 未关闭。

5. **中文社区运营**: Issues 大量是"Token联盟"、"交流群"、"中转站长群"等运营类帖子，技术维护关注度不足。

6. **不解决本地痕迹**: cc-gateway 只保护网络流量。本地的 `~/.claude/`、`history.jsonl`、`sessions/` 等**完全不被处理**。MMC 通过 HOME 隔离解决了这个问题。

#### 7.2.4 cc-gateway 能不能替代 MMC/MMS?

**不能。它们互补**:

- cc-gateway = **网络层匿名化** (让 Anthropic 看不到你的真实设备指纹)
- MMC = **进程层隔离** (让 Claude Code 在沙盒里运行，不碰真实 HOME)
- MMS = **应用层多模型路由** (在多个模型/API 提供商之间切换)

最强方案是三者叠加:
```
Claude Code → (MMC HOME隔离) → (MMS 多模型路由) → (cc-gateway 指纹重写) → Anthropic
```

但当前你的架构是:
```
Claude Code → (MMC HOME隔离) → (MMS 桥接) → Anthropic
```
cc-gateway 没有被集成进来。

### 7.3 MMC + MMS 联合薄弱项总结

| # | 薄弱项 | 严重程度 | 说明 |
|---|--------|---------|------|
| 1 | **MMC .claude.json 明文 OAuth** | 高 | 含 email、UUID、billingType，无加密 |
| 2 | **MMC 不做指纹重写** | 中 | 依赖上游 proxy，如果 MMS 不重写则完全裸奔 |
| 3 | **MMS 多实例交叉污染** | 高 | 5 个 session 各有 userID，MMC 不管 MMS |
| 4 | **mms-backups 复活点** | 高 | 3.4G/9 份归档含完整旧状态 |
| 5 | **accounts-archived 旧账号** | 中 | 过期 OAuth 账号的 userID/oauthAccount 仍在 |
| 6 | **MMC bypass:true 默认** | 低 | 跳过权限确认，功能非安全 |
| 7 | **IPv6 穿透** | 低 | 系统层风险 |
| 8 | **cc-gateway 未集成** | 中 | 缺少网络层指纹重写 |
| 9 | **Desktop App 缓存未清** | 中 | Cache.db + HTTPStorages sqlite 仍在 |
| 10 | **VS Code 扩展 404M** | 低 | 安装痕迹，不影响运行安全 |

---

## 八、参考文档

- `gpt.md` — GPT 视角的全盘扫描 + 分层清理方案 (最详细)
- `gemini.md` — Gemini 视角的 5 级清理方案 + 决策矩阵
- `glm.md` — GLM 视角的补刀扫描 (Desktop/Browser/Shell/mms-backups)
- `../multi-model-switch/issue/mmc.md` — MMC 专项审计报告 (嵌套Session/终端锁定等) 
