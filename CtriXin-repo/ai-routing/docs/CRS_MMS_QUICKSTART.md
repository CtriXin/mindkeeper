# CRS / MMS 接入速查

> 给“赶时间的人”用。看完就知道该做什么，不需要先通读长文。
> 详细版见 [docs/CRS_MMS_BINDING_RUNBOOK.md](/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/docs/CRS_MMS_BINDING_RUNBOOK.md)

## 0. 先记住一句话

正常流量默认走：

- `MMS -> newapi -> CRS`

排障/诊断才走：

- `MMS -> direct CRS key`

不要一上来就所有号都直连 `CRS`。

## 1. 新号接入你要做什么

你自己必须做：

1. 在浏览器完成 `Claude OAuth`
2. 确认账号已经出现在 `CRS` 后台
3. 告诉 agent 这次要用的 `proxy / IP`

你给 agent 的信息最少要有：

- 账号名字
- 本次用途
  - 主力
  - relay pool
  - direct 备用
- 这次走哪个 proxy / IP

## 2. agent 会帮你做什么

agent 可以代做：

1. 创建 direct `CRS key`
2. 把 key 绑定到指定 OAuth 账号
3. 修 API Keys 前台不可见的问题
4. 在本机 `MMS` 加 provider
5. 校验是否真的走了你指定的 proxy
6. 试 `1M`
7. 决定这个号能不能进调度池

## 3. 接入顺序

每次新号都按这个顺序：

1. `OAuth` 完成
2. 建 direct key
3. 绑账号
4. 补前台索引
5. 配 `MMS provider`
6. 先跑 `haiku`
7. 查日志确认：
   - `Using proxy for Claude request: <expected_proxy>`
8. 再跑普通 `sonnet/opus`
9. 最后才试 `1M`

## 4. 什么时候绝对不要开 1M

看到下面任一条，后面都按保守模式：

- `Extra usage required for long context requests`
- `429 rate_limit_error`
- 同账号短时间频繁 retry
- 同 IP 下多个账号一起高频跑

保守模式就是：

- 不追加 `[1m]`
- `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`
- compact window 退回 `200k`

## 5. 怎么知道是不是走了正确的 proxy

只认日志，不靠猜。

smoke 后必须在 `CRS` 日志里看到：

```text
Using proxy for Claude request: <expected_proxy>
```

看不到这行，就算失败。

## 6. 一个 IP 挂几个号

最稳：

- `1号1IP`

能接受：

- `2号1IP`
- 但前提是：
  - 不并发高频
  - 不同时压测
  - 默认关 `1M`

高风险：

- 多号共用 1 个 IP
- 还同时高频、重试、开 `1M`

## 7. 现在这套里的通道怎么理解

- `private`
  - 个人主力 Claude 直连
- `fishcrs`
  - 个人备用 Claude 直连
- `xin`
  - 主 newapi relay 入口
- `companycrs`
  - 公司 Claude 专用
- `companycrsopenai`
  - 公司 OpenAI/Codex 专用
- `newapi5-4`
  - 公司 `gpt-5.4` 专用

## 8. 哪些东西不要手动乱动

如果你不确定，先别手动改这些：

- `private/独享` 绑定
- `1M` 开关
- `newapi channel_affinity`
- `CRS` 账号分组
- `API Key index`

这些最容易改出“表面能用、实际上埋雷”的状态。

## 9. 被封/被 disabled 怎么处理

出现：

- `This organization has been disabled`
- `Account blocked`
- `403 error detected`

就按这个处理：

1. 立刻摘出调度池
2. 禁用相关 direct key
3. 从本机 `MMS` 去掉相关 provider
4. 如果确认没用了，直接删账号/key/provider

## 10. 下次你只要发什么给 agent

复制这段填空就够：

```text
新号接入：
- 账号名：
- 已完成 OAuth：是/否
- 用途：主力 / relay / direct
- proxy / IP：
- 是否准备试 1M：是/否
```
