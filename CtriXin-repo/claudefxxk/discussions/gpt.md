# Claude 痕迹清理讨论底稿（GPT）

更新时间：2026-04-17 20:26:00 PDT

结论先写在前面：这次 2026-04-17 的二次 live scan 表明，当前主目录下已经没有 `/Users/xin/.claude` 和 `/Users/xin/.claude.json`，但 Claude 痕迹并没有清干净；活跃或可恢复痕迹主要还在 `/Applications/Claude.app`、`/Users/xin/.config/mmc/accounts/default/.claude.json`、`/Users/xin/.config/mmc/projects/*/claude/raw`、`/Users/xin/.config/mms-backups/...`、`/Users/xin/.claude.json.backup`、`/Users/xin/.local/share/claude`、VS Code 扩展与日志、`Claude Code URL Handler.app`、shell history、`.zshrc` 和 `Library/Logs/Claude/claude.ai-web.log`。另外，这次补充检查确认：此前从 live 路径移走的一部分 `hook / skill / statusline / settings` 资产，现保存在 `/Users/xin/claude_safe_zone`；其中 `claude-context-restore-hint.sh`、`map-auto-index.sh`、`token-monitor-hook.sh`、`rtk-rewrite.sh`、`statusline-command.sh` 等脚本本体已找到，但 `compact.sh`、`hook.sh`、`RTK.md`、`.mcp.json` 仍未在 `safe_zone` 找回。`hook / skill / mcp / statusline` 不是完全保不住，但只能白名单提取或按 repo 路径重建，不能把旧 `settings.json` / `.claude.json.backup` 整包回填。

## 1. 本文用途

这份文档不是执行脚本，而是给多 Agent 讨论时统一口径用的底稿，重点回答四件事：

1. 已经确认有哪些 Claude 痕迹。
2. 哪些是必须清，哪些是可选清，哪些只是名字里带 `claude` 但不该误删。
3. 真正执行清理时涉及面多大。
4. 每一层清理的代价和副作用是什么。

## 2. 证据来源

- 图片审阅：`/Users/xin/Downloads/未命名文件夹 4` 下 11 张截图。
- 参考文档：`/Users/xin/Downloads/Claude Code 封号机制逆向探查 (1).docx`，重点参考了设备身份、`git config user.email`、环境探测、代理检测和遥测侧字段。
- 本机路径扫描：按 `claude` / `anthropic` 相关路径名做了二次系统扫描。
- Browser / app 定点验证：抽查了 Chrome / Atlas browser-data、Claude Desktop 缓存、HTTP storage、CLI 安装路径、IDE 集成与 log。
- 配置定点验证：抽查了 `/Users/xin/.config/mmc/accounts/default/.claude.json`、`/Users/xin/.claude.json.backup`、`/Users/xin/.config/mms-backups/...`、旧 gateway `settings.json` 快照与 shell config。
- 命令痕迹验证：抽查了 shell history 与 shell config。
- 文档前置状态：已按仓库规则先读仓库根 `HANDBOOK.md`；当前子项目本地没有 `CLAUDE.md`，因此以下判断以 live 扫描结果为主。

## 2.1 2026-04-17 二次 live scan 纠偏（优先级高于下文旧条目）

下面这些结论优先级高于后面第一次扫描时写下的旧条目：

- 当前**不存在**：`/Users/xin/.claude`、`/Users/xin/.claude.json`。
- 当前 live 身份主落点是：`/Users/xin/.config/mmc/accounts/default/.claude.json`。
- 当前 live 会话与历史主落点是：`/Users/xin/.config/mmc/projects/*/claude/raw/{sessions,transcripts,history.jsonl,file-history}`。
- 当前最危险的历史恢复源是：`/Users/xin/.claude.json.backup` 与 `/Users/xin/.config/mms-backups/...` 下各类 `.claude.json` / `.claude` 快照。
- 当前 `/Users/xin/.config/mmc/accounts/default/.claude/settings.json` 只有 `{}`，这反而是后续“白名单重建”的干净落点。

这次 live scan 已确认仍然存在的高价值痕迹：

- `/Applications/Claude.app`，约 `567M`
- `/Users/xin/.local/share/claude`，约 `386M`，含 `versions/2.1.109` 和 `versions/2.1.110`
- `/Users/xin/.local/bin/claude`，symlink 到 `/Users/xin/.local/share/claude/versions/2.1.110`
- `/Users/xin/Library/Caches/com.anthropic.claudefordesktop`
- `/Users/xin/Library/HTTPStorages/com.anthropic.claudefordesktop`
- `/Users/xin/Library/Logs/Claude/claude.ai-web.log`
- `/Users/xin/.vscode/extensions/anthropic.claude-code-*`
- `/Users/xin/Library/Application Support/Code/logs/.../Anthropic.claude-code`，当前命中 `17` 个目录
- `/Users/xin/Applications/Claude Code URL Handler.app`
- `/Users/xin/.zshrc` 中 `claude_safe()`、`claudep()`、`Anthropic reachable` 检查和 `MMS statusline` 注释
- `/Users/xin/.zsh_history` / `/Users/xin/.bash_history` 中大量 `claude`、`claude mcp ...`、`curl -fsSL https://claude.ai/install.sh | bash`、`claude --dangerously-skip-permissions` 历史
- `/Users/xin/.gitconfig` 的 `user.email = songxin@ushareit.com`

这次 live scan 明确**未命中**的条目：

