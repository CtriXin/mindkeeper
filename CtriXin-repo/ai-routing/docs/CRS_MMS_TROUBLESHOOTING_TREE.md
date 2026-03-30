# CRS / MMS 故障树

> 看到错误先别慌，按这个树排。
> 详细背景见 [docs/CRS_MMS_BINDING_RUNBOOK.md](/Users/xin/auto-skills/CtriXin-repo/multi-model-switch/docs/CRS_MMS_BINDING_RUNBOOK.md)

## A. `429 rate_limit_error`

### A1. message 含：

```text
Extra usage required for long context requests
```

先判断：

1. 当前是不是 `1M context`
2. 启动页是不是显示 `Opus/Sonnet 4.6 (1M context)`
3. 这个 provider/account 是否应该默认禁用 `1M`

处理：

- 关 `1M`
- 退回 `200k`
- 减少 retry
- 不要再并发测试

### A2. 不是 long-context 文案

优先查：

1. 同账号是不是被高频使用
2. 同 IP 下是不是还有别的号在跑
3. key 有没有并发/频率限制

处理：

- 给 key 加限频
- 给账号加 `maxConcurrency=1`
- 错峰使用

## B. `400 This organization has been disabled`

这是高优先级坏状态。

处理顺序：

1. 立刻把账号从调度池摘掉
2. 禁用相关 direct key
3. 从 `MMS` 去掉对应 provider
4. 如果确认不会恢复，直接删账号和 key

不要继续 retry。

## C. `500 upstream_error`

先分流：

### C1. 只在 `newapi` 发生

优先怀疑：

- `newapi -> CRS` 包装了真实上游错误

先去 `CRS` 日志看原始错误。

### C2. `direct CRS key` 也发生

优先怀疑：

- 账号本身
- proxy
- `1M`
- 上游状态

## D. `model_not_found`

先查：

1. 这是 alias 还是 dated model
2. `newapi channels.models` 里有没有
3. `newapi abilities` 里有没有
4. `CRS /models` 里实际广告了什么

如果是：

- `claude-sonnet-4-6`

但上游只认识：

- `claude-sonnet-4-20250514`

那就要补：

- alias
- model mapping
- abilities

## E. `cache_read` 明显低于 direct CRS

如果你发现：

- `direct CRS key` 的 `cache_read` 很高
- `newapi-test` / relay 路径的 `cache_read` 很低

优先查：

1. `prompt_cache_key`
2. `session_id`
3. `previous_response_id`
4. 是否命中同一个 `CRS key`
5. 是否命中同一个 account

这是目前 OpenAI/Responses 路径最值得怀疑的点。

## F. 前台看不到新建 key

先别以为没创建成功。

优先查：

1. Redis 里 key 是否已存在
2. `apikey:idx:all` 是否包含它
3. `apikey:set:active` 是否状态正确

常见原因：

- key 创建了
- 但没进 `API Key index`

处理：

- 手动补索引
- 或重建索引

## G. 明明配了 proxy，但你不确定是否真的生效

唯一可靠判断：

查 `CRS` 日志里有没有：

```text
Using proxy for Claude request: <expected_proxy>
```

没有这行：

- 一律按“没成功”处理

## H. `MMS` 里 provider 页面直接崩

如果看到类似：

```text
TypeError: 'NoneType' object is not callable
```

优先怀疑：

- `rich` 延迟导入对象未初始化

当前项目里已经踩过一次：

- `_display_provider_model_table()` 少了 `_ensure_rich()`

## I. 一个账号删不删

### I1. 只是不稳定

做：

- `schedulable=false`
- 先摘出池

### I2. 已确认 disabled / blocked

做：

1. 禁 direct key
2. 禁/删 MMS provider
3. 确认没有独享 key 仍绑着它
4. 再删账号

## J. 删除账号前的最后检查

一定先确认：

1. `private/独享` 还绑不绑这个账号
2. 还有没有 direct key 绑着它
3. 有没有本机 `MMS provider` 还会误用它

这一步不确认，最容易误伤主力入口。
