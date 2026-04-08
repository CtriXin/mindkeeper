# 12-agent-official-attach-live-broker

- 时间：2026-04-08T234630+0800
- 任务：把 `official:attach` 从本地 broker 体验推进到 live broker 配置联调

## 一句话结论

`official:attach` 已经能在 live-configured broker 上跑到 **official child connected + initialized + result returned**，当前真实状态是 `protocol_ok_model_error`，最小 blocker 是 live profile 仍在同步旧的 remote official auth source（当前命中 disabled org）。

## 本次最小修复

1. `stubServer.mjs`
   - 当 runtime registry 为空且已配置 `remoteServiceBaseUrl` 时，自动 seed 一个默认 runtime。
   - 这样 fresh worktree 不再因为空 runtime pool 直接 `runtime_binding_failed`。
2. `attachOfficialSession.mjs`
   - `official:attach` 现在会尝试 `syncRemoteAuthBundle()`，本地未登录时也能复用服务器侧 official `claude.ai` OAuth bundle。
3. `remoteAuthSync.mjs`
   - remote auth cache 现在额外绑定 `container_name`，避免从 `claude-code-official-3` 切到 `claude-code-official` 时误复用旧缓存。
4. `.env.example`
   - 追加了 live `official:attach` 所需环境变量示例。

## 实际联调拓扑

- live-configured broker 地址：`http://127.0.0.1:8897`
- remote service：`http://23.95.30.199:28082`
- runtime_id：`cc-static-1`
- 真实 remote auth sync target（本次失败样本）：`root@23.95.30.199` + `claude-code-official-3`

> 说明：这次联调用的是“本地 broker + 真实 server runtime pool”组合；broker 本身仍跑在本机，但其 runtime 与 auth truth 已指向 live server。

## 实际命令

### 终端 1：起 live-configured broker

```bash
env \
  CC_BROKER_BASE_URL=http://127.0.0.1:8897 \
  CC_BROKER_DEVICE_KEY=<live-device-key> \
  CC_BROKER_REMOTE_SERVICE_BASE_URL=http://23.95.30.199:28082 \
  CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN=<live-bearer-token> \
  CC_BROKER_REMOTE_SERVICE_RUNTIME_ID=cc-static-1 \
  CC_BROKER_REMOTE_CLAUDE_SSH_TARGET=root@23.95.30.199 \
  CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=claude-code-official-3 \
  npm run broker:serve 127.0.0.1 8897
```

### 终端 2：attach

```bash
env \
  CC_BROKER_BASE_URL=http://127.0.0.1:8897 \
  CC_BROKER_DEVICE_KEY=<live-device-key> \
  CC_BROKER_REMOTE_SERVICE_BASE_URL=http://23.95.30.199:28082 \
  CC_BROKER_REMOTE_SERVICE_RUNTIME_ID=cc-static-1 \
  CC_BROKER_REMOTE_CLAUDE_SSH_TARGET=root@23.95.30.199 \
  CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=claude-code-official-3 \
  npm run official:attach -- 'Reply with exactly LIVE_ATTACH_OK and nothing else. Do not use tools.'
```

## 真实结果

- device auth：PASS
- session create：PASS
- official child launch：PASS
- session-ingress connected：PASS
- initialized：PASS
- final result：PASS（有结果返回）
- 最终 status：`protocol_ok_model_error`

关键结果要点：

- `official_child.connected = true`
- `official_child.initialized = true`
- `official_child.auth_header_present = true`
- `remote_auth.ok = true`
- `remote_auth.auth_dir = /Users/xin/.config/cc-official-broker/remote-auth/mac-personal-root-23.95.30.199`
- `last_result.result = API Error: 400 ... This organization has been disabled.`

## 最小 blocker

**blocker 层级：remote auth source / live profile alignment**

不是：

- 不是 local official binary 不存在
- 不是 broker contract 缺字段
- 不是 runtime binding/pool 空配置（本轮已修）
- 不是 session-ingress 协议没通

而是：

- live attach 当前同步到的 remote official auth source 仍是 `claude-code-official-3`
- 该 source 对应的 org 已 disabled
- 所以链路已经通了，但模型回合失败，停在 `protocol_ok_model_error`

## 补充排查

- `ssh root@23.95.30.199 'docker ps --format "{{.Names}}"'` 可见当前在线容器：
  - `claude-code-official`
  - `claude-code-official-2`
  - `claude-code-official-3`
- `remote:doctor` 真实 acceptance 已确认健康 runtime 是 `cc-static-1`
- 因此当前 live profile / credentials 里的 `CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=claude-code-official-3` 已经和 acceptance 主 runtime 不一致，需要后续收口

## 下一步

1. 把 live profile / credentials 的 remote auth sync target 从 `claude-code-official-3` 收口到当前 healthy runtime 对应 auth source。
2. 复跑同一条 `official:attach` 命令，目标状态应升级为 `protocol_and_model_ok`。