- `/Users/xin/.claude`
- `/Users/xin/.claude.json`
- `/Users/xin/Library/Application Support/Claude`
- Chrome 的 `https_claude.ai_0.indexeddb.leveldb`
- `NativeMessagingHosts/com.anthropic.claude_browser_extension.json`
- `com.openai.atlas` 下的 `https_claude.ai_0.indexeddb.leveldb`
- `Keychain` 中的 `claude-code` / `claude-code-credentials`
- Zed 的完整 `claude-code-acp` agent 目录（只扫到一个 `claude-code-acp.svg` icon）

因此，后文凡是把这些未命中条目写成“当前仍存在”，都应理解为历史扫描结果，不应再当作这次 live scan 的结论。

## 2.2 这次补上的漏项（参考 docx + live scan）

这部分是图片里没展开、但对“保住能力”和“避免误恢复旧身份”很有用的点：

- `git config --global user.email`：参考 `.docx` 的结论，这个字段会暴露身份；本机当前确实设置为 `songxin@ushareit.com`。
- `.claude.json.backup` 不只是 backup 名字唬人，它当前仍带 `api_key`、`oauthAccount`、`userID`、`anonymousId`、`claudeCodeFirstTokenDate`、`projects`、`mcpServers`。
- 旧 `settings.json` 不是纯 UI 配置，里面还有 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`MMS_ROUTE_STATUS_PATH` 和模型路由 env。
- `Library/Logs/Claude/claude.ai-web.log` 这类 Web log 很容易漏掉，但它明确出现 `claude.ai` / `anthropic.com` 域名和报错上下文。
- VS Code 的 `Claude VSCode.log` 里能直接看到 `AuthManager initialized` 和 `MCP Server running on port ...`。
- `Claude Code URL Handler.app` 和 `.zshrc` 中的 `claude_safe()` / `claudep()` 属于“人类可读 + 可执行”的使用痕迹，和纯缓存不是一类东西。

## 3. 图片里已经指出的核心范围

11 张图的核心观点基本一致，覆盖了下面这些层：

- `~/.claude.json`：核心 ID / 账号关联。
- `~/.claude/`：history、telemetry、debug、projects、file-history、session-env、statsig 等本地状态。
- Chrome 的 `https_claude.ai_0.indexeddb.leveldb`。
- VS Code 的 `Anthropic.claude-code` 扩展日志。
- `Keychain` 中的 `claude-code` / `claude-code-credentials`。
- `oauthAccount`、`userID`、`anonymousId`、`stable_id` 这类关键字段。
- `CLAUDE.md` / `settings.json` / `skills/` / `hooks/` 需要先备份再决定是否清。

这些结论方向是对的，但图片没有覆盖完整的“系统真实落点”。

## 4. 这次额外确认到的真实痕迹

### 4.1 核心 CLI 身份与本地记忆

已确认存在：

- `~/.claude.json`，约 `60K`
- `~/.claude/`，约 `121M`

`~/.claude.json` 当前顶层就包含这些高价值字段：

- `userID`
- `anonymousId`
- `oauthAccount`
- `projects`
- `githubRepoPaths`
- `mcpServers`
- `toolUsage`
- `skillUsage`
- `claudeCodeFirstTokenDate`
- `firstStartTime`

`~/.claude/` 当前顶层可见的重要内容包括：

- `history.jsonl`，约 `1.4M`
- `file-history/`，约 `2156` 项
- `session-env/`，约 `1126` 项
- `tasks/`，约 `770` 项
- `telemetry/`，约 `32` 项
- `statsig/`，约 `5` 项
- `skills/`，约 `238` 项
- `hooks/`，约 `5` 项
- `projects/`，约 `303` 项
- `todos/`，约 `2512` 项
- `transcripts/`，约 `79` 项
- `plans/`，约 `61` 项
- `teams/`，约 `44` 项
- `settings.json` / `settings.json.bak*`
- `CLAUDE.md` / `CLAUDE.md.backup-*`
- `RTK.md`

这说明现在不只是“有安装痕迹”，而是存在一整套完整的本地身份、历史、工作流和项目映射。

### 4.2 Keychain 当前状态

图片把 `Keychain` 列为重点项，但这次现场检查的结果是：

- `claude-code`：`ABSENT`
- `claude-code-credentials`：`ABSENT`

也就是说，**图片中的这一层目前在 live 状态下未发现活动条目**。如果目标只是清 live 账号关联，这一层现在不是主 blocker；但如果后续其他 Agent 再次登录过，仍要重新检查。

### 4.3 Browser 痕迹比图片里更广

#### Chrome IndexedDB

已确认存在 `claude.ai` 的 IndexedDB 残留，共 `10` 个 Profile：

- `Default`
- `Profile 9`
- `Profile 10`
- `Profile 11`
- `Profile 12`
- `Profile 13`
- `Profile 14`
- `Profile 15`
- `Profile 16`
- `Profile 17`

其中 `Profile 16` 与 `Profile 17` 还同时存在 `.blob`。

#### Chrome Cookies

仅看 `Cookies` 数据库，仍然有 `claude.ai` / `anthropic.com` 相关 Cookie 的 Profile 至少 `11` 个：

- `Default`
- `Profile 5`
- `Profile 9`
- `Profile 10`
- `Profile 11`
- `Profile 12`
- `Profile 13`
- `Profile 14`
- `Profile 15`
- `Profile 16`
- `Profile 17`

这点很重要：**只删 IndexedDB 不等于 Browser 清干净**。

#### Chrome Native Messaging Host

还发现了：

- `/Users/xin/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json`

这属于 Claude browser extension / integration 面，不是账号数据本身，但如果目标包含“不要再看起来装过 Claude browser integration”，它也应进入讨论范围。

#### 其他 browser-data

除了 Chrome，本机还有额外 browser-data 命中：

- `/Users/xin/Library/Application Support/com.openai.atlas/.../IndexedDB/https_claude.ai_0.indexeddb.leveldb`

