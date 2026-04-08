# Cleanup Audit

**最新审计时间**: 2026-04-08T091848+0800
**完整报告**: `.ai/coord/handoffs/2026-04-08T091848+0800-cleanup-agent-to-codex-main.md`

---

## 已执行的最小安全清理
- 删除 `.DS_Store` 一类无价值系统垃圾文件
- 删除空的临时目录

---

## 三分类审计结果

### 删除（DELETE）— 可直接执行

| 文件/目录 | 理由 |
|-----------|------|
| `demo.txt` | 临时测试文件，内容仅为 "worker wrote this" |
| `tmp/hello.txt` | 临时测试输出 |
| `tmp/runner-e2e.txt` | E2E 测试临时输出 |
| `tmp/runner-smoke.txt` | Smoke 测试临时输出 |
| `tmp/test-mms.txt` | MMS 测试临时输出 |
| `tmp/worker-bash.txt` | Worker 测试临时输出 |
| `tmp/worker-via-runner.txt` | Worker 测试临时输出 |
| `tmp/smoke-official-proxy.mjs` | 临时 smoke 脚本 |
| `tmp/test-mms-config.toml` | 临时测试配置 |
| `tmp/proxy-dumps/` | 4 个 JSON 调试 dump |
| `tmp/proxy-dumps2/` | 重复调试 dump |
| `tmp/proxy-dumps5/` | 重复调试 dump |
| `tmp/npm-pack/` | npm 打包产物（16.4MB） |
| `tmp/native-dist/claude` | native binary（189.5MB） |
| `tmp/mms-live-demo/` | 临时 demo 配置与脚本，不属于主线实现资产 |
| `tmp/mms-mock-demo/` | 临时 mock demo 配置，不属于主线实现资产 |
| `tmp/runner-patch/` | 临时测试目录，当前只含 `demo.txt` |
| `tmp/runner-tests/` | 临时测试目录，当前只含 `sample.txt` |
| `.tmp/official-dumps/` | 空目录或官方 dump |
| `.claude/settings.local.json` | 本地 IDE 设置 |

**空间回收估算**: ~209 MB

### 归档（ARCHIVE）— 先迁移再决定是否删

| 文件/目录 | 建议 |
|-----------|------|
| `tmp/diagrams/*-outline.md` | 移至 `docs/archive/diagrams-drafts/` |
| `tmp/diagrams/*.mmd` | 移至 `docs/diagrams/` |
| `tmp/diagrams/*.html` | 可选归档（可重新生成），不必长期放在 `tmp/` |
| `tmp/diagrams/*.svg` | 移至 `docs/assets/`，作为可直接预览的产物 |

### 保留（KEEP）— 核心资产

- `src/official/*` — 官方集成核心代码
- `src/session/*` — Session 管理核心代码
- `src/runner/*`, `src/shared/*`, `src/config.mjs`, `src/index.mjs`
- `docs/*.md` — 9 个主设计文档
- `.ai/coord/*`, `.ai/iterations/*`
- `sessions/` — 当前先保留；后续若持续为空目录，再单独处理

---

## 下一步建议

### 第一阶段：安全删除
```bash
rm -f demo.txt
rm -f tmp/hello.txt tmp/runner-e2e.txt tmp/runner-smoke.txt tmp/test-mms.txt
rm -f tmp/worker-bash.txt tmp/worker-via-runner.txt
rm -f tmp/smoke-official-proxy.mjs tmp/test-mms-config.toml
rm -rf tmp/proxy-dumps tmp/proxy-dumps2 tmp/proxy-dumps5
rm -rf tmp/npm-pack tmp/native-dist
rm -rf tmp/mms-live-demo tmp/mms-mock-demo tmp/runner-patch tmp/runner-tests
rm -f .claude/settings.local.json
```

### 第二阶段：归档整理
```bash
mkdir -p docs/archive/diagrams-drafts docs/diagrams docs/assets
mv tmp/diagrams/*-outline.md docs/archive/diagrams-drafts/
mv tmp/diagrams/*.mmd docs/diagrams/
mv tmp/diagrams/*.svg docs/assets/
```

### 第三阶段：更新 `.gitignore`
建议追加：
```
.tmp/
.claude/settings.local.json
*.tgz
tmp/proxy-dumps*/
tmp/npm-pack/
tmp/native-dist/
tmp/mms-live-demo/
tmp/mms-mock-demo/
tmp/runner-patch/
tmp/runner-tests/
```

## 不建议现在直接忽略整个 `tmp/`

原因：

- `tmp/diagrams/current-vs-target-architecture.mmd`
- `tmp/diagrams/current-vs-target-architecture.svg`

这类文件仍在当前主线讨论中被引用。应先迁移到 `docs/` 下正式位置，再考虑是否让 `tmp/` 整体忽略。

---

## 原始候选列表（已审计）

- [x] `demo.txt` → DELETE
- [x] `tmp/hello.txt` → DELETE
- [x] `tmp/runner-e2e.txt` → DELETE
- [x] `tmp/runner-smoke.txt` → DELETE
- [x] `tmp/test-mms.txt` → DELETE
- [x] `tmp/worker-bash.txt` → DELETE
- [x] `tmp/worker-via-runner.txt` → DELETE
- [x] `tmp/proxy-dumps*` → DELETE
- [x] `tmp/npm-pack/` → DELETE
- [x] 重复 diagram bundle → ARCHIVE

---

## 暂不动

- `src/official/*`
- `src/session/*`
- `docs/*` 中仍可能参与主线设计的内容
- stash 与历史 worktree
