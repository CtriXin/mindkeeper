# Claude 完全隔离 — 执行手册

> 执行时只看这个文档。背景、讨论、对比见 archive/ 和 discussions/。

---

## 执行前检查清单

| 检查项 | 状态 |
|--------|------|
| 已运行 `./backup-missing-to-safe-zone.sh` 并生成 `backup-run-*/` | 必须 ✅ |
| agent-im git 已 push（0 个未提交修改） | 必须 ✅ |
| MMS 中的 Claude 工作已保存 | 必须 ✅ |
| 其他 terminal 的 Claude 任务已关闭 | 必须 ✅ |
| Chrome 多账户：脚本会清空**所有 profile** 的 Claude Cookie/IndexedDB | 已知 |

---

## 执行步骤

### Step 1: 进入目录

```bash
cd ~/auto-skills/CtriXin-repo/claudefxxk/v3
```

### Step 2: 备份（如还没做）

```bash
./backup-missing-to-safe-zone.sh
# 确认生成 backup-run-YYYYMMDD-HHMMSS/
```

### Step 3: DRY_RUN 验证（可选但建议）

```bash
DRY_RUN=1 ./claude-nuke-and-restore.sh
# 输入 ISOLATE，一路按提示操作
# 观察各阶段 [DRY-RUN] 输出是否符合预期
```

### Step 4: 真实执行

```bash
./claude-nuke-and-restore.sh
```

输入 `ISOLATE`，然后按以下建议操作：

| 阶段 | 操作建议 |
|------|---------|
| 0-3（前置/杀进程/核心身份/Keychain） | 一路 `y` |
| 4-11（可选清理） | 建议全 `y`，彻底清除 |
| 12（history） | `y`。只修改 history 文件，**不会关闭当前窗口** |
| 13（.zshrc 函数） | `y`。会先备份到 `~/.zshrc.backup-` |
| 14（git email） | **`N`** 跳过不改，或按回车保持当前 |
| 15（npm install） | `1` |
| 16（OAuth 验证） | **新开一个 Terminal 窗口**，运行 `claude`，确认弹出 OAuth 页面后回此窗口按 `y` |
| 17-18（恢复+验证） | 自动执行 |

---

## 恢复内容确认

脚本会自动恢复：

| 恢复项 | 来源 |
|--------|------|
| CLAUDE.md | 最新 backup-run |
| settings.json（permissions + bypass + statusLine） | `settings-current-session-sanitized.json` |
| MCP servers | Codex backfill 模板 |
| settings.local.json | 最新 backup-run |
| Plugins | 最新 backup-run |
| Skills（实体+symlink） | 最新 backup-run + safe_zone + Codex backfill |
| Hooks（含 read-once） | Codex backfill，路径自动映射 |
| .cc-switch/skills | 如 live 已存在则跳过覆盖 |
| .agents/skills | 如 live 已存在则跳过覆盖 |

---

## 网络层配置（`~/.zshrc` 中的 `claude()` 函数）

隔离脚本（阶段 13）会清理 `~/.zshrc` 中的旧 `claude()` 函数。执行完成后，需要把代理配置重新注入 `~/.zshrc`。

**当前配置要点：**

- **代理协议**: `http://`（Claude CLI 的 Node.js 不支持 `socks5://` 或 `socks5h://`）
- **主代理**: `http://127.0.0.1:31001`（Oracle relay via SSH）
- **Fallback**: `http://127.0.0.1:7897`（Clash HTTP）
- **TZ 固定**: `America/Los_Angeles`（查询失败时兜底，不随 IP 波动）
- **快照机制**: 记录上次 IP+TZ，MATCH 时跳过检验快速启动

**安装方式：**

```bash
# 把 v3/claude-proxy.zsh 的内容追加到 ~/.zshrc 末尾
cat ~/auto-skills/CtriXin-repo/claudefxxk/v3/claude-proxy.zsh >> ~/.zshrc
source ~/.zshrc
```

**验证：**

```bash
claude
# 应显示:
# [Claude] IP: x.x.x.x
# [Claude] TZ: America/Los_Angeles
# [Claude] localTime: MM.DD HH:mm:ss
# [Claude] tzTime: MM.DD HH:mm:ss
# 按回车启动，看到 OAuth 弹窗 = 配置正确
```

---

## 如果出问题

| 问题 | 回滚方式 |
|------|---------|
| .zshrc 被破坏 | `cp ~/.zshrc.backup-YYYYMMDD-HHMMSS ~/.zshrc` |
| history 丢失 | `cp ~/.zsh_history.backup-YYYYMMDD-HHMMSS ~/.zsh_history` |
| .claude 目录丢失 | 从 `~/claude_safe_zone/backup-run-*/` 手动恢复 |
| .claude.bak 被移走 | 在 `~/auto-skills/CtriXin-repo/claudefxxk/backups/backup-*/` 找回 |
| 阶段 18 验证失败 | 脚本自动 `exit 1`，检查 `[✗]` 项，手动补漏 |

---

## 执行后

1. Claude CLI 需要重新 OAuth 登录
2. MMS 中的 Claude session 可能需要重新启动
3. MCP servers 是独立子进程，可能不继承代理，如需隔离请单独检查