说明 Claude Web 痕迹不只在 Chrome Profile 里，至少还有一套额外 host browser-data 残留。

### 4.4 Claude Desktop 自身状态远比图片里提到的多

已确认存在：

- `/Applications/Claude.app`，约 `567M`
- `/Users/xin/Library/Application Support/Claude`，约 `636M`
- `/Users/xin/Library/Caches/com.anthropic.claudefordesktop`
- `/Users/xin/Library/Caches/com.anthropic.claudefordesktop.ShipIt`
- `/Users/xin/Library/Preferences/com.anthropic.claudefordesktop.plist`
- `/Users/xin/Library/Preferences/ByHost/com.anthropic.claudefordesktop.ShipIt.5B746062-B04B-55D3-A72E-4C0CD9ADAA8B.plist`
- `/Users/xin/Library/HTTPStorages/com.anthropic.claudefordesktop`

`/Users/xin/Library/Application Support/Claude` 里面已经不是简单缓存，而是一整套 app state：

- `Cookies`（现场统计 `18` 条 `claude.ai` / `anthropic.com` 相关 Cookie）
- `Local Storage`
- `Session Storage`
- `WebStorage`
- `IndexedDB`
- `Network Persistent State`
- `Preferences`
- `claude-code/`
- `claude-code-vm/`
- `vm_bundles/`
- `local-agent-mode-sessions/`
- `ant-did`
- `config.json`
- `window-state.json`

如果目标是“把 Claude Desktop 当成没用过”，这块必须单独成层处理。

### 4.5 CLI 安装物和运行缓存

已确认存在：

- `/Users/xin/.local/bin/claude`（symlink，指向 `/Users/xin/.local/share/claude/versions/2.1.110`）
- `/Users/xin/.local/share/claude`，约 `386M`
- `/Users/xin/.local/state/claude`
- `/Users/xin/.cache/claude`
- `/Users/xin/Library/Caches/claude-cli-nodejs`，约 `68M`

当前 `~/.local/share/claude/versions` 里可见版本：

- `2.1.109`
- `2.1.110`

这一层如果不清，哪怕账号清了，机器上仍然非常明显地保留了 Claude CLI 安装与运行轨迹。

### 4.6 Editor / IDE 集成痕迹

#### VS Code

已确认存在：

- `/Users/xin/.vscode/extensions/anthropic.claude-code-2.1.109-darwin-arm64`，约 `201M`
- `/Users/xin/.vscode/extensions/anthropic.claude-code-2.1.112-darwin-arm64`，约 `203M`
- `/Users/xin/Library/Application Support/Code/logs/.../Anthropic.claude-code/...`

当前至少有 `17` 个 `Anthropic.claude-code` log 目录命中。

#### Zed

已确认存在：

- `/Users/xin/Library/Application Support/Zed/external_agents/claude-code-acp`，约 `95M`
- 对应 icon / `node_modules/@anthropic-ai/*`

如果目标包括“IDE 集成层面不留 Claude”，VS Code 和 Zed 都不能漏。

### 4.7 账号镜像与历史备份层是最大补刀点

这是这次扫描里最容易被漏掉、但最关键的一层。

#### mmc 当前镜像账号

已确认存在：

- `/Users/xin/.config/mmc/accounts/default/.claude.json`
- `/Users/xin/.config/mmc/accounts/default/.claude/`
- `/Users/xin/.config/mmc/accounts/default/.claude.json.lock`

其中 `.claude.json` 已确认包含至少这些字段：

- `userID`
- `oauthAccount`
- `projects`

所以即便主目录清掉了，`mmc` 里仍可能保留另一份账号身份和项目映射。

#### mms-backups 归档

已确认存在：

- `/Users/xin/.config/mms-backups`，约 `3.4G`

其中至少有：

- `14` 份归档 `.claude.json`
- `13` 份归档 `.claude/`
- `6` 处归档 `claude-cli-nodejs`
- `5` 处归档 `.local/bin/claude`

还有明确命名为：

- `codex-claude-state-clean-20260415-165344`
- 多个 `config-migrate-20260313-*`
- 多个 `boss2-claude` 镜像目录

如果这层不处理，**“被重新恢复回来”** 或 **“继续被别的 wrapper / tool 读到”** 的风险非常高。

### 4.8 人类可读痕迹：shell history / shell config

这层图片基本没覆盖，但如果用户的目标是“清空所有 Claude 的痕迹”，它非常实际。

已确认命中：

- `/Users/xin/.zsh_history`
- `/Users/xin/.bash_history`
- `/Users/xin/.zshrc`

抽样到的典型内容包括：

- `curl -fsSL https://claude.ai/install.sh | bash`
- `claude`
- `claude mcp add ...`
- `claude mcp list`
- `claude --dangerously-skip-permissions`
- `claude_safe()` 函数
- `claudep()` 包装函数
- 指向 `Anthropic` 可达性的体检逻辑

如果只是重置账号，这层可以不动；如果是“把使用痕迹也抹掉”，这层必须进入方案。

### 4.9 图片文件本身也是痕迹

原始截图目录：

- `/Users/xin/Downloads/未命名文件夹 4`

目录体量约 `2.9M`，包含 11 张和本次分析相关的图片。它们本身就在直接描述 Claude 清理方案，所以如果目标是彻底消痕，这批图也属于最终要处理的对象。

补充说明：本次为了目检生成过一张派生汇总图 `_contact_sheet.jpg`，也位于该目录中。它不是原始用户文件，但属于本轮分析新增产物，后续若追求最小痕迹，也应一起处理。

## 5. 哪些应该清，哪些不要误删

