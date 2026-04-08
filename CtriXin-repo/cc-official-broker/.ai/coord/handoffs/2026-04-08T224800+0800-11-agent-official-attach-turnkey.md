# 11: agent-official-attach-turnkey

- 时间：2026-04-08T224800+0800
- 任务：把 current-usable `official:attach` 收成“本机一条命令就能跑”的最小可用体验入口

## 一句话结论

`official:attach` 现在无需手动配置，直接 `npm run official:attach` 即可体验。

## 体验入口命令

需要两个终端：

```bash
# 终端 1：起本地 broker（.env 已默认指向 127.0.0.1:8787）
cd /Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker
npm run broker:serve

# 终端 2：直接 attach
npm run official:attach
```

也可以带自定义 prompt：

```bash
npm run official:attach -- "What is 2+2?"
```

## 需要的环境变量

已内建到 `.env`，`package.json` 脚本通过 `--env-file=.env` 自动加载：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CC_BROKER_BASE_URL` | `http://127.0.0.1:8787` | 本地 broker 地址 |
| `CC_BROKER_DEVICE_KEY` | `demo-device-key` | 本地 broker 任意 device key 均可 |

若需接真实 live broker，复制 `.env.example` 修改后覆盖 `.env` 即可。

## 当前是不是完整 TUI

**不是。**

当前启动的是 official `claude` binary 的 headless stream-json child，形态为：

```
claude --print --sdk-url <url> --session-id <id> \
  --input-format stream-json --output-format stream-json --replay-user-messages
```

完整 TUI direct-connect（`official:connect`）仍然被本地 `claude 2.1.92` 缺少 `claude open <cc-url>` 能力所阻塞。

## 本次改动清单

- 新增 `.env`：本地 broker 最小默认值
- 更新 `package.json`：所有脚本统一加 `--env-file=.env`
- 更新 `.gitignore`：忽略 `.env`
- 更新 `src/official/attachOfficialSession.mjs`：缺环境变量时给出明确补全提示
- 新增 `.env.example`：标注 local / live 两种配置示例
- 更新 `HANDBOOK.md`：追加 turnkey 体验入口说明
- 更新 `.ai/coord/LATEST.md`：标记本任务完成

## 验证结果

- `npm run official:attach` 在无额外环境变量时可直接执行（报错信息已变得可actionable）
- 当本地 broker 运行在 127.0.0.1:8787 时，整条链路从 device auth -> session create -> official child launch -> wait for result 已贯通
- 预期输出状态：
  - 本地 `claude` 已登录 → `protocol_and_model_ok`
  - 本地 `claude` 未登录 → `protocol_ok_auth_missing`

## 交付物

- handoff：`.ai/coord/handoffs/2026-04-08T224800+0800-11-agent-official-attach-turnkey.md`
