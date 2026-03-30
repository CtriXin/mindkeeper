# Personal Baseline Benchmark 2026-03-30

## Scope

这份文档记录 `82.156.121.141` 个人样板机在 `newapi -> CRS` 链路上的最新基准结论。

目标：

- 确认个人 `newapi` 不会像公司 `libre` 那样改写或丢失 `prompt_cache_key`
- 确认个人 `CRS` 仍能基于 `prompt_cache_key` 做 OpenAI sticky
- 留下一条后续可重复使用的隔离 benchmark 链

## Confirmed Facts

- 公司 `libre` 问题已收敛为：
  - `newapi` 会改写或破坏 `prompt_cache_key`
  - 因此 `newapi -> CRS` 的缓存/粘性表现明显偏差
- 个人服务器 `82.156.121.141` 不存在该问题
- 当前个人服务器可以作为：
  - `newapi -> CRS` OpenAI cache/sticky 基准机
- 当前个人服务器暂时还不作为：
  - `newapi -> CRS -> Claude` benchmark 主基准
  - `Claude` 需等加固后再做单独 benchmark 化

## Retained Benchmark Chain

- `newapi`
  - live: `http://82.156.121.141:4001`
  - container: `new-api-custom`
- `CRS`
  - live: `http://82.156.121.141:3000`
  - container: `claude-relay-service-claude-relay-1`
- retained isolated chain:
  - channel `13`
  - name: `relay-op-benchmark-xin`
  - group: `max`
  - model: `gpt-5.4`
- retained isolated token:
  - token id `166`
  - name: `relay-benchmark-max-mms`
  - group: `max`

## Verification Result

验证窗口：

- `2026-03-30 23:35:22 +0800`
- `2026-03-30 23:35:30 +0800`

验证方法：

- 使用隔离 token 只打 `channel 13`
- 两次调用同一个 `/v1/responses`
- 两次使用同一个 `prompt_cache_key`

确认到的事实：

- `newapi` 两次都只使用 `channel_id=13`
- `request_path=/v1/responses`
- `channel_affinity.key_path=prompt_cache_key`
- `channel_affinity.key_source=gjson`
- `cache_tokens=2304`
- `CRS` 第一次创建 sticky 映射
- `CRS` 第二次命中同一个 OpenAI 账号 `op-group-turkey`

## Practical Meaning

这条结果说明：

1. 个人 `newapi` 当前不会把 `prompt_cache_key` 弄丢
2. 个人 `CRS` 仍能消费这个字段做 OpenAI sticky
3. 个人链路上的 OpenAI Responses cache/sticky 是通的
4. 公司后续新机器应以这台个人机作为 OpenAI baseline，而不是以 `libre` 为模板

## Next Rule

- 保留 `channel 13 + token 166`，后续继续作为 OpenAI benchmark 入口
- 不把 `Claude` benchmark 和这个入口混用
- `Claude` 要等加固完成后，再建立独立隔离链