## 5.1 必须清（如果目标是“重置身份 + 断开账号 + 去掉本地记忆”）

- `~/.claude.json`
- `~/.claude/`
- `~/.config/mmc/accounts/default/.claude.json`
- `~/.config/mmc/accounts/default/.claude/`
- Chrome 各 Profile 的 `claude.ai` Cookie + IndexedDB
- `/Users/xin/Library/Application Support/Claude`
- `/Users/xin/Library/Caches/claude-cli-nodejs`
- `/Users/xin/Library/Caches/com.anthropic.claudefordesktop*`
- `/Users/xin/Library/Preferences/com.anthropic.claudefordesktop*.plist`
- `/Users/xin/Library/HTTPStorages/com.anthropic.claudefordesktop`
- `/Users/xin/.config/mms-backups` 里所有包含可恢复 Claude 状态的归档

## 5.2 建议清（如果目标是“看起来像没装过 / 没接过 Claude”）

- `/Applications/Claude.app`
- `/Users/xin/.local/bin/claude`
- `/Users/xin/.local/share/claude`
- `/Users/xin/.local/state/claude`
- `/Users/xin/.cache/claude`
- `/Users/xin/.vscode/extensions/anthropic.claude-code-*`
- `/Users/xin/Library/Application Support/Code/logs/.../Anthropic.claude-code`
- `/Users/xin/Library/Application Support/Zed/external_agents/claude-code-acp`
- `/Users/xin/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json`
- `/Users/xin/Downloads/未命名文件夹 4`

## 5.3 可选清（如果目标是“把使用记录也尽量抹平”）

- `/Users/xin/.zsh_history`
- `/Users/xin/.bash_history`
- `/Users/xin/.zshrc` 里与 `claude` 相关 alias / function / health check
- 当前这个分析工作区里所有关于 Claude 的讨论文档

## 5.4 不要误删 / 不应优先删

下面这些命中大多只是“名字里提到 Claude”，不等于真实的账号或本地身份痕迹：

- `/Users/xin/.cursor/extensions/esbenp.prettier-vscode-*/.claude`
- `/Users/xin/.cursor/extensions/esbenp.prettier-vscode-*/CLAUDE.md`
- `/Users/xin/.vscode/extensions/esbenp.prettier-vscode-*/.claude`
- `/Users/xin/.vscode/extensions/esbenp.prettier-vscode-*/CLAUDE.md`
- 某些第三方 extension / asset 里带 `claude` 的图片、logo、fixture
- 仓库里只是“提到了 Claude”的普通文档

这些东西删了，对“重置 Claude 身份”帮助不大，反而可能误伤别的工具或普通文档。

## 6. 建议的清理分层

为了讨论方便，可以把方案分成 5 层：

### Level A：只重置账号身份

目标：下次启动时更像一台新设备。

核心对象：

- `~/.claude.json`
- `~/.claude/statsig/`
- `~/.config/mmc/accounts/default/.claude.json`

代价：

- 需要重新登录
- 某些本地映射和 onboarding 状态丢失

### Level B：清 CLI 本地记忆

目标：去掉本地历史 / 会话 / telemetry / file-history / project mapping。

核心对象：

- `~/.claude/`
- `~/.config/mmc/accounts/default/.claude/`
- `~/.config/mms-backups` 里可恢复的镜像目录

代价：

- 本地 history、任务记录、文件编辑轨迹全部丢失
- 自定义 `skills/`、`hooks/`、`CLAUDE.md`、`settings.json` 也会一起没掉，必须先备份

### Level C：清 Browser / Desktop app 状态

目标：去掉 Web 登录状态、Desktop app session 和 browser-side 本地状态。

核心对象：

- Chrome Cookies / IndexedDB / blob
- Claude Desktop 的 `Application Support` / `Caches` / `Preferences` / `HTTPStorages`
- 额外 host browser-data（如 `com.openai.atlas`）

代价：

- Web 端和 Desktop 端都要重新登录
- 某些 local state / window state / app cache 会消失

### Level D：清安装与集成面

目标：不只是“没登录”，而是“看起来没装过 Claude 相关工具”。

核心对象：

- `Claude.app`
- `~/.local/share/claude`
- `~/.local/bin/claude`
- VS Code Claude extension
- Zed Claude ACP
- browser extension NativeMessagingHost

代价：

- 后续要重新安装 CLI / Desktop / IDE extension
- 相关 workflow 会中断

### Level E：清人类可读使用痕迹

目标：把命令历史、截图、讨论文档也一起抹掉。

核心对象：

- shell history
- shell config 中的 `claude` 包装逻辑
- 下载目录里的清理截图
- 这次讨论产物文档

代价：

- 会影响你自己的 shell 使用历史和定制工作流
- 一旦误删，回滚不方便

## 7. 真正执行前必须先备份什么

这部分是讨论时最容易被忽略的点。

这次 live scan 下，真正值得先拆出来的不是一个完整 `~/.claude/`，而是**白名单资产**：

- repo-backed `statusline`：`/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh`
- repo-backed hooks：`/Users/xin/auto-skills/CtriXin-repo/agent-im/hooks/*.sh`
- repo-backed hooks：`/Users/xin/auto-skills/CtriXin-repo/mindkeeper/hooks/claude-context-restore-hint.sh`、`/Users/xin/auto-skills/CtriXin-repo/mindkeeper/hooks/token-monitor-hook.sh`
- repo-backed hooks：`/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/hooks/{rtk-rewrite.sh,claude-feishu-webfetch-guard.sh,claude-map-auto-index.sh,read-once-hook.sh,read-once-compact.sh,hive-compact-hook.sh}`
- `MCP` 定义白名单：从 `/Users/xin/.claude.json.backup` 只提取 `mcpServers.hive` 和 `mcpServers.mindkeeper`
- 你自己还想保留的 `.zshrc` 非 Claude 逻辑

