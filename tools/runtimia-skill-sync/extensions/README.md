# Stride 的 Runtimia pi 文件写入边界

`stride-writable-root.mjs` 替代历史 `oii-writable-root.mjs`。文件写入隔离保留，
任务可以访问主 Stride 工作台中的原 task，不另外创建每个 run 的任务库。

## 绑定与接续

1. extension 启动时，读取 daemon 生成的 `.agent_context/issue_context.md` 的
   `**Issue ID:** UUID` 字段，以及 `MULTICA_WORKSPACE_ID`、`MULTICA_TASK_ID`。
2. 通过受信任的 `~/stride/bin/stride carrier attach` 读取 issue、关联同一个 central
   Stride task。创建 draft/保存来源，不启动 attempt、模型或生产操作。
3. 每次 `write` / `edit` / `bash` 前，受信任的 `carrier inspect` 回读同一个 issue，
   检查 task identity 没有变化，取得当前已绑定组件的真实 Git common directories。
   后续在 Controller 正常绑定新组件后，下一次工具操作即可访问新组件。
4. 固定绑定读取后，模型修改 issue_context、shell inline env 或 task 内文件不会改变
   当前进程的 issue、workspace 或 store。没有可由模型编辑的 allowlist。

## 允许写入的范围

- 本次 Runtimia workdir；本 Stride task 的整个 `tasks/<id>` 根。
- central store 的精确 `stride.db`、`stride.db-wal`、`stride.db-shm`、`stride.db-journal`。
  不放行整个 `~/.local/share/stride` 或其他 task 的目录。
- `carrier inspect` 从已绑定组件验证返回的 Git common directories，使当前工作树能够
  正常 commit。原业务 checkout 的源文件不因 Git metadata 放行而获准写入。
- `TMPDIR`、`XDG_CACHE_HOME`、npm cache、Python pycache 和 `STRIDE_REQUESTS_DIR`
  指向本次 workdir 内的 `.multica/stride-runtime/`。

`write` / `edit` 检查 realpath，包括 existing/dangling symlink 与 symlink loop。
`bash` 使用 macOS `sandbox-exec`，policy 通过 `-p` 从内存传入，避免模型改写旧 `.sb`
文件后扩大权限。shell 使用继承的 PATH 与 `zsh -f -c`，不重新触发 login 配置链。

Lark 的账号目录、MMS 配置、SSH key 等不增加写入权限。现有 Lark 20064 过期需要
用户恢复认证；文件隔离调整不等于恢复登录。日常工具若确实需要额外缓存，先给出具体
目录和失败操作，再决定 task-local 重定向或最小适配，不能泛开 HOME。

## 失败与能力边界

没有 issue identity 的 chat/quick-create 等 run 保留原来的 cwd-only write/edit/bash 与 read，
不调用 carrier、不创建独立 Stride store，并说明 carrier 不适用。

有明确 issue identity 但 carrier attach 失败时只报告一次实际错误，read 类工具仍可用；write/edit/bash 会返回
明确阻塞原因。修好来源/连接后重新加载 extension，不自动切换 owner 凭据或创建另一条任务。
attach 上限45秒，纯本地 inspect 上限10秒。没有自动 retry 循环或隐式派发。

这层防止普通模型误写其他文件，**不是恶意进程的安全沙箱**：
central SQLite 和 Controller 是同一用户的共享运行状态，不能据此宣称禁止模型故意
通过 SQL/Controller API 修改其他 task。网络和读取能力保留；自定义工具也不在这三个
pi 内置工具拦截范围内。发布权限、业务验收与 source 判断继续由当前任务授权和验证负责。

## 验证与启用

```sh
node --test tools/runtimia-skill-sync/extensions/stride-writable-root.test.mjs
```

套件使用合成 task/home/SQLite/Git，真实 macOS sandbox 正反例，以及 fake carrier
的 extension 注册/固定身份/失败行为；不调用模型、真实 Lark 或生产接口。

先落地支持 `stride.carrier.v1` 的 Stride CLI/Controller，再把新 extension 安装到
受信任目录并更新 Runtimia Agent custom_args。**仅合并源码不会改变活跃 Agent。**
进行中的 run 保持原 extension，下一次新 run/明确 reload 才读取新配置。
