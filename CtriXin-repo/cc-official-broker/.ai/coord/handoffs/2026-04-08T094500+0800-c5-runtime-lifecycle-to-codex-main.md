# Handoff: C5 Runtime Lifecycle (Fixed)

- **From**: Worker Agent
- **To**: codex-main
- **Task**: C5 Runtime Lifecycle Implementation (Review Fix)
- **Timestamp**: 2026-04-08
- **Status**: Completed with fixes

## 一句话结论

修复了 C5 的三个 blocking 问题：1) `enabled` 字段现在正确反映 effective state（考虑 state override）；2) auto-unhealthy 现在会检查是否有其他 healthy runtime，不会把最后一个也打掉；3) 文档验证步骤改为当前真实可用的 Node.js 直接调用方式。

## 修复内容

### Fix #1: enabled 字段反映 effective state

**问题**：`buildRuntimePoolEntry()` 返回的 `enabled` 只考虑了 config，忽略了 state override，导致 `routing_status = "disabled"` 但 `enabled = true` 的错误状态。

**修复**：在 `buildRuntimePoolEntry()` 中计算 effective enabled：
```javascript
const configEnabled = configEntry?.enabled !== false
const stateEnabled = stateEntry?.enabled
const effectiveEnabled = stateEnabled !== null && stateEnabled !== undefined
  ? stateEnabled
  : configEnabled
// ...
enabled: effectiveEnabled,
```

### Fix #2: auto-unhealthy 保护最后一个 healthy runtime

**问题**：`recordFailure()` 在达到阈值时直接触发 auto-unhealthy，可能导致所有 runtime 都被标记为 unhealthy。

**修复**：
1. `RuntimeState.recordFailure()` 新增 `hasOtherHealthyCandidate` 参数
2. `RuntimePool.recordOutcome()` 自动检查是否有其他 healthy runtime 并传递该参数
3. 只有存在其他 healthy candidate 时才允许触发 auto-unhealthy

```javascript
// Auto-mark unhealthy only if there's another healthy candidate
if (this.autoUnhealthyCooldownMs > 0 &&
    consecutiveFailures >= this.failureThreshold &&
    hasOtherHealthyCandidate) {
  // ... trigger auto-unhealthy
}
```

### Fix #3: 文档验证步骤改实

**问题**：文档写了 curl 调用 `/v1/runtimes`，但 API 层尚未实现。

**修复**：
- 改为使用 Node.js 直接调用模块的验证方式
- 新增 5 个可执行的测试脚本示例
- 明确标注哪些验证已实现，哪些依赖未实现的 API 层

## Changed Files

| File | Change |
|------|--------|
| `src/runtime/runtimePool.mjs` | Fix #1: enabled 计算考虑 state override；Fix #2: auto-unhealthy 增加保护逻辑 |
| `docs/RUNTIME_LIFECYCLE.md` | Fix #3: 验证步骤改为当前真实可用的 Node.js 调用方式 |
| `.ai/coord/handoffs/2026-04-08T094500+0800-c5-runtime-lifecycle-to-codex-main.md` | 更新 handoff，说明修复内容 |
| `.ai/agent-release-notes.md` | 追加修复记录 |

## 怎么验证

```bash
# 1. 语法检查
node --check src/runtime/runtimePool.mjs

# 2. 验证 effective enabled（修复 #1）
node -e "
import { buildRuntimePoolEntry } from './src/runtime/runtimePool.mjs'
const entry = buildRuntimePoolEntry({enabled: true}, {enabled: false, health_state: {}})
console.log('routing_status:', entry.routing_status)
console.log('enabled:', entry.enabled)
console.assert(entry.enabled === false, 'enabled should be false')
console.assert(entry.routing_status === 'disabled', 'routing_status should be disabled')
console.log('✓ Fix #1 verified')
"

# 3. 验证 auto-unhealthy 保护（修复 #2）
# 运行 docs/RUNTIME_LIFECYCLE.md 中的 test-auto-unhealthy-guard.js
```

## 剩余未做项

1. API 层：`/v1/runtimes` 端点（原计划 C1/C3 之后）
2. 真实 server runtime health check（docker/container state）
3. Session 迁移：drain 时的会话转移
4. Metrics 集成：与 stats/quota 系统联动
5. Cluster 感知：多 gateway 实例间状态同步

## 确认修复的 Blocking 问题

- [x] `enabled` 字段反映 effective state（state override 正确生效）
- [x] auto-unhealthy 不会把最后一个 healthy runtime 打掉
- [x] 文档验证步骤真实可用（不再引用未实现的 API）
- [x] 没有引入新的依赖
- [x] 没有回滚别人的改动