不应该整包备份再整包恢复的对象：

- `/Users/xin/.claude.json.backup`
- `/Users/xin/.config/mmc/accounts/default/.claude.json`
- `/Users/xin/.config/mms-backups/...` 下所有旧 `.claude.json`
- 旧 `settings.json` 的 `env` 整段
- 旧 `settings.json` 里所有仍指向 `/Users/xin/.claude/...` 的 path

## 7.1 `hook / skill / MCP / statusline` 到底能不能保住

可以保住一部分，但要分层看：

| 资产 | 当前状态 | 能不能保 | 正确做法 |
| --- | --- | --- | --- |
| `statusline` | 旧配置指向 repo 脚本 `/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh` | 可以 | 在新的 `settings.json` 里手工重建 `statusLine` 段，继续指向 repo 脚本 |
| `agent-im` hooks | 旧配置指向 repo 里的 `session-start.sh` / `session-end.sh` / `notification.sh` / `post-tool-use.sh` / `user-prompt.sh` | 可以 | 只把这些 hook command 重新写回新的 `settings.json` |
| `mindkeeper` hooks | `claude-context-restore-hint.sh`、`token-monitor-hook.sh` 仍能在 repo 中找到 | 可以 | 不要再指向 `/Users/xin/.claude/hooks/...`，改指向 repo 真实路径 |
| `read-once` / `rtk` / `map-auto-index` hooks | 旧 path 已失效，但 repo 中有功能等价脚本 | 可以，但要改 path | 分别改用 `multi-model-switch/hooks/read-once-hook.sh`、`read-once-compact.sh`、`rtk-rewrite.sh`、`claude-map-auto-index.sh` |
| `MCP` | `/Users/xin/.claude.json.backup` 里还能读到 `hive` 和 `mindkeeper` 的 `command/args` | 可以 | 只抽出 `mcpServers` 这一小块，手工回填到新的干净配置 |
| `skills` | live `~/.claude/skills/*` 不在了，但 `/Users/xin/claude_safe_zone/skills/` 下保留了多组实体 skill 目录 | 可以部分 | 只恢复 repo-backed 或 `safe_zone` 中你确认无身份绑定的 skill；不要把整包旧配置一起回填 |

这次审计里已经确认的关键事实：

- `/Users/xin/.config/mmc/accounts/default/.claude/settings.json` 当前是空对象 `{}`，适合作为新的干净配置起点。
- 旧 gateway backup 中的 `settings.json` 明确包含 `statusLine`、`hooks`、`permissions`、`env`。
- 旧 `settings.json` 里的 `env` 带有 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`MMS_ROUTE_STATUS_PATH`，因此**不能整段复制**。
- 旧 `settings.json` 中大量 hook path 仍写成 `/Users/xin/.claude/...`，而这些 path 当前都不存在；如果直接回填，只会恢复出一套坏配置。
- `/Users/xin/.claude.json.backup` 的 `mcpServers` 目前可确认至少有两项：
  - `hive`: `command = /Users/xin/auto-skills/CtriXin-repo/hive/bin/mcp-server.sh`
  - `mindkeeper`: `command = node`, `args = [/Users/xin/auto-skills/CtriXin-repo/mindkeeper/dist/server.js]`

更稳的恢复顺序应该是：

1. 先在新的干净 `settings.json` 里只恢复 `statusLine` 和 repo-backed hooks。
2. 再从 `/Users/xin/.claude.json.backup` 中人工提取 `mcpServers` 的 `hive` / `mindkeeper` 定义。
3. 再把旧的私有 hook path 改写成 repo 真实路径，不要再用 `/Users/xin/.claude/...`。
4. `skills` 只从 repo 或你自己另存的源文件回填，缺失的就按“当前不可恢复”处理。

## 8. 影响范围总表

| 维度 | 清理对象 | 影响 |
| --- | --- | --- |
| 身份重置 | `~/.claude.json` / `mmc` 镜像 `.claude.json` | `userID` / `anonymousId` / `oauthAccount` 断开，需重新登录 |
| 本地记忆 | `~/.claude/` / `mmc` 镜像 `.claude/` | history、telemetry、session、project mapping、file-history 全丢 |
| Desktop app | `Application Support/Claude` + `Caches` + `Preferences` | Desktop 端 session、Cookies、window state、local storage 清空 |
| Browser | Chrome Cookies / IndexedDB / blob | Web 端会退出登录；多 Profile 需要逐个处理 |
| 安装面 | `Claude.app` / CLI / VS Code / Zed | 后续需要重装；当前集成立即失效 |
| 备份链 | `mms-backups` | 如果不清，旧状态可能被恢复或被 wrapper 继续引用 |
| 人类可读痕迹 | shell history / shell config / 图片 / 文档 | 主要影响隐私层面，不一定影响程序行为 |

## 9. 讨论时建议先统一的几个问题

建议多 Agent 先统一这 6 个问题，再决定实际执行脚本：

1. 目标到底是“重置账号身份”，还是“连安装和使用痕迹一起抹掉”。
2. `~/.claude/skills`、`hooks`、`CLAUDE.md`、`settings.json` 要不要先做白名单备份。
3. `mmc` / `mms-backups` 是否允许整体清，还是只提取非 Claude 部分后再删。
4. Browser 范围是否只清 Chrome，还是连 `com.openai.atlas` 这类额外 browser-data 一起处理。
5. VS Code / Zed / Desktop app / CLI 是只清状态，还是顺带卸载安装物。
6. shell history 和本轮分析文档要不要进入最终“消痕”名单。

