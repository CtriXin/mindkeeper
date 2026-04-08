# Native Gateway Acceptance Spec

## 一句话结论

第一阶段验收标准是：在不依赖 third-party relay、不把本地前端指纹上送服务器、不强制安装重型 local tools 的前提下，让本地 official `Claude Code CLI` 通过自建 gateway 稳定接入服务器 official runtime pool，并以 `device_id/workspace_id/session_id` 完成隔离、sticky 与恢复。

## 现有事实与边界

### `cc-official-broker` 已有能力

- local official CLI 入口与 upstream adapter：
  - `src/official/runOfficialProxy.mjs`
  - `src/official/upstreamProxy.mjs`
- local session 恢复与隔离：
  - `src/session/localSessionRegistry.mjs`
- remote 健康探测与 sticky 验证：
  - `src/remote/doctorRemoteService.mjs`
- 本地 profile / live 入口：
  - `src/mms/installBrokerProfile.mjs`
  - `src/mms/liveBrokerProfile.mjs`

### 准备从 `cc-mcp-bridge` 抽取的能力

- key management
- `allowed_runtime_ids`
- source IP allowlist
- sticky runtime binding
- runtime health / disable / drain
- usage / audit / quota

### 当前明确不做

- 多用户共享 broker
- 把 `MMS`、daemon、hooks、runner 变成默认必装前置
- 把第三方 relay 重新拉回生产主路径
- 让服务器直接获得本机完整文件系统控制权

## 1. Happy Path

1. 用户在本机启动 official `Claude Code CLI`。
2. local CLI 只持有 gateway 所需的 `base_url + token`，或通过本地 bootstrap 先换取 broker token。
3. gateway 根据 `owner_user_id/device_id/workspace_id/session_id` 形成 routing key。
4. gateway 选择一个 enabled 的 server official runtime，并保持同一会话 sticky。
5. server official runtime 用服务器侧 first-party `claude.ai` auth 与固定 egress 向 Anthropic 发起真实请求。
6. local 文件读写 / bash 优先继续由 official CLI 自身在本机执行；gateway 默认不接管这些本地能力。

### Happy Path 验收项

- 同一组 `device_id/workspace_id/session_id` 连续两次对话，返回同一个 `remote_session_id`。
- 本地 official CLI 无需感知 runtime pool 细节。
- 用户侧不需要安装 `MMS` 才能走主链。
- 服务器侧仍是唯一 `OAuth/runtime/egress` 真相源。

## 2. Auth Path

### 目标

- 本地只解决 gateway 接入鉴权。
- 服务器独占上游 official auth。

### 约束

1. `device_key` 只用于 broker bootstrap / `POST /auth/device` 一类本地接入动作。
2. `device_key` 不上传到 server runtime service，不参与上游 Anthropic 鉴权。
3. gateway -> server 只传服务端认可的 broker/runtime 凭证与最小 routing metadata。
4. official `OAuth` bundle 只存在于服务器 runtime 容器或其受控目录。
5. 本地不持有服务器 official `OAuth` 真值，不把 `userid/sessionid/front-end fingerprint` 当作必传字段。

### Auth Path 验收项

- 吊销本地 gateway key 后，本地不能继续进入 gateway。
- 替换 server runtime 的 official auth 时，不要求改本地 CLI 配置结构。
- 任一本地设备泄露 `device_key`，影响范围只限 broker 接入面，不直接暴露 official upstream auth。

## 3. Sticky / Session Path

### 隔离主键

- server routing 主键：`owner_user_id + device_id + workspace_id + session_id`
- local 恢复辅助维度：`project_root`

### 约束

1. 同一组主键在 runtime healthy 时必须命中同一 `remote_session_id`。
2. `mac` 与 `macmini` 不能共用会话。
3. `company` 与 `personal` 不能共用会话。
4. key 只负责 auth / usage / audit，不负责定义 sticky 主键。
5. `src/session/localSessionRegistry.mjs` 负责在本地保存 `proxy_session_id`、`remote_session_id` 与 resume 所需最小映射。

