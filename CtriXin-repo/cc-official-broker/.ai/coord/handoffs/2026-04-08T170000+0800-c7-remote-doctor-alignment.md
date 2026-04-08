# C7: remote:doctor alignment

- 时间：2026-04-08T170000+0800
- 分支：`feature/cc-official-broker-native-gateway-mainline`
- 目标：收紧 `npm run remote:doctor` 输出，使其明确反映 Phase 1 验收口径

## Changed files

- `src/remote/doctorRemoteService.mjs` — 新增 `verdict` 对象；probe 返回中捕获 `runtime_id`
- `src/index.mjs` — `remote:doctor` CLI handler 在 JSON 后追加 stderr verdict 表

## Verdict 判定

| 字段 | 依据 |
|---|---|
| `base_url_reachable` | healthz 或 first_turn 成功 |
| `auth_passed` | first_turn 成功 |
| `sticky_two_prompts` | 两次 prompt 命中同一 `remote_session_id` 且 second_turn 标记 `reused_remote_session` |
| `session_state_consistent` | session_state probe 的 `remote_session_id` 与 prompt 一致 |
| `runtime_id_present` | **probe 结果**（`cc_meta.meta.runtime_id`），非 config |
| `overall` | base_url ∧ auth ∧ sticky |

## CLI 输出

```
--- remote:doctor verdict ---
  base_url_reachable       ✓  http://127.0.0.1:19998
  auth_passed              ✓  bearer
  sticky_two_prompts       ✓  remote-sess-123
  session_state_consistent ✓  remote-sess-123
  runtime_id_present       ✗
  >> ACCEPTANCE PASS
----------------------------
```

## 验证命令

```bash
CC_BROKER_REMOTE_SERVICE_BASE_URL=http://127.0.0.1:19998 \
CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN=fake \
npm run remote:doctor
```