## 10. 我给多 Agent 的建议立场

我的建议是：**不要一上来直接做 Level D / E；先定义目标，再做两阶段清理。**

更稳的顺序是：

1. 先备份用户真正想保留的 `settings` / `skills` / `hooks` / `CLAUDE.md`。
2. 先做“身份 + 本地记忆 + Browser / Desktop 状态”这一层。
3. 验证是否已经达到“新设备 / 新登录 / 无旧历史”的目标。
4. 只有在仍然要求“连安装和使用痕迹也没了”时，再继续清 `Claude.app`、CLI binary、VS Code / Zed 集成、shell history、截图与文档。

这样 blast radius 最可控，也最便于中途止损。

## 11. 补充：`mmc / mms` 影响与这次搜索到底证明了什么

结论先写在前面：**如果单看更新后的 `mmc` 默认账户路径，这次搜索没有证明出“还存在一个特别大的设计级薄弱项”；但如果看你机器上的整套 `mmc + mms + 历史迁移/备份/归档` 现实落地，这次搜索反而证明了仍有几块高价值残留面，而且多数问题更偏 `mms` 与 retention，而不是 `mmc` 新核心本身。**

### 11.1 为什么我说“更新后的 `mmc` 本体不算差”

本地代码和测试里已经能看到比较明确的收敛动作：

- `multi-model-switch/mmc_core.py` 的 `_bootstrap_account_state()` 默认启动一个干净账户态，不会从旧 `~/.claude` 自动宽导入。
- 同文件的 `_import_legacy_auth_state()` 只导入 `userID`、`oauthAccount`、`claudeAiOauth` 和 `theme`，测试也明确要求 **不导入** `mcpServers` 和旧 `projects`。
- `_build_session_settings()` 只写 repo-owned hooks，不继承用户全局 hooks。
- `_prepare_session_tree()` 只给 session 挂 project-scoped raw 条目，不直接把整个用户 `.claude/` 宽拷进去。
- `_build_process_env()` 会把 `HOME/XDG/TMPDIR/NPM_CONFIG_CACHE/NODE_GYP_DIR` 指到 session 隔离目录，并丢掉不在 allowlist 里的环境变量。
- `docs/MMC_PROXY_ROUTE_RUNBOOK.md` 和 `mmc_proxy_guard.py` 明确是 loopback-only + fail-closed 设计，不允许外部 proxy URL 直接进 CLI surface。

如果你的评价标准是：

- 同账号可 resume
- 不从真实 `~/.claude*` 偷偷继承旧脏状态
- 默认账户目录尽量收敛

那这版 `mmc` 比旧的直连 `Claude` / 旧 `mms` 账号目录方案明显安全得多。

### 11.2 但这次 live scan 也确实证明了：整套 `mmc + mms` 现实安装面还远没到“非常安全”

这里要把“`mmc` 默认账户态”与“整机上的 `mms` 运行/归档/备份面”分开看。

#### A. `mmc` 默认账户态本身

当前 live 命中：

- `/Users/xin/.config/mmc/accounts/default/.claude.json`
- `/Users/xin/.config/mmc/accounts/default/.claude/settings.json`
- `/Users/xin/.config/mmc/projects/*/claude/raw/{sessions,transcripts,history.jsonl,file-history}`

这说明：

- `mmc` 仍然会保留最小必要的 OAuth account state 和 project raw history。
- 这不是“零状态”，只是“比旧 `~/.claude` 面收敛很多的状态”。

所以如果你的目标是“官方 OAuth 隔离 + 可 resume + 不串号”，`mmc` 现在大体是合格的。
如果你的目标是“这台机器上几乎不留 Claude 可恢复态”，那它仍然不合格，因为 project raw 本来就是设计上要保的。

#### B. 真正大的残留面主要在 `mms`

这次 live scan 证明出来的几块高价值面如下：

1. `mms` token cache 仍然非常敏感  
   当前存在 `/Users/xin/.mms/token_cache/*.json`，而且文件里明确还有 `accessToken`、`refreshToken`、`expiresAt`。  
   这不是低价值 metadata，而是实打实的 token cache。

2. `mms` 仍保留 live Claude account 目录  
   当前存在：
   - `/Users/xin/.config/mms/accounts/claude-max-justin/.claude.json`
   - `/Users/xin/.config/mms/accounts/claude-tonnya/.claude.json`
   
   这两个 live account state 都还带 `oauthAccount`、`userID` 等字段。

3. `mms` 还保留 archived Claude account 整体镜像  
   当前存在：
   - `/Users/xin/.config/mms/accounts-archived/expired-oauth-20260411-112809/boss2-claude/.claude`
   - `/Users/xin/.config/mms/accounts-archived/expired-oauth-20260411-112809/boss2-claude/.claude.json`
   - `/Users/xin/.config/mms/accounts-archived/expired-oauth-20260411-112809/boss2-claude/.local/share/claude`
   - `/Users/xin/.config/mms/accounts-archived/expired-oauth-20260411-112809/boss2-claude/Library`

   这已经不是“少量恢复指针”，而是一整套可恢复镜像。

4. `claude-gateway` 根目录现在仍是一块很大的状态面  
   当前存在：
   - `/Users/xin/.config/mms/claude-gateway/.claude/` 完整树
   - `/Users/xin/.config/mms/claude-gateway/.claude.json`
   - `/Users/xin/.config/mms/claude-gateway/.claude/settings.json`

   其中：
   - `.claude.json` 当前仍带 `anonymousId`、`mcpServers`、`toolUsage`、`skillUsage`、`claudeCodeFirstTokenDate` 等字段
   - `settings.json` 当前仍带 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、各类 `ANTHROPIC_DEFAULT_*_MODEL`

   这块即使没有 `oauthAccount`，也仍然是高价值运行态。