### Sticky / Session 验收项

- `npm run remote:doctor` 能验证两次 prompt sticky 成功。
- `GET /v1/session_state` 能看到与当前 routing key 对应的 `remote_session_id`。
- 重新启动 local CLI 后，能基于本地 registry 恢复到最近一次有效会话。

## 4. Failure / Recovery Path

### 目标

- 失败时可观测、可恢复、不过度扩散 blast radius。

### 约束

1. gateway 必须区分 auth failure、runtime unavailable、sticky miss、network timeout。
2. runtime 被 `disable` 或 `drain` 后：
   - 新会话不能再分配进去；
   - 已绑定会话按策略继续完成或切到新的 healthy runtime；
   - 不能跨 `device/workspace` 静默串味。
3. local 超时与重试只做有限次数，不做无限重放。
4. `src/remote/doctorRemoteService.mjs` 作为最小诊断面，必须继续可用。

### Failure / Recovery 验收项

- 当 runtime 不健康时，用户能收到明确失败类型，而不是模糊空报错。
- 当 sticky 失效时，日志里能看到 `remote_session_id` 变化。
- 当 local CLI 重启时，可通过 local registry 执行 resume，而不是强制丢上下文重开。

## 5. Local Tools Minimal Policy

### 原则

- 默认先复用 official CLI 自身的 local file / bash / approval 能力。
- 不把自定义 local runner、MCP bridge、daemon、hooks 当第一阶段必需依赖。
- 只有当 server-driven callback 真有硬需求时，才允许补一个极薄 local bridge。

### 第一阶段验收口径

- 没有额外 local bridge 时，主链仍可完成正常对话。
- optional local bridge 缺席时，系统应降级而不是崩溃。
- 第一阶段不承诺 server 主动远控本机写文件。

## 6. Telemetry / Privacy Boundary

### 服务器必须是唯一真相源

- official auth
- runtime state
- egress IP
- usage / audit / quota

### 本地到服务器只允许的最小信息

- broker auth 所需字段
- `owner_user_id/device_id/workspace_id/session_id`
- 协议运行所需最小 request metadata

### 明确不上传

- 本地前端 `userid/sessionid` 杂项指纹
- 本地完整 transcript 镜像
- 本地 official auth bundle

### Telemetry / Privacy 验收项

- `src/official/runOfficialProxy.mjs` 继续保持隔离 `CLAUDE_CONFIG_DIR` 与最小环境清洗。
- 额外非必要 telemetry 默认关闭或最小化。
- server audit 能满足运维与配额，但不要求回传本地隐私上下文。

## 7. Acceptance Checklist

- [ ] local official CLI 仅通过 gateway 地址与 gateway key 即可发起稳定会话
- [ ] server official runtime 继续作为唯一上游 official auth 承载点
- [ ] `device_id/workspace_id/session_id` 隔离成立
- [ ] sticky 成立，连续两次请求复用同一个 `remote_session_id`
- [ ] `remote:doctor` 可验证 base URL、API key、sticky、`session_state`
- [ ] key management、source IP allowlist、runtime disable/drain 有明确落点
- [ ] local tools 默认不依赖额外 runner / daemon / hooks
- [ ] 本地前端指纹不被当作服务器真相字段
- [ ] 不重新引入 third-party relay 作为生产主路径
- [ ] 审计、配额、runtime 生命周期都落到服务器 control plane

## 8. Out Of Scope

- 多租户 / 多用户共享
- 面向外部用户的公共 relay service
- 完整 server-driven local tool bridge
- 把 `multi-model-switch` 变成强依赖
- 直接复制官方源码形成 fork 式实现
- 把 `cc-mcp-bridge` 整仓迁移为主入口

## 仍未完全定义的验收点

1. gateway token 的刷新/过期协议
2. runtime `drain -> rebind` 的精确行为
3. optional local bridge 若落地，其 permission contract 与 approval UI 形状

## 推荐先实现的 3 项

1. C3: source IP allowlist
2. C5: runtime pool lifecycle (`disable/drain/health`)
3. C1: key management
