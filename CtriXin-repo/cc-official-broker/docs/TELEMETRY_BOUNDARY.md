# Telemetry Boundary（2026-04-06）

这份文档只回答两个问题：

- `MMS -> broker -> remote official runtime` 这条链路里，哪一层会产生什么 telemetry
- 哪些东西我们能控，哪些不能靠“改字段名”去规避

## 1. 三层边界

```text
MMS(local)
  -> cc-official-broker(local entry + routing + runner bridge)
  -> official runtime service(server)
  -> official Claude Code runtime(server)
```

### 1.1 MMS(local)

职责：

- 选择 profile
- 注入本地启动环境
- 启动 broker shell

当前事实：

- `mms broker run <id>` 走的是 broker 独立入口
- 本地起的是我们的 `cc-official-broker`，不是本地官方 `claude` binary

对应代码：

- `/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/mms_broker.py:157`
- `/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/mms_broker.py:184`

这意味着：

- 走 broker path 时，本地不会额外触发“本地 official cc 那套 telemetry”
- `MMS` 本身不负责 official runtime 的远端 telemetry 决策

### 1.2 cc-official-broker(local)

职责：

- `device_key` bootstrap
- routing / isolation
- session truth
- local runner attach
- tool callback / usage stats

当前建议：

- broker 只记最小 meta log
- 不记 prompt body
- 不记 file content
- 不记 secret

这层是我们自己能完全控制的。

### 1.3 official runtime(service/server)

职责：

- 持有真实 official `OAuth`
- 驱动远端 official session / runtime
- 承接官方 auth / org / session 生命周期

这层如果跑的是官方 `Claude Code` 或强依赖官方运行时，那么：

- official remote session 行为在这里真实发生
- official telemetry / privacy policy 也主要在这里决定

## 2. 目前能直接确认的 telemetry 开关

从官方源码能直接看到：

- `DISABLE_TELEMETRY`
  - 对应 `no-telemetry`
  - 关闭 analytics / telemetry / feedback survey
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  - 对应 `essential-traffic`
  - 关闭更广泛的 nonessential traffic

reference：

- `/Users/xin/Downloads/src/utils/privacyLevel.ts`
- `/Users/xin/Downloads/src/services/analytics/config.ts`
- `/Users/xin/Downloads/src/services/analytics/firstPartyEventLoggingExporter.ts`

## 3. 能规避什么，不能规避什么

### 3.1 当前能规避的

- 避免在用户本机直接启动官方 `claude` binary
- 避免把 broker 入口混进原有 provider/account OAuth 主路径
- 控制我们自己 broker 层的日志与统计口径

### 3.2 当前不能靠“壳子”规避的

- 不能靠 `url + device_key` 伪装掉 official `OAuth`
- 不能靠 broker 自定义字段，消除远端 official runtime 自己的 telemetry
- 不能靠 `MMS` 本地入口，自动改变服务器上 official `cc` 的 privacy level

## 4. 如果要更干净地对外推广 MMS

对外更准确的说法应该是：

- `MMS` 支持一个可选的 broker profile 入口
- 它可以避免在本地直接运行 official `cc`
- 远端 official runtime 的 telemetry 仍由服务器部署侧控制

不建议对外说：

- “完全没有 telemetry”
- “已经绕过 official telemetry”
- “和 official 完全无关”

## 5. 实操建议

如果目标是让 broker 路线尽量降低 official telemetry 暴露面：

1. 本地继续通过 `mms broker run <id>` 启动 broker path，而不是本地直起 official `cc`
2. 服务器上运行 official `cc` 的那一层，显式评估是否设置：
   - `DISABLE_TELEMETRY`
   - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
3. broker 自己继续保持最小日志口径，不扩大本地敏感信息采集面

## 6. 一句话结论

- 我们能控制的是：本地入口、broker 日志、runner 桥接、usage stats
- 我们不能假装控制的是：远端 official runtime 自己的 telemetry
- 所以当前正确做法不是“伪装掉”，而是“分层控制”