5. `mms` backup retention 很重  
   当前 `/Users/xin/.config/mms/backups` 下面命中约 `170` 个备份项。  
   它们不一定都直接是 Claude 身份数据，但 retention 面已经明显偏大。

### 11.3 这次搜索还能证明一个重要细节：`mmc` 和 `mms` 的风险结构不一样

`mmc` 当前更像：

- 一个相对收敛的 OAuth account/session 隔离器
- 明确偏 allowlist
- 可控地保留 project raw 与最小必要账户态

`mms` 当前更像：

- 一个历史更久、功能更多、兼容更多旧路径的运行时总控
- 它为了兼容 gateway、backup、usage、archived accounts、global snapshot 等功能，保留了更多 state surface

所以，如果你问的是：

- “更新后的 `mmc` 默认路径，是不是还像以前那样一堆大坑？”  
  我的判断：**不是。**

- “整台机器上的 `mmc + mms` 现实部署，能不能算已经非常安全？”  
  我的判断：**还不能。**

### 11.4 这次搜索能直接支持的最终判断

我会把判断压缩成这三句：

1. **更新后的 `mmc` 本体，比旧方案明显安全。**
2. **这次搜索没有证明 `mmc default` 还有一个特别大的“设计级”洞。**
3. **但这次搜索明确证明：`mms` 的 token cache、accounts、archived accounts、gateway root、backup retention 仍然构成高价值残留面。**

换句话说，真正要继续盯的是：

- `~/.mms/token_cache`
- `~/.config/mms/accounts/claude-*`
- `~/.config/mms/accounts-archived/*/boss2-claude`
- `~/.config/mms/claude-gateway`
- `~/.config/mms/backups`

而不是先去怀疑新版 `mmc_core.py` 的默认账户路径本身。

### 11.5 如果后面要继续把 `mmc / mms` 做得更稳，优先级最高的不是“再改 session 隔离”，而是 retention 治理

这次搜索给出的优先级其实很清楚：

1. 给 `~/.mms/token_cache` 加 TTL / prune / 明确导出与清理入口。
2. 给 `accounts-archived` 增加清理策略，而不是长期保留整套旧 `Claude` 家目录。
3. 给 `~/.config/mms/backups` 做保留数量或时间上限。
4. 重新审计 `claude-gateway` 根目录哪些是必须常驻，哪些应 session 化或可重建。
5. 明确区分“为了 resume 必须保留”与“只是历史兼容顺手保留下来”的状态。

## 12. 补充：我对 `cc-gateway` 的看法

参考项目：`https://github.com/motiful/cc-gateway`

结论先写在前面：**我认为 `cc-gateway` 的定位很清楚，也比 `mmc / mms` 更直接命中“Anthropic 服务端看到什么”这个问题；但它解决的是“网络出口和指纹规范化”，不是“本机状态面治理”。如果你关心的是 vendor-facing telemetry / fingerprint，它很有价值；如果你关心的是本地磁盘残留，它不能替代这次我们在文档里列的清理工作。**

### 12.1 我觉得它强的地方

从 README 看，它的设计重点非常集中：

- 它把自己定义成一个 `reverse proxy`，目标是把 device identity、environment fingerprint、process metrics 统一改写成 `canonical profile`。
- README 明写会改写或移除：
  - `device_id`
  - `email`
  - 整个 `env` 对象
  - `User-Agent`
  - `x-anthropic-billing-header`
  - prompt 里的 `<env>` / `Platform` / `Shell` / `OS Version` / working directory
- 它强调所有机器都应该走 gateway，包括 admin 机器自己，否则 vendor 仍会看到第二套直连 fingerprint。

这一点和 `mmc / mms` 很不一样：

- `mmc / mms` 更强在 **本地 CLI runtime 隔离**
- `cc-gateway` 更强在 **Anthropic 服务器视角下的身份规范化**

如果你真正担心的是“服务端会不会把几台机器识别成不同设备”，`cc-gateway` 这条路比只做本地目录隔离更直接。

### 12.2 我觉得它的边界也很明确

它不是全能解法，README 自己已经把几个风险点说得很直白：

- 项目状态是 `Alpha`，作者建议先用 non-primary account。
- 它依赖一台已经登录过 Claude 的 admin 机器，并从 macOS `Keychain` 提取 `access token + refresh token`。
- 它会把 OAuth refresh 完全集中到 gateway 侧。
- README 明说官方 `MCP` 域名 `mcp-proxy.anthropic.com` 是 hardcoded，不跟 `ANTHROPIC_BASE_URL` 走；如果客户端还用官方 MCP，这部分请求会 bypass gateway。
- README 也明确提醒：Claude Code 后续更新可能新增新的 telemetry field / endpoint，需要持续观察。

所以它的 tradeoff 是：

- **优点**：客户端机器可以很干净，指纹统一，入口简单。
- **代价**：gateway/admin 主机会变成高价值 secrets 聚集点。

### 12.3 它和你现在这套 `mmc / mms` 的关系，不是“二选一”，而更像“不同层”

我更倾向于这样理解：

- `mmc / mms` 解决的是：本地 session 隔离、账号切换、resume、project raw、runtime guard。
- `cc-gateway` 解决的是：出口统一、设备指纹规范化、header/prompt/telemetry 改写。

所以它们不是完全替代关系。

如果你的目标是：

- “本机不串号、session 尽量隔离、工具链还能继续用”  
  `mmc / mms` 更贴近。

- “Anthropic 最终只看到一套规范化身份，不想让多台机器暴露多套 device fingerprint”  
  `cc-gateway` 更贴近。

