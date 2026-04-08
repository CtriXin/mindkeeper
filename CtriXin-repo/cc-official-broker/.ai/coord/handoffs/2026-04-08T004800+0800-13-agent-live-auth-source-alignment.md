# 13-agent-live-auth-source-alignment

- 时间：2026-04-08T004800+0800
- 任务：把 live `official:attach` 的 remote auth source 对齐到当前 healthy runtime，目标是把 status 从 `protocol_ok_model_error` 推到 `protocol_and_model_ok`

## 一句话结论

**成功。** 修改 remote auth sync target 后，`official:attach` 真实 live broker 状态已从 `protocol_ok_model_error` 提升到 `protocol_and_model_ok`，返回 `LIVE_ATTACH_OK`。

## 实际改动

### 1. `~/.config/mms/credentials.sh`

```diff
-export CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME='claude-code-official-3'
+export CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME=''
+export CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH='/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json'
+export CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH='/var/lib/cc-mcp-bridge/claude-home-1/.claude.json'
```

说明：
- 旧 auth source `claude-code-official-3` 对应的 org 已 disabled，导致模型回合返回 `This organization has been disabled.`
- 当前 healthy runtime `cc-static-1` 的 auth 实际持久化在 host 路径 `/var/lib/cc-mcp-bridge/claude-home-1/`，而非 running Docker container 内
- 因此清空 `CONTAINER_NAME`，显式把 credentials / global config 路径指向 `claude-home-1`

### 2. `src/official/remoteAuthSync.mjs`

两项最小代码改动：

1. **`fetchRemoteFile` 支持无容器名的 host 直读**
   - 当 `containerName` 为空时，不再强制 `docker exec`，而是直接 `ssh cat <path>`
   - 新增 `optional` 参数：文件不存在时返回 `{}` 而不是 throw

2. **尊重显式空容器名**
   - 修复 `syncRemoteAuthBundle` / `probeRemoteAuthBundle` 中 `containerName` 解析逻辑：
     - 旧逻辑：`normalizeText(env || config) || "claude-code-official"` 会把显式空字符串又 fallback 到默认值
     - 新逻辑：通过 `undefined` 检查区分"未设置"和"显式设为空"，只有真正未设置时才 fallback

3. **对 `.claude.json` 缺失更宽容**
   - `claude-home-1` 当前没有根目录 `.claude.json`（只有 backups）
   - `global_config` 读取标记为 `optional: true`，缺失时以 `{}` 继续

## 复跑命令

终端 1：起 live-configured broker
```bash
cd /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
source ~/.config/mms/credentials.sh
env \
  CC_BROKER_BASE_URL=http://127.0.0.1:8897 \
  CC_BROKER_DEVICE_KEY="$MMS_BROKER_DEVICE_KEY_PERSONAL" \
  CC_BROKER_REMOTE_SERVICE_BASE_URL=http://23.95.30.199:28082 \
  CC_BROKER_REMOTE_SERVICE_RUNTIME_ID=cc-static-1 \
  CC_BROKER_REMOTE_CLAUDE_SSH_TARGET=root@23.95.30.199 \
  CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME='' \
  CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json \
  CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.claude.json \
  npm run broker:serve 127.0.0.1 8897
```

终端 2：attach
```bash
cd /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
source ~/.config/mms/credentials.sh
env \
  CC_BROKER_BASE_URL=http://127.0.0.1:8897 \
  CC_BROKER_DEVICE_KEY="$MMS_BROKER_DEVICE_KEY_PERSONAL" \
  CC_BROKER_REMOTE_SERVICE_BASE_URL=http://23.95.30.199:28082 \
  CC_BROKER_REMOTE_SERVICE_RUNTIME_ID=cc-static-1 \
  CC_BROKER_REMOTE_CLAUDE_SSH_TARGET=root@23.95.30.199 \
  CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME='' \
  CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json \
  CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH=/var/lib/cc-mcp-bridge/claude-home-1/.claude.json \
  npm run official:attach -- 'Reply with exactly LIVE_ATTACH_OK and nothing else. Do not use tools.'
```

## 最终 status

```json
{
  "ok": true,
  "status": "protocol_and_model_ok",
  ...
  "session": {
    "snapshot": {
      "official_child": {
        "connected": true,
        "initialized": true,
        "auth_header_present": true,
        "assistant_texts": ["LIVE_ATTACH_OK"],
        "last_result": {
          "is_error": false,
          "result": "LIVE_ATTACH_OK",
          "total_cost_usd": 0.037479
        }
      }
    }
  },
  "remote_auth": {
    "ok": true,
    "container_name": "",
    "oauth": {
      "expires_at": 1775683266176,
      "scopes": ["user:file_upload", "user:inference", "user:mcp_servers", "user:profile", "user:sessions:claude_code"]
    }
  }
}
```

## 验证要点

- `device auth` ✅
- `session create` ✅
- `official child launch` ✅
- `session-ingress connected` ✅
- `initialized` ✅
- `model turn` ✅（返回 `LIVE_ATTACH_OK`）
- `cost/usage` ✅（$0.037, 9952 cache creation tokens）
- `remote_auth` ✅（token 有效，scopes 完整）

## 最小 blocker 已解除

之前的 blocker：remote auth source 指向 `claude-code-official-3`（org disabled）-> `protocol_ok_model_error`
当前状态：remote auth source 对齐到 `cc-static-1` 的 `claude-home-1` auth bundle -> `protocol_and_model_ok`
