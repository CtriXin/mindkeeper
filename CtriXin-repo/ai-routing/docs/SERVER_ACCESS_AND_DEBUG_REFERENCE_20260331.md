# Server Access And Debug Reference 2026-03-31

## Purpose

这份文档只回答 4 个问题：

1. 服务器怎么进入
2. 服务器上看哪里
3. 出问题先查什么
4. `newapi -> CRS` / `Claude` / benchmark 各自对应哪条链

## Server Map

### 1. 个人样板机

- 用途：
  - 个人自用
  - 公司新机器的 OpenAI baseline
  - `newapi -> CRS` cache/sticky 对照机
- host:
  - `82.156.121.141`
- direct entry:
  - `ssh root@82.156.121.141`

### 2. 公司服务器

- 当前已知角色：
  - `libre`
    - 问题样本环境
    - 之前确认存在 `prompt_cache_key` 异常
  - `crs`
    - 公司 CRS 环境
- entry:
  - 通过公司 JumpServer 进入
  - 你本地已有 wrapper：
    - `js libre`
    - `js crs`
- 注意：
  - wrapper 里含敏感明文，不能入库
  - `serveragent` 只用它做连接，不把脚本提交到仓库

## Personal Baseline Host Layout

### newapi

- live URL:
  - `http://82.156.121.141:4001`
- container:
  - `new-api-custom`
- image:
  - `new-api:sparkring`
- live build path:
  - `/opt/new-api`
- important files:
  - `/opt/new-api/Dockerfile.sparkring`
  - `/opt/new-api/new-api-sparkring`
- stage path:
  - `/opt/ai-routing-stage/newapi`

### CRS

- live URL:
  - `http://82.156.121.141:3000`
- container:
  - `claude-relay-service-claude-relay-1`
- live source dir:
  - `/root/claude-relay-service`
- important files:
  - `/root/claude-relay-service/.env`
  - `/root/claude-relay-service/Dockerfile`
  - `/root/claude-relay-service/docker-compose.yml`
- stage path:
  - `/root/ai-routing-stage/crs`

## First 5 Commands After Login

```bash
hostname
date
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
curl -sS http://127.0.0.1:3000/health
curl -sS http://127.0.0.1:4001/api/status
```

目的：

- 确认是不是对的机器
- 确认容器是不是活着
- 确认 `3000/4001` 当前健康

## Where To Look

### 看 newapi

- recent logs:

```bash
docker logs --since 10m new-api-custom
```

- 只看 consume / errors:

```bash
docker logs --since 10m new-api-custom 2>&1 | egrep "record consume log|channel error|relay error|POST /v1/responses|POST /v1/messages"
```

- 看 DB 里的 channel / token:

```bash
docker exec -i postgres psql -U root -d new-api -At <<'SQL'
select id,name,"group",status,models from channels order by id;
select id,name,"group",status,key from tokens order by id desc limit 20;
SQL
```

### 看 CRS

- recent logs:

```bash
docker exec claude-relay-service-claude-relay-1 sh -lc "tail -n 120 /app/logs/claude-relay-$(date +%F).log"
```

- 只看 sticky / proxy / account:

```bash
docker exec claude-relay-service-claude-relay-1 sh -lc \
  "grep -n 'Created new sticky session mapping\|Using sticky session account from group\|Using proxy for Claude request\|Using proxy for OpenAI request' /app/logs/claude-relay-$(date +%F).log | tail -n 80"
```

- 看 Redis sticky:

```bash
docker exec claude-relay-service-redis-1 redis-cli keys 'unified_openai_session_mapping:*'
docker exec claude-relay-service-redis-1 redis-cli keys 'unified_claude_session_mapping:*'
```

## Benchmark And Main Chains

### OpenAI benchmark chain

- 目的：
  - 验证 `prompt_cache_key -> CRS sticky -> cache_tokens`
- host:
  - `82.156.121.141`
- channel:
  - `13`
  - `relay-op-benchmark-xin`
- token:
  - `166`
  - `relay-benchmark-max-mms`
- group:
  - `max`
- status:
  - 保留中
  - 作为后续公司新机器对照基线

### 当前个人主链

- `channel 8`
  - `relay-op-main-xin`
- `channel 11`
  - `relay-op-chat-xin`
- `channel 12`
  - `relay-cl-main-xin`

### Claude benchmark

- 当前不单独固化
- 等 `Claude` 加固完成后，再建立隔离链

## Fast Checks By Scenario

### A. 怀疑 `newapi` 丢了 `prompt_cache_key`

先看：

```bash
docker logs --since 10m new-api-custom 2>&1 | grep "record consume log" | tail -n 20
```

重点字段：

- `request_path`
- `channel_affinity.key_path`
- `channel_affinity.key_source`
- `use_channel`
- `cache_tokens`

### B. 怀疑 CRS sticky 没命中

先看：

```bash
docker exec claude-relay-service-claude-relay-1 sh -lc \
  "grep -n 'Created new sticky session mapping\|Using sticky session account from group' /app/logs/claude-relay-$(date +%F).log | tail -n 60"
```

重点看：

- 第一次是否 `Created new sticky session mapping`
- 第二次是否 `Using sticky session account from group`
- 两次是不是同一个 account id

### C. 怀疑 Claude proxy 或账号异常

先看：

```bash
docker exec claude-relay-service-claude-relay-1 sh -lc \
  "grep -n 'Using proxy for Claude request\|401\|403\|refresh' /app/logs/claude-relay-$(date +%F).log | tail -n 80"
```

### D. 怀疑部署后 runtime 变了

先看：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

然后对照：

- `new-api-custom`
- `claude-relay-service-claude-relay-1`
- `postgres`
- `redis`
- `claude-relay-service-redis-1`

## Source Of Truth

如果要继续查：

- 服务器部署与 live 事实：
  - [handoff.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/.ai/plan/handoff.md)
- 个人 baseline 结论：
  - [PERSONAL_BASELINE_BENCHMARK_20260330.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/PERSONAL_BASELINE_BENCHMARK_20260330.md)
- sticky/session 契约：
  - [NEWAPI_CRS_STICKY_SESSION_GUIDE.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/NEWAPI_CRS_STICKY_SESSION_GUIDE.md)
- 私有链路 smoke：
  - [PRIVATE_CRS_SMOKETEST_RUNBOOK.md](/Users/xin/auto-skills/CtriXin-repo/ai-routing/docs/PRIVATE_CRS_SMOKETEST_RUNBOOK.md)