### 12.4 我的实际判断

我会把判断压成下面四句：

1. **`cc-gateway` 的设计目标是对的，而且打得比 `mmc / mms` 更靠近 vendor-facing telemetry 面。**
2. **它很适合做“统一对外身份层”，不适合被误解成“本机状态已经不用管了”。**
3. **它会显著降低 client 机器侧的暴露面，但会把风险集中到 admin/gateway 机器。**
4. **如果你后面真考虑上它，我只会在“单独隔离的 gateway 机器 + 非主账号 + 明确屏蔽官方 MCP bypass”这三个条件都满足时认真试。**

### 12.5 对你当前问题的直接回答

如果只问“这个项目我怎么看”：

- 我认为它**值得参考**，尤其是它对 `canonical profile`、`billing header`、prompt `<env>`、`User-Agent`、telemetry 出口的处理思路。
- 但我不会把它当成你当前这台机器的“清理已经完成”的证据。
- 就你这次的目标而言，它更像后续的**网络侧统一出口方案**，而不是这次本地 `Claude` 痕迹治理的终点。

## 13. 补充：`/Users/xin/claude_safe_zone` 证明了什么，还缺什么

这轮补充检查的直接结论是：**我之前按“当前调用但文件已缺失”处理的那批资产里，有一部分其实没有消失，而是被移动到了 `/Users/xin/claude_safe_zone`；但 `safe_zone` 只能证明“脚本本体还在”，不能证明“当前配置已经可直接工作”。**

### 13.1 已经在 `safe_zone` 找回的资产

当前已确认存在：

- `/Users/xin/claude_safe_zone/settings.json`
- `/Users/xin/claude_safe_zone/raw_settings.json`
- `/Users/xin/claude_safe_zone/settings.json.bak`
- `/Users/xin/claude_safe_zone/settings.json.bak-20260407-211929`
- `/Users/xin/claude_safe_zone/hooks/claude-context-restore-hint.sh`
- `/Users/xin/claude_safe_zone/hooks/map-auto-index.sh`
- `/Users/xin/claude_safe_zone/hooks/token-monitor-hook.sh`
- `/Users/xin/claude_safe_zone/hooks/rtk-rewrite.sh`
- `/Users/xin/claude_safe_zone/statusline-command.sh`
- `/Users/xin/claude_safe_zone/statusline-multi.sh`
- `/Users/xin/claude_safe_zone/statusline-test.sh`
- `/Users/xin/claude_safe_zone/skills/*` 下多组实体 skill 目录，例如 `agentbus`、`diagramming`、`docx`、`map`、`pilot`、`scmp-ops`、`webapp-testing`、`xlsx`

这说明两件事：

1. 之前那几个 `hook` 脚本本体并没有真的丢，只是已经不在旧的 `~/.claude/hooks/...` 路径。
2. `skills` 也不应该再被笼统判断成“只剩断掉的 symlink 线索”，因为 `safe_zone` 里现在确实有一批实体目录。

### 13.2 `safe_zone` 里 `settings.json` 实际暴露出来的现状

`/Users/xin/claude_safe_zone/settings.json` 和 `raw_settings.json` 当前都显示：

- `statusLine.command` 指向的是 repo 路径  
  `/bin/bash /Users/xin/auto-skills/CtriXin-repo/multi-model-switch/statusline-command.sh`
- `SessionStart` 里引用了旧 `~/.claude/hooks/...` 路径：
  - `claude-context-restore-hint.sh`
  - `map-auto-index.sh`
- `UserPromptSubmit` 里引用了旧 `~/.claude/hooks/token-monitor-hook.sh`
- `PreToolUse` 里引用了旧 `~/.claude/hooks/rtk-rewrite.sh`
- `PostCompact` 里引用了旧 `~/.claude/read-once/compact.sh`
- `PreToolUse` 的 `Read` matcher 里引用了旧 `~/.claude/read-once/hook.sh`

所以，`safe_zone` 这次真正纠正的是：

- `statusline` 本身不是缺失项，它一直有 repo 路径，也在 `safe_zone` 里保留了副本。
- `claude-context-restore-hint.sh`、`map-auto-index.sh`、`token-monitor-hook.sh`、`rtk-rewrite.sh` 属于“脚本已找回，但当前配置仍指向旧失效路径”。
- 真正还没被 `safe_zone` 补回来的，主要是 `read-once` 这两个脚本。

### 13.3 这次检查后，仍然没在 `safe_zone` 找到的缺口

当前仍未命中：

- `compact.sh`
- `hook.sh`
- `RTK.md`
- `.mcp.json`
- 顶层通用 `CLAUDE.md`

这里要特别区分：

- `skills/diagramming/CLAUDE.md` 在 `safe_zone` 里是存在的；
- 但它只是该 skill 自己的项目文档，**不是**原先顶层通用 `~/.claude/CLAUDE.md` 的等价替身。

### 13.4 对恢复策略的实际影响

这轮 `safe_zone` 检查把判断收窄成下面四句：

1. **有些你以为“已经没了”的 hook/statusline/skill 资产，其实只是被搬到了 `safe_zone`。**
2. **`safe_zone` 证明的是“可提取资产还在”，不是“旧配置可以原样恢复”。**
3. **当前最明显的真正缺口，不是 `statusline`，而是 `read-once` 的 `compact.sh` 和 `hook.sh`，再加上顶层 `RTK.md`、`.mcp.json`、通用 `CLAUDE.md`。**
4. **所以后面如果要恢复，正确动作仍然是白名单抽取 + 改路径，不是把 `safe_zone/settings.json` 整包覆盖回去。**
