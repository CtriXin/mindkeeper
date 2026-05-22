# Handoff: 15b — guard 收口 (filename intent + tool_result 收紧)

- 时间：2026-04-10T17:30+0800
- 执行者：manual fix
- 关联主线：feature/cc-official-broker-native-gateway-mainline

## 修复的两个漏洞

### 漏洞 1：filename/path 型写意图漏判
- 现象：`把 README.md 第一行改成 hello`、`在 src/foo.ts 里加一行` 不触发 local write guard
- 原因：`shouldRequireLocalFileMutationTool()` 只匹配 `file/文件` 关键词 + English verb，不识别路径型表达
- 修复：新增 `filenamePatterns` 数组，用 regex 匹配常见 filename extension + 中文/英文动词组合
- 文件：`src/official/upstreamProxy.mjs` ~line 528-539

### 漏洞 2：unresolved tool_result 误判为已完成
- 现象：history 裁剪后 tool_use_id 映射缺失时，unresolved tool_result + 最后一条 user message 是 tool_result → 错误放行 final
- 原因：`hasSatisfiedLocalExecution()` 有 fallback 分支：`evidence.unresolvedToolResults > 0 && latestMessageIsToolResultOnly(messages)` 为 true 就认为已完成
- 修复：删除 fallback 分支，只保留 `evidence.matchedToolResults > 0` 作为唯一判定标准
- 文件：`src/official/upstreamProxy.mjs` ~line 503-510

## 新增测试

| Case | 场景 | 预期 |
|------|------|------|
| 5 | `把 README.md 第一行改成 hello` + planner 返回 final | 409 拦截 |
| 6 | 写文件请求 + 只有 unrelated tool_result (Read) + planner 返回 final | 409 拦截 |
| 7 | `在 src/config.ts 里加一行` + planner 返回 tool_use(Edit) | 200，tool 映射到 runner apply_patch |

## 验证结果

- `node --check src/official/upstreamProxy.mjs` ✅
- `node --check scripts/test-official-proxy-local-exec-guard.mjs` ✅
- `node scripts/test-official-proxy-local-exec-guard.mjs` PASS (7/7) ✅
- `node scripts/test-runtime-id-upstream.mjs` ALL TESTS PASSED ✅

## Residual Risk

- filename intent regex 不覆盖所有变形表达
- `NotebookEdit` 等其他 mutating builtin 未纳入 guard
- regex 本身可能有 edge case 误触发（罕见路径词被当作 filename）
