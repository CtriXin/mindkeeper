# Context Distill — 上下文蒸馏与连续性系统

> MindKeeper 的核心闭环：bootstrap 读 → 工作 → distill 写 → bootstrap 读

> 当前状态（2026-03-26）：
> 已实现 `brain_checkpoint`、`brain_bootstrap`、`brain_deep_context`，并支持 `thread id` 精确续接。
> `/distill` skill、parent 链多层回溯、过期清理仍是后续项，不应按已交付能力使用。

## 要解决的问题

1. **Token 爆炸** — session 越聊越长，每次请求带着全部历史，成本高、速度慢
2. **暴力压缩丢信息** — Claude Code 自动 compact 是截断式的，关键决策和代码变更随机丢失
3. **跨 session 断裂** — 换 session 后一切从头，之前的工作上下文全没了
4. **多项目 thread 混乱** — threads 目录没有项目隔离，没有链路关联，没有过期清理

## 核心设计

### Thread 文件结构

每次蒸馏产出一个 thread 文件，存储在 `~/.sce/threads/`：

```markdown
---
id: dst-20260326-a1b2c3
project: multi-model-switch
repo: /Users/xin/auto-skills/CtriXin-repo/multi-model-switch
branch: main
task: 修 provider routing bug
parent: dst-20260325-x9y8z7    # 上一个 thread（形成链路）
created: 2026-03-26T15:30:00+08:00
ttl: 7d                         # 过期时间，默认 7 天
token_before: 98000              # 蒸馏前 token 估算
token_after: 1800                # 蒸馏后 token 数
---

## 决策
- bridge 路由逻辑不改，只修 adapter 层的 fallback
- provider 优先级保持现有顺序

## 变更
- `src/adapter.ts:45` — 增加 fallback 检查
- `src/bridge.ts:120` — 修正 header 透传

## 发现
- openai-only provider 在 claude 请求时不会自动降级，需要手动处理

## 待续
- [ ] 补回归测试覆盖 adapter fallback 路径
- [ ] 确认 bridge header 透传在 streaming 模式下也正常

## 当前状态
adapter fallback 已实现并本地验证，未提交。bridge 修改完成但未测试 streaming。
```

### 链路机制

```
dst-20260324-aaa (task: 调研 provider routing)
  └── dst-20260325-bbb (task: 修 provider routing bug)
        └── dst-20260326-ccc (task: 补测试 + 收尾)
```

- `parent` 字段串联同一工作流的多次蒸馏
- bootstrap 加载时，沿 parent 链最多回溯 3 层，构建完整上下文
- 每个 thread 独立可读，即使 parent 被清理也不影响当前 thread 的信息完整性

### 匹配逻辑（loadContinuity 升级）

```
1. 按 repo 精确过滤 → 只看当前项目的 thread
2. 按 ttl 过滤 → 过期的跳过
3. 按 task 相关度排序 → 任务关键词匹配
4. 按 parent 链追溯 → 如果命中的 thread 有 parent，把链路上下文也带上
5. 最多注入 2 个最相关 thread 的摘要（控制 token 预算）
```

### 续接方式

**方式 A：自动续接（推荐）**

```
/distill → 蒸馏写入 thread → /clear → 新 session
新 session 启动 → brain_bootstrap 自动按 repo 匹配最近 thread → 无缝继续
```

用户无需任何额外操作。bootstrap 根据当前 repo 路径自动找到最相关的 thread。

**方式 B：Key 续接（精确控制）**

```
/distill → 输出 thread id（如 dst-20260326-a1b2c3）→ /clear → 新 session
用户输入：继续 dst-20260326-a1b2c3
→ brain_bootstrap 精确加载该 thread + parent 链
```

适用于：同一个项目有多条并行工作流，自动匹配可能选错的场景。

**方式 C：自动触发蒸馏（终极目标）**

通过 Claude Code hook 监控 session，当检测到以下信号时自动建议蒸馏：
- 对话轮次超过 N 轮
- 预估 token 接近阈值
- 即将发生 auto-compact

