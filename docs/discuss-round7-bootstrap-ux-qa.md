# Round 7: Bootstrap UX 优化 Q&A 日志

## 问题 1：MCP 在 MMS 新 session 不加载

**现象**：新起 MMS session，/mcp 看不到 mindkeeper。

**排查过程**：
- `~/.claude/.mcp.json` 有 mindkeeper 配置 ✓
- session 的 `.claude/.mcp.json` 已 symlink ✓
- 但 /mcp 只显示 excalidraw、figma、hive，没有 mindkeeper

**根因**：Claude Code 的 MCP servers 存在 `~/.claude.json`（注意没有目录层）的 `mcpServers` 字段里，不是 `.claude/.mcp.json`。MMS 启动时复制 `~/.claude.json` 到 session，但真实文件里没有 mindkeeper。

**修复**：把 mindkeeper 加到 `~/.claude.json` 的 `mcpServers`。不需要改 `ccs_launchers.py`。

---

## 问题 2：bootstrap 太慢（2m40s）

**现象**：brain_bootstrap 跑了 3 个 git 命令 + 读规则文件 + 知识检索，输出大段文本，Claude 消化后 2 分 40 秒才首次回复。

**修复**：拆成两层：
- `brain_bootstrap`（<200ms）：只读 thread 摘要 + 待续 + 决策
- `brain_deep_context`（按需）：原来的重操作全搬这里

---

## 问题 3：bootstrap 快了但 Claude 还是慢（1m+）

**现象**：MCP 本身快了，但 Claude 自行加戏——额外调 brain_status、brain_procedures、git log、搜文件。

**根因**：CLAUDE.md 提示词控制不住 LLM 的探索欲。bootstrap 返回信息太少（只有一句状态），Claude 觉得不够就自己去补。

**修复**：
1. bootstrap 返回更多信息（待续项 + 决策 + 其他 thread 列表），Claude 不需要额外探索
2. CLAUDE.md 收紧禁止规则（虽然不 100% 可靠）

---

## 问题 4："继续"等语义词触发不可靠

**现象**：用 CLAUDE.md 里的语义词（"继续"、"帮我修"）控制触发，Claude 可能不识别也可能误触发。

**用户观点**：宁愿用唯一标识符（thread ID）来恢复，不要用通用语义词。

**最终设计**：resolveTargetThread 三级优先级：
1. 显式 thread ID（`dst-` 开头）— 最可靠
2. 泛用恢复词（"继续"/"resume"）— 取最近 thread
3. 任务相似度匹配（minScore=4）— fallback

---

## 问题 5：每个任务都触发 bootstrap

**现象**：配置 Facebook 像素（完全无关任务）也触发了 brain_bootstrap，返回"新任务，直接开始"——纯浪费。

**根因**：CLAUDE.md 规则太宽（"任务相关就触发"）。

**修复**：收紧为只有两种情况触发：
1. 消息包含 thread ID（`dst-` 开头）
2. 明确说"继续"、"恢复"等恢复类指令

所有其他新任务一律不触发。

---

## 问题 6：/clear 后说"继续"没触发 bootstrap

**现象**：/clear 后说"继续"，Claude 没调 brain_bootstrap，去读了 TODO 文件。

**根因**：
1. "继续"太短，Claude 没当成任务
2. cwd 是 multi-model-switch 不是 mindkeeper，即使触发也找错 repo

**修复**：thread ID 是最可靠的恢复方式，不依赖 cwd 猜测。

---

## 问题 7：全局 fallback 是否需要

**讨论**：repo 无 thread 时要不要搜全局？

**结论**：不做。严格按 repo 过滤，避免跨项目串线。用户必须在正确 repo 下或使用 thread ID。

---

## 问题 8：distill 蒸馏和恢复都是明文理解

**现象**：写入和读取都靠 AI 主观判断，没有结构化指令传递。

**当前状态**：接受这个设计。thread 文件有固定 frontmatter + 5 段结构，算是半结构化。完全自动化需要 hook 机制（每次 tool call 后自动记录），暂不做。

---

## 问题 9：distill 回执应该怎么引导恢复

**用户反馈**：thread ID 可以直接发送恢复，回执里应该直接告诉用户这个最简单的方式。

**修复**：回执简化为一行：
```
下次恢复：发送 `dst-20260326-h4lfd6`
```

---

## 关键决策总结

| 决策 | 理由 |
|------|------|
| thread ID 是唯一可靠恢复标识 | 语义词不可控，ID 确定性 100% |
| bootstrap 不自动触发新任务 | 不是每个任务都需要恢复上下文 |
| 不做全局 thread fallback | 跨项目串线风险 > 便利性 |
| 提示词控制 LLM 行为不可靠 | 实测多次失败，改为返回足够信息减少探索欲 |
| distill 明文理解暂可接受 | 半结构化格式 + 输入清洗已足够 MVP |
