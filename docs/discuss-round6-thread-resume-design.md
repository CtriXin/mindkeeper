# Round 6: Thread Resume 机制设计 — 请 Codex Review

## 背景

MindKeeper 的 distill（蒸馏）系统将工作进度写入 thread 文件（`~/.sce/threads/dst-*.md`），跨 session 恢复依赖 brain_bootstrap 读取 thread。

**上一轮问题**：bootstrap 触发靠 CLAUDE.md 里的语义词（"继续"、"帮我修"），不可靠——Claude 可能不触发，也可能误触发后自行探索（调 brain_status、搜文件），导致 2 分钟才首次回复。

## 当前设计

### 核心原则

**Thread ID 是唯一可靠的恢复标识符**，不依赖语义猜测。

### 恢复优先级（resolveTargetThread）

```
1. 显式 thread ID（参数传入 or 消息中包含 dst-xxxxxxxx-xxxxxx）
2. 泛用恢复词（"继续"/"resume"/"continue" 等）→ 取当前 repo 最近的 thread
3. 任务相似度匹配（findBestThread, minScore = 4）
```

### 任务相似度评分（scoreTaskSimilarity）

```
完全一致:     +10
包含关系:     +6
关键词命中:   每个 +3
branch 匹配:  +2
门槛:         minScore = 4（bootstrap 和 distill parent 均为 4）
```

关键词提取规则：`[a-z0-9]+` 或 `[\u4e00-\u9fff]{2,}`，去重，最小长度 2。

### Thread 搜索范围

- 严格按 repo 精确过滤，不做全局 fallback（避免跨项目串线）
- TTL 过期的 thread 跳过（不删除）

### 输入清洗（distill 写入侧）

```typescript
ENTRY_LIMITS = { decisions: 5, changes: 8, findings: 8, next: 8 }
sanitizeScalar: 换行→空格，多空格→单空格，trim
sanitizeList:   去 markdown 前缀（-/*、checkbox），过滤空行，截断
```

### Parent 链解析（resolveParent）

```
1. 显式指定 parent → getThreadById 验证存在性，不存在则报错
2. 未指定 → findBestThread(repo, task, { branch, minScore: 4 })
3. 无匹配 → parent = undefined（新链起点）
```

### bootstrap 两层设计

| 工具 | 用途 | 速度 | 自动调用 |
|------|------|------|----------|
| brain_bootstrap | 轻量恢复：thread 摘要 + 待续 + 决策 | <200ms | 仅在消息含 thread ID 时 |
| brain_deep_context | 重度上下文：git + 规则 + 风险 + 文件推荐 | 1-3s | 从不自动 |

### distill 回执

```
💾 已蒸馏 — dst-20260326-h4lfd6

📊 3 条决策 | 1 个文件变更 | 2 个发现 | 0 项待续

下次恢复方式：
- 新 session 说任意任务描述，自动匹配最近的 thread
- 指定恢复：说 `继续 dst-20260326-h4lfd6`
- 当前 session 可继续工作，不受影响
```

## 请 Review 的点

1. **resolveTargetThread 优先级**：thread ID > 泛用恢复词 > 相似度匹配。这个顺序合理吗？泛用词优先于相似度的理由是：用户说"继续"时大概率想恢复最近的，不需要模糊匹配。
2. **scoreTaskSimilarity 权重**：完全一致 10、包含 6、关键词 3、branch 2。统一门槛 minScore=4。权重是否合理？4 分门槛意味着至少需要 2 个关键词命中或 1 个包含关系才能匹配。
3. **parent 链**：显式 parent 不存在时直接报错（而不是 fallback）。这个决策对不对？并行任务场景下如何避免串线？
4. **不做全局 fallback**：repo 无 thread 时返回空，不搜其他 repo。避免跨项目串线。代价是用户必须在正确的 repo 目录下才能恢复。这个 tradeoff 可接受吗？
5. **CLAUDE.md 触发规则**：提示词控制不住 LLM 行为（实测 Claude 会自行调 brain_status、搜文件）。目前的缓解方案是 bootstrap 返回足够信息减少探索欲。有没有更可靠的机制？

## 文件清单

| 文件 | 改动 |
|------|------|
| `src/bootstrap.ts` | resolveTargetThread, scoreTaskSimilarity, getThreadById, findBestThread, bootstrapQuick 重写 |
| `src/distill.ts` | sanitizeScalar/sanitizeList, ENTRY_LIMITS, resolveParent, 显式 parent 参数 |
| `src/server.ts` | brain_bootstrap/brain_deep_context 加 thread 参数, brain_checkpoint 加 parent 参数 |
| `~/.claude/CLAUDE.md` | MindKeeper 自动注入规则收紧 |
