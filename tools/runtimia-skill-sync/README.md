# Runtimia skill 与 Agent 配置同步

Runtimia 保存独立的技能副本。这个工具将当前 Stride 和专业能力同步到它的数据库，并提供一次可审阅、可备份的 Agent 配置迁移；不启动任务、模型或发布。

## 持续技能同步

```bash
python3 tools/runtimia-skill-sync/sync.py --json          # 默认只检查
python3 tools/runtimia-skill-sync/sync.py --apply         # 同步声明的能力
python3 tools/runtimia-skill-sync/sync.py --only scmp-ops  # 定向检查
```

`sources.json` 只同步 9 项：Stride、SCMP、frontend-baseline、Figma atomic intake / pixel QA、ego-browser，以及按需 auditor / issue-recorder / xmem。它保留前端和设计解析能力，不把全清单变成串行前置阶段。`issue-recorder` 使用本工具的薄入口，历史正文仍保留在原仓和数据库备份中。

- 创建缺少的声明技能；同步正文、列表 description 和实际 references。更新 description 避免列表仍宣传旧 xmem/receipt gate。
- 路径型来源读 canonical SKILL.md。文件型来源可相对本工具目录；`bodies/` 是受跟踪来源。
- 源脏或落后 upstream 时跳过该技能；每仓 fetch 一次，不 pull、不改 checkout。`--no-fetch` 适合离线检查，不能证明 upstream 最新。
- 每次更新现有技能前回读并比较检查时内容，将原正文、附件和描述保存到 `~/.local/state/runtimia-skill-sync/skill-backups/` 的 `0600` 文件；写后回读正文、description 和受影响 reference hashes。
- 缺少技能先重新查询，服务端唯一名称约束防止普通并发创建重复。任何同步失败均明确报出，不启动角色兜底。
- 多出的 references 只报告、不删除。当前正文不引用退役流程；旧角色技能随后从默认 Agent 关联中移除，历史 DB 和附件不删除。
- 脚本根注入 canonical 绝对路径。技能物化目录由 runtime 决定，pi 是 `.pi/skills/<name>/SKILL.md`；不能写死 `skills/`，也不能假定脚本跟着正文下发。

### 定时入口

`com.ctrixin.runtimia-skill-sync.plist` / `run.sh` 每 30 分钟与登录执行 `--apply`。脚本更新后下一次直接使用新名单，无需重建定时任务。它只同步技能，不定时覆盖 Agent instructions，不 dispatch issue。

现有 `bodies/workflow-runner.md`、`state-core.md`、`executor-discipline.md` 是历史来源，已不在默认同步名单。`retired_skills` 也包含 outpact、mommy、work、work-gate、work-done、qa 与旧 executor SOP。

## Agent profile 迁移

先同步技能，再生成计划。`--owner-id` 必填，支持重复 `--agent-id` 明确限定已有 Agents；不创建替代 Agent，不碰 builtin runtime skills、其他 owner 或业务 issues。

```bash
python3 tools/runtimia-skill-sync/profile_migrate.py \
  --plan /private/path/stride-profile-plan.json --owner-id OWNER_ID
python3 tools/runtimia-skill-sync/profile_migrate.py \
  --apply /private/path/stride-profile-plan.json
```

计划保存每个 Agent 的 ID、目标字段、现有 `updated_at`、技能关联与保护字段快照、内容 hash。默认承接位 `workflow-agent` 原 ID 改名 `stride-agent`，其余模型 Agent 名字不变；共同 instructions 来自 `bodies/stride-agent.md`。保留自定义非退役技能，增加当前声明能力。多余旧角色只解除关联，不删除技能或历史任务。

**保护范围：** `model`、runtime、custom args、effort、MMS/env、permission、并发数与 builtin `disabled_runtime_skills` 不写。`planned_custom_args` 仅用于保存和比较；guard 的独立启用由维护者另行处理。工具不读 custom env，也不原样转发可能含 secret 的 API payload。备份里保留的 runtime_config/custom_args 可能仍有敏感参数，文件为 `0600`，只放私有路径，不提交公开仓。

**并发与恢复：** API 没有原子的 If-Match/CAS 或跨 Agent 事务。本工具在所有写入前比较全部计划快照；每个 Agent 及其技能关联写入前再次比较，并逐步回读保护字段。发现变更立即停止，已经完成的 Agent 不自动回滚，以免覆盖他人更新。备份和逐 Agent journal 在 `~/.local/state/runtimia-skill-sync/profile-backups/<timestamp>/`。重新回读当前状态后生成新计划，可无副作用地接续；再次执行已完成迁移不会写相同值。需要回滚时只从备份恢复本工具改动字段，并先比较实际状态，不把整个 Agent JSON 写回。

**生效范围：** 更新 DB 影响后续运行；正在执行的任务不会自动刷新已加载 prompt，也不会因本工具被打断或重派。已有旧 issue 正文中的 `plan-only`、授权与来源仍需按事实解释，不能把改 profile 当作扩大发布权限。Runtimia issue 用 `stride carrier attach --issue ISSUE_ID` 对应原 Stride task，续接读 `next` / `packet`。

## 验证

```bash
python3 -m unittest discover -s tools/runtimia-skill-sync/tests -v
```

测试使用合成 API：验证 owner 范围、旧 ID 保留、模型/runtime/权限未写、默认技能替换但历史未删、版本漂移停止、private backup、重复执行不写、缺失技能和 description 更新，以及源/远端变更时拒绝覆盖。不会调用真实 API、模型、浏览器或发布。
