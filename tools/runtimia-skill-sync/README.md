# runtimia-skill-sync

把 canonical 技能源同步到 runtimia workspace 的技能正文与 `references/`。

## 为什么存在

runtimia 把技能正文存在**自己的数据库**里，跟 canonical 仓之间**没有任何链接**。
canonical 仓合一个 PR，runtimia 这边就静默变旧——agent 照跑、skill 照读，只是读的是旧版，
没有任何报错、没有任何信号。

2026-09-04 到 09-05 一天之内撞了三次同一类问题：

| 现象 | 代价 |
|---|---|
| `scmp-ops` 停在 2026-06-16 的副本（51,030 → 72,324 字） | 3 个月没人发现 |
| `state-core` 技能正文里的 CLI 路径指向滞后 checkout | 缺 `record-decision`，两次实验跑在不同版本上 |
| 别人合了 PR #68，1 小时内又漂（74,418 → 76,516 字） | 靠人恰好想起来去查才发现 |

**手动同步不是解法，是症状。** 这个脚本是解法。

首次跑 `--check` 就翻出 **9 个技能在漂**，其中包括：
- `qa` 在 canonical 里已经标了「[已退役 2026-08-13·U1 定调] 默认不再触发」，runtimia 里还是旧的「活跃」描述
- `frontend-baseline` 的广告位顺序闸在 canonical 已改成「触发只看 grounded 输入，不看任务文本」，runtimia 跑的是更松的旧版
- `outpact` 缺整段 `Intake phase firewall`

## 用法

```bash
python3 tools/runtimia-skill-sync/sync.py               # 只检查，有漂移退出码 1
python3 tools/runtimia-skill-sync/sync.py --apply       # 检查并推平
python3 tools/runtimia-skill-sync/sync.py --only scmp-ops --only mommy
python3 tools/runtimia-skill-sync/sync.py --json        # 机器可读
```

### 定时任务（已安装）

`com.ctrixin.runtimia-skill-sync.plist` —— launchd，每 30 分钟 + 每次登录各跑一次 `--apply`。
日志 `~/.local/state/runtimia-skill-sync/sync.log`（超过 2MB 自动截到后 1000 行）。

```bash
# 装（已于 2026-09-05 22:19 +08 装好并实跑验证：runs=1, exit 0）
cp tools/runtimia-skill-sync/com.ctrixin.runtimia-skill-sync.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ctrixin.runtimia-skill-sync.plist

# 立刻跑一次 / 看状态 / 卸
launchctl kickstart -p gui/$(id -u)/com.ctrixin.runtimia-skill-sync
launchctl print gui/$(id -u)/com.ctrixin.runtimia-skill-sync | grep -E 'runs|last exit'
launchctl bootout gui/$(id -u)/com.ctrixin.runtimia-skill-sync
```

**改了 `sync.py` 或 `sources.json` 不用重装**，plist 只指向 `run.sh`。
只有挪动仓库路径才需要改 plist 并重新 bootstrap。

## 它替你记住的三件事

1. **脚本根说明。** runtimia 只铺 `SKILL.md` + 上传的 skill files，**不铺 `scripts/` / `schemas/`**。
   带脚本的技能（源目录里有 `scripts/` 或 `schemas/`）会自动在 frontmatter 之后插入脚本根说明，
   把所有 `scripts/…` 相对路径重定向回 canonical 目录。不插的话每条闸门命令都会 `no such file`，
   闸就静默降级成「让 agent 自己检查一下」——而被告知要检查的 agent 不是闸。

2. **隐藏标记。** `disable-model-invocation: true` 是 runtimia 侧独有的：进程技能
   （`mommy` / `outpact` / `work-*` / `workflow-runner`）不进模型可见的技能清单，
   只有 issue 正文点名时才加载。canonical 仓**没有**这一行，所以照搬 canonical 会把隐藏撞掉。
   `sources.json` 里标 `"hidden": true` 的技能会自动补回。
   （这条是首跑 check 时靠 `mommy` / `work-done` 那个 **-31 字的负增长**发现的——
   如果只看「canonical 更长就是更新」，这个 bug 会被直接推上去。）

3. **不该动的东西。** 见下。

## 刻意的安全边界

- **canonical 工作区脏就跳过不推。** 半写完的技能推上去比旧技能更危险。
  盯的是 `SKILL.md` 和 `references/`（`kind=file` 盯那个文件本身，未跟踪也算脏）。
- **checkout 落后 upstream 也跳过不推。** 只挡「脏」不够：checkout 停在 main 但落后于
  `origin/main` 时，工作区完全干净，推上去却是一次**内容倒退**，而且全程零报错。
  2026-09-05 真撞到——`issue-recorder` 的 checkout 落后 6 个提交，正文比 runtimia 里那份
  少 5,462 字。只看「上游有没有动过 `SKILL.md` / `references/` 的提交」，仓里别的领域有
  新提交不拦。
- **runtimia 里多出来的 reference 文件只报告，不自动删。** 删除不可恢复，
  按全局规则要 owner 针对这一次的明确授权。
- **读之前一定 fetch。** 不 fetch 的 ahead/behind 是上一次 fetch 的快照——一个自信但过期的
  答案，正是最难事后归因的那类事故（这条闸是 `scmp-ops` 里 Latest branch gate 的同一条道理）。
  只 `fetch --prune`，不 pull、不改工作区。离线时用 `--no-fetch`，此时「落后」只能信它说落后。
- **只碰 `sources.json` 里列出的技能。** 没列的一个都不动。

## 源的两种形态

- `kind: "dir"` —— 源目录里的 `SKILL.md` 是正文，`references/` 是附件。
- `kind: "file"` —— 那个文件就是正文全文。这类技能是本地写的、没有独立仓，
  `bodies/` 就是它们的 git 家（`workflow-runner` / `executor-discipline` / `state-core`）。
  在此之前它们只活在 runtimia 的数据库里，删库即失传。

## 故意没列进 sources.json 的

| 技能 | 原因 |
|---|---|
| `work` | 源歧义：`shared-skills/work` 与 CtriXin-repo 下几处都像候选，且 runtimia 里那份只有 769 字（已被换成指路桩）。定不了权威源就不该自动推。 |
| `oii-executor-sop` | 2026-09-03 owner 决定退掉，不再维护。 |

## reference 文件怎么比的

`multica skill files list` 直接返回每个文件的 `content_hash`（= 文件原始字节的 sha256）
和 `size`，所以比对**不需要**下载文件正文。已验证与本地 `shasum -a 256` 逐字节一致。
只有正文（`SKILL.md`）没有暴露 hash，必须 `--with-content` 拉一次。
