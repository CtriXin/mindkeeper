# Task Model Score

## 评分口径

- 满分 `10`
- 主要看：
  - 代码完成度
  - 首轮命中率
  - review 往返次数
  - 是否偏题 / 漂移
  - 文档与真实落地是否一致
  - 安全边界意识

## 任务评分

| Task | Worker / Trigger | Type | Score | Rounds | 结论 |
|---|---|---|---:|---:|---|
| Task 01 capability extraction | `glm5.1` trigger | manual-analysis | 8.2 | 1 | 分析质量好，但执行方式不符，没按 Hive 落地 |
| C5 runtime lifecycle | `kimi-for-coding` | single-agent | 7.8 | 2 | 结构化实现快，首版有 2 个 blocking issues，修后通过 |
| C3 source IP allowlist | `kimi-for-coding` | single-agent | 7.6 | 2 | 主路径收口快，但首版漏了 WebSocket ingress |
| C1 key management | `mimo` | single-agent | 6.9 | 2 + codex收口 | 产出量大，但安全边界漂移明显，首版管理面裸露、WS auth 顺序错 |
| C4 sticky/runtime binding | `minimax2.7` | single-agent | 5.8 | 1 + codex review | 结构有了，但把 fail-fast 做成了‘只记事件不拦截’，且 create/resume/direct-connect 仍返回成功 |
| C4 sticky/runtime binding revision | `glm5.1` | single-agent | 8.4 | 1 | 精准按 review 修正 fail-fast 语义，改动克制，验证脚本可执行 |
| C6 gateway session_state | `qwen-3.6-plus` | single-agent | 7.7 | 2 | 主功能落得较稳，首版验证和 miss 语义差一点，补修后通过 |
| C7 remote:doctor alignment | `qwen-3.6-plus` | single-agent | 7.4 | 3 | 主方向对，但 verdict 收口和状态文案修了两轮后通过 |
| Task 09 local official CLI -> gateway e2e | `qwen-3.6-plus` | single-agent | 8.0 | 1 | 调研速度快，能明确把 blocker 收口到 local official binary 而不是 gateway / server |
| Task 11 official:attach turnkey | `kimi beta` | single-agent | 8.3 | 1 | 体验入口收口直接，零配置命令与文档同步都比较到位 |

## 模型观察

### `kimi-for-coding`

- 擅长：
  - 快速把能力切片落成可运行代码
  - 文档、handoff、代码三件套能一起产出
  - 接收明确 review 后，二次修正速度快
- 不擅长：
  - 首轮容易漏非 happy path，尤其是 ingress / lifecycle 边角
  - 容易先把 HTTP 做完，但漏 WebSocket / secondary path
  - 安全策略会先给“看起来完整”的版本，边界要我再收紧
- 适合：
  - C3/C5 这类边界比较清楚、可被 review 校正的实现任务

### `mimo`

- 擅长：
  - 一次性铺较大的代码面
  - 模块拆分、文件组织、文档骨架搭得比较快
  - 愿意把 CRUD / doc / config 一起补齐
- 不擅长：
  - 容易任务漂移，做着做着把范围做大
  - 首轮安全意识不够稳，容易出现“功能做通了但管理面太松”的问题
  - 文档会先按理想口径写，和真实边界有时不一致
- 适合：
  - 有明确 reviewer 护栏的大块实现
  - 不适合直接放飞做安全敏感收口

### `glm5.1`

- 擅长：
  - 做 capability inventory、拆层、排优先级
  - 读代码后抽共性、给迁移顺序
  - 纯分析任务质量稳定
- 不擅长：
  - 容易在“执行方式”上不完全按要求
  - 这次没有真正按 Hive 路径落地
- 适合：
  - 前期分析、资产抽取、迁移设计
  - 不适合拿来当“必须严格执行 orchestration 约束”的主执行体


### `minimax2.7`

- 擅长：
  - 能较快把 store + binder + doc 这一整片骨架铺出来
  - 文件拆分清楚，handoff 口径完整
- 不擅长：
  - 容易把语义性要求做成“有事件/有状态但没真正拦截”
  - 文档会先自洽，但和验收语义存在偏差
  - 对 failure path 的真实返回码和上层行为收口不够严
- 适合：
  - 先铺 skeleton / module 切片
  - 不适合独立收最终行为语义，尤其是 fail-fast / safety 边界


### `glm5.1`（implementation revision）

- 擅长：
  - 按 review prompt 定点修复，scope 控制好
  - 代码与文档能一起收口到同一语义
  - 会补可执行验证脚本，便于快速复审
- 不擅长：
  - 当前样本还少，暂时不适合直接放大到大范围架构改造
- 适合：
  - revision / 精修 / 按明确验收条件补洞


### `kimi beta`

- 擅长：
  - 做 CLI 体验层 / 脚本封装时收口很快
  - 会优先把“用户怎么一条命令跑起来”讲清楚
  - 文档、提示文案、入口脚本能一起补齐
- 不擅长：
  - 当前样本主要集中在体验层，复杂安全边界样本还不够
  - 还不适合直接放到 auth / runtime safety 的最终收口位
- 适合：
  - turnkey 入口、CLI 封装、体验优化

### `qwen-3.6-plus`

- 擅长：
  - 不容易跑错仓，主功能实现比较稳
  - 对 fallback / 非 500 这种产品边界有基本感觉
  - 补修时配合度可以，能快速把尾巴收掉
- 不擅长：
  - 首版验证脚本常常不够硬，容易出现“看起来能验、实际不够真”的情况
  - 字段语义偶尔会差半步，需要 reviewer 点一下
- 适合：
  - 中等复杂实现切片
  - 有 reviewer 托底的功能落地

## 当前推荐用法

- 分析 / capability extraction：优先 `glm5.1`
- 中等复杂实现切片：优先 `qwen-3.6-plus` / `kimi-for-coding`
- revision / 精修：优先 `glm5.1`
- 大块代码铺设但需要我强 review：可用 `mimo`
- 安全边界最终收口：继续由 `codex-main` review / integration / fix
