# Hive Continuity TODO

日期：2026-04-03  
作者：Codex

## 定位

Mindkeeper 先不进 Hive 主循环。  
优先做 `continuity layer`，服务：

- compact 后恢复
- human interrupt 后恢复
- 新 session 接回当前任务

## 不做

- 不反向控制 Hive loop
- 不接管 worker runtime
- 不做主流程 orchestration

## 最小目标

### 1. resume seed

给 Hive 提供一个最小 continuity seed：

- thread_id
- 当前任务
- 最近决定
- 最近 next steps

### 2. interrupt continuity

在 human interrupt / 中断恢复时，优先输出：

- last active task
- last useful next step
- related artifact pointers

### 3. compact continuity

让 distill / thread 恢复结果更适合 compact 后使用：

- 不只是一大段总结
- 更像短索引

## 建议字段

```json
{
  "thread_id": "dst-xxx",
  "task": "current task",
  "status": "active|paused|blocked",
  "decisions": ["..."],
  "next": ["..."],
  "artifacts": ["..."]
}
```

## 优先级

1. interrupt continuity
2. compact continuity
3. richer resume seed
