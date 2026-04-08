# 08: remote:doctor real interop acceptance

- 时间：2026-04-08T223000+0800
- 分支：`feature/cc-official-broker-native-gateway-mainline`
- 目标：用真实 remote service 跑通 `npm run remote:doctor`

## 结论：ACCEPTANCE PASS

## Verdict 5 项

| # | 判定项 | 结果 | 详情 |
|---|--------|------|------|
| 1 | `base_url_reachable` | PASS | `http://23.95.30.199:28082` healthz=200, models=1 |
| 2 | `auth_passed` | PASS | Bearer auth, first_turn ok |
| 3 | `sticky_two_prompts` | PASS | 两轮 prompt 命中同一 `remote_session_id=c11982f9...` |
| 4 | `session_state_consistent` | PASS | GET /v1/session_state 返回一致 |
| 5 | `runtime_id_present` | PASS | `cc-static-1` via `cc_meta.meta.runtime_id` |

## 执行命令

```bash
cd /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
CC_BROKER_REMOTE_SERVICE_BASE_URL=http://23.95.30.199:28082 \
CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN=<live-bearer-token> \
npm run remote:doctor
```

## 关键输出

```
--- remote:doctor verdict ---
  base_url_reachable       ✓  http://23.95.30.199:28082
  auth_passed              ✓  bearer
  sticky_two_prompts       ✓  c11982f9-dbc3-4b45-82dd-3d83aeda2a2d
  session_state_consistent ✓  c11982f9-dbc3-4b45-82dd-3d83aeda2a2d
  runtime_id_present       ✓
  >> ACCEPTANCE PASS
----------------------------
```

## 修复的 remote service 侧问题

1. **cc-static-1 wrapper stdin 断开**：非 TTY 分支 `docker run` 缺少 `-i` 标志，导致 bridge 通过 subprocess 管道传入的 prompt 无法到达容器内 claude。已在 `23.95.30.199:/usr/local/bin/cc-static-1` 第 85 行补 `-i`。
2. **cc-static-3 账号被封**：Anthropic 返回 `This organization has been disabled`，已将 cc-static-3 标记 unhealthy。
3. **cc-static-1 health 状态残留**：因之前 stdin bug 导致 4 次连续失败被标记 auto-unhealthy，已重置。

## 主线状态

- gateway broker -> remote service 主链路已跑通
- 两次 prompt sticky 成立，session_state 一致
- usage/cost 返回正常：first_turn $0.059, second_turn $0.020

## 下一步建议

1. 把 `23.95.30.199` 的 cc-static-1 stdin 修复同步到 `82.156.121.141` 的 wrapper
2. 替换 cc-static-3 的 OAuth 凭证或将其永久禁用
3. 将 remote:doctor 的 base_url/token 持久化到 worktree `.env`，后续 dev 直接用