输出提示：`⚡ Context 较大，建议 /distill 瘦身`

## 过期清理

- 每个 thread 有 `ttl` 字段，默认 7 天
- `brain_bootstrap` 每次启动时顺带清理过期 thread（零额外开销）
- 被其他 thread 引用为 parent 的，延长至最后一个子 thread 过期后再清理
- 也可手动清理：`brain_forget_thread <id>`

## 实现清单

### P0 — 必须有（立即做）

- [ ] **Thread frontmatter 规范** — 定义 id/project/repo/branch/task/parent/created/ttl 字段
- [ ] **`/distill` skill** — 蒸馏当前 session，写入 thread 文件，输出 thread id
- [ ] **`brain_checkpoint` MCP tool** — 给 AI 自己调用的存档接口（和 /distill 共享写入逻辑）
- [ ] **`loadContinuity()` 升级** — 按 repo 过滤 + ttl 检查 + parent 链追溯
- [ ] **Fix: `git()` trim 吃掉首行前导空格** — porcelain 输出按行 slice(3) 而非全局 trim
- [ ] **Fix: 未提交文件 > 3 就建议 stash 过于激进** — 改为只在未提交文件和当前任务无关时才建议
- [ ] **Fix: 文件推荐只看 CLAUDE.md** — 补充 AGENT.md / AGENTS.md 作为规则入口推荐

### P1 — 应该有（本周）

- [ ] **自动续接** — bootstrap 按 repo + recency + task 相关度自动选择 thread
- [ ] **Key 续接** — 支持 `brain_bootstrap({ thread: "dst-xxx" })` 精确加载
- [ ] **Token 估算** — distill 时统计压缩前后 token 数，写入 frontmatter
- [ ] **parent 链回溯** — 沿链最多回溯 3 层，合并上下文

### P2 — 可以有（本月）

- [ ] **自动触发建议** — hook 监控对话轮次/token，接近阈值时提示 /distill
- [ ] **过期清理** — bootstrap 启动时清理超过 ttl 的 thread，保护被引用的 parent
- [ ] **thread 可视化** — `brain_threads` 工具列出当前项目的所有 thread 链路

### P3 — 未来做（想清楚再做）

- [ ] **自动蒸馏** — 完全无感知，检测到 compact 即将发生时自动 distill + 提示 /clear
- [ ] **跨项目关联** — thread 引用其他项目的 thread（如 mms 任务关联 mindkeeper 改动）
- [ ] **蒸馏质量评分** — 对比蒸馏前后的信息保留度，持续优化蒸馏 prompt

## 蒸馏 Prompt 策略

`/distill` 的核心是一个蒸馏 prompt，要求 AI 从当前对话中提取：

```
1. 决策 — 做了什么选择，为什么（不超过 5 条）
2. 变更 — 改了哪些文件的哪些位置（精确到行号）
3. 发现 — 过程中学到的、踩到的坑
4. 待续 — 还没做完的、下一步要做的
5. 当前状态 — 一句话总结现在在哪
```

不保留：
- 工具调用的完整输出
- 中间尝试和回退
- 格式化的长代码块（只保留文件名+行号+摘要）
- 重复的确认对话

## 和 MindKeeper 其他模块的关系

```
brain_bootstrap (读)
    ↑ loadContinuity() 读 thread
    |
工作过程
    |
    ↓ /distill 或 brain_checkpoint 写 thread
brain_checkpoint (写)

brain_search ←→ thread 中的「发现」可以自动存入知识库（P3）
brain_pin ←→ thread 中的「决策」可以自动 pin（P3）
```

## 用户体验目标

**最终效果：用户几乎无感知地保持工作连续性。**

理想流程：
1. 开始工作 → bootstrap 自动加载上次 thread → 知道该从哪续
2. 工作到一半 → 收到提示"建议 /distill" → 一键蒸馏
3. /clear → 立即新 session → bootstrap 自动续接 → 继续工作
4. 换到另一个项目 → bootstrap 自动切到那个项目的 thread → 零混淆

从用户视角看，就像从来没有"session 断裂"这回事。
