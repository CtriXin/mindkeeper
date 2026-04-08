# 14-mms-profile-live-env-alignment

- 时间：2026-04-09T004445+0800
- 任务：把当前已验证成功的 live auth source / official_proxy 配置收口进 MMS profile 生成能力

## 一句话结论

`MMS` 现在已经能稳定承担“export 正确 env + 启动本地 Claude Code”这一层：profile 生成/安装会同时带上 remote auth sync 所需的 SSH target、空 container、credentials path、global config path 这些 env 钩子。

## 本次改动

### 代码

- `src/mms/installBrokerProfile.mjs`
  - profile 现在会生成：
    - `remote_claude_ssh_target_env`
    - `remote_claude_container_name_env`
    - `remote_claude_credentials_path_env`
    - `remote_claude_global_config_path_env`
  - `mms:profile:print` 的 `env_examples` 也会直接给出当前 live 主线所需 env 模板
- `src/mms/brokerProfile.mjs`
  - sample broker profile 同步加入上面 4 个 remote auth env 字段
  - notes 明确：healthy runtime 可以通过 host-path auth source 而不是 docker exec

### 代码补修

- `src/mms/liveBrokerProfile.mjs`
  - live profile resolver 现在也会保留显式空 `container_name`，不会因为 fallback 把旧 container 名带回来
  - 这让 `CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=''` 真正等价于“显式走 host-path auth source”

### 文档

- `README.md`
  - 补了 MMS profile 当前 live 成功组合：`cc-static-1` + `claude-home-1`
- `docs/MMS_BROKER_INTEGRATION_BRIEF.md`
  - broker profile 示例现已包含 remote auth env 字段
- `HANDBOOK.md`
  - 旧的 `claude-code-official-3 / cc-static-3` 叙述已收口到当前真实状态

## 最小验证

```bash
cd /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
node --check src/mms/installBrokerProfile.mjs
node --check src/mms/brokerProfile.mjs
node --check src/mms/liveBrokerProfile.mjs
```

```bash
env \
  CC_BROKER_BASE_URL=http://127.0.0.1:8897 \
  CC_BROKER_DEVICE_KEY=dummy \
  CC_BROKER_REMOTE_SERVICE_BASE_URL=http://23.95.30.199:28082 \
  CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN=dummy \
  CC_BROKER_REMOTE_SERVICE_RUNTIME_ID=cc-static-1 \
  CC_BROKER_REMOTE_CLAUDE_SSH_TARGET=root@23.95.30.199 \
  CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME='' \
  CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json \
  CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.claude.json \
  node --env-file=.env src/index.mjs mms:profile:print official-broker-personal http://127.0.0.1:8897
```

结果要点：

- profile TOML 已包含 remote auth env hooks
- live profile resolver 对显式空 `container_name` 的 override 验证已通过
- `env_examples` 已直接给出 live 所需 6 个关键 env
- `run_steps` 已明确 `MMS -> official_proxy -> remote official runtime` 这条主线

## 现在的判断

- `MMS` 不需要再当大脑
- `MMS` 现在就是 launcher / profile manager / env exporter
- 本地真正执行仍是 official `Claude Code`
- 远端真相仍是 `gateway/broker + runtime pool`
