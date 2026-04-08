# Cleanup Audit — 三分类审计结果

**执行时间**: 2026-04-08T091848+0800
**执行范围**: `/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker`

---

## 一、删除（DELETE）

| 文件/目录 | 理由 |
|-----------|------|
| `demo.txt` | 临时测试文件，内容仅为 "worker wrote this"，无保留价值 |
| `tmp/hello.txt` | 临时测试输出，无保留价值 |
| `tmp/runner-e2e.txt` | E2E 测试临时输出 |
| `tmp/runner-smoke.txt` | Smoke 测试临时输出 |
| `tmp/test-mms.txt` | MMS 测试临时输出 |
| `tmp/worker-bash.txt` | Worker 测试临时输出 |
| `tmp/worker-via-runner.txt` | Worker 测试临时输出 |
| `tmp/smoke-official-proxy.mjs` | 临时 smoke 脚本，已被正式入口替代 |
| `tmp/test-mms-config.toml` | 临时测试配置 |
| `tmp/proxy-dumps/` | 包含 4 个 JSON 调试 dump（anthropic/remote request-response），属于调试产物 |
| `tmp/proxy-dumps2/` | 同上，重复的调试 dump 目录 |
| `tmp/proxy-dumps5/` | 同上，重复的调试 dump 目录 |
| `tmp/npm-pack/` | npm 打包产物（16.4MB tgz + package 目录），属于构建产物 |
| `tmp/native-dist/claude` | 189.5MB native binary 分发文件，属于下载产物 |
| `tmp/mms-live-demo/mms-config/` | 临时 demo 配置 |
| `tmp/mms-live-demo/cc-broker-session-registry.json` | 临时 session registry |
| `tmp/mms-live-demo/run-mms-broker-live.py` | 临时 demo 脚本 |
| `tmp/mms-mock-demo/mms-config/` | 临时 mock demo 配置 |
| `tmp/mms-mock-demo/cc-broker-session-registry.json` | 临时 session registry |
| `tmp/mms-mock-demo/run-mms-broker-demo.py` | 临时 mock 脚本 |
| `tmp/runner-patch/sample.txt` | 临时测试文件 |
| `tmp/runner-tests/demo.txt` | 临时测试文件 |
| `.tmp/official-dumps/` | 空目录或官方 dump 产物 |
| `.claude/settings.local.json` | 本地 IDE 设置，不应提交 |

**删除优先级**: 全部可安全删除，无任何源码或设计文档

---

## 二、归档（ARCHIVE）

| 文件/目录 | 理由 | 归档建议 |
|-----------|------|----------|
| `tmp/diagrams/broker-turn-sequence-outline.md` | 设计草稿，已生成 `.html/.mmd` 产物 | 归档至 `docs/archive/diagrams-drafts/` |
| `tmp/diagrams/broker-role-explainer-outline.md` | 设计草稿，已生成 `.html/.mmd` 产物 | 同上 |
| `tmp/diagrams/current-vs-target-architecture-outline.md` | 设计草稿，已生成 `.html/.mmd/.svg` 产物 | 同上 |
| `tmp/diagrams/*.html` | 渲染产物 | 可选归档，或仅保留 `.mmd` 源文件 |
| `tmp/diagrams/*.mmd` | Mermaid 源文件 | 建议保留或归档至 `docs/diagrams/` |
| `tmp/diagrams/current-vs-target-architecture.svg` | 最终 SVG 图 | 可考虑移至 `docs/assets/` 供文档引用 |

**归档说明**:
- outline.md 是设计草稿，价值在于迭代过程，非最终产物
- .mmd 是图表源文件，有价值
- .html/.svg 是渲染产物，可重新生成

---

## 三、保留（KEEP）

| 文件/目录 | 理由 |
|-----------|------|
| `src/official/*` | 核心官方集成代码（8 个 mjs 文件） |
| `src/session/*` | Session 管理核心代码（3 个 mjs 文件） |
| `src/runner/*` | Runner 核心代码 |
| `src/shared/*` | 共享工具代码 |
| `src/config.mjs` | 核心配置模块 |
| `src/index.mjs` | 主入口 |
| `docs/*.md` | 主设计文档（9 个文档） |
| `.ai/coord/*` | 协作元数据 |
| `.ai/iterations/*` | 迭代记录 |
| `sessions/broker/` | Session registry 数据 |
| `sessions/contracts/` | Contract 定义 |
| `sessions/demo/` | Demo 数据 |
| `sessions/mcp/` | MCP 配置 |
| `sessions/mms/` | MMS 配置 |
| `sessions/official/` | Official session 数据 |
| `sessions/remote/` | Remote 配置 |
| `sessions/runner/` | Runner 配置 |
| `sessions/shared/` | 共享 session 数据 |

---

## 四、建议加入 `.gitignore`

当前 `.gitignore` 缺失以下条目：

```diff
 .DS_Store
 node_modules/
 dist/
 coverage/
 .mcp.json
 .ai/agent-release-notes.md
+
+# 临时文件与调试产物
+tmp/
+.tmp/
+
+# 本地设置与 registry
+.claude/settings.local.json
+sessions/*/cc-broker-session-registry.json
+
+# 构建与下载产物
+*.tgz
+*.tar.gz
+native-dist/
+npm-pack/
+proxy-dumps*/
+
+# Demo 脚本与临时配置
+*.py
+tmp/**/*.toml
+tmp/**/*.txt
```

---

## 五、执行建议

### 第一阶段（安全删除）
```bash
# 临时测试文件
rm demo.txt
rm tmp/*.txt tmp/*.mjs tmp/*.toml

# 调试 dump 目录
rm -rf tmp/proxy-dumps tmp/proxy-dumps2 tmp/proxy-dumps5

# 构建/下载产物
rm -rf tmp/npm-pack tmp/native-dist

# 临时 demo 目录
rm -rf tmp/mms-live-demo tmp/mms-mock-demo tmp/runner-patch tmp/runner-tests

# 空目录
rm -rf tmp/official-dumps .tmp/official-dumps

# 本地设置
rm -f .claude/settings.local.json
```

### 第二阶段（归档）
```bash
# 创建归档目录
mkdir -p docs/archive/diagrams-drafts

# 移动 outline 草稿
mv tmp/diagrams/*-outline.md docs/archive/diagrams-drafts/

# 可选：移动图表源文件到正式目录
mkdir -p docs/diagrams
mv tmp/diagrams/*.mmd docs/diagrams/ 2>/dev/null || true

# 可选：移动最终 SVG 到资源目录
mkdir -p docs/assets
mv tmp/diagrams/*.svg docs/assets/ 2>/dev/null || true
```

### 第三阶段（更新 .gitignore）
- 见上方建议条目

---

## 六、空间回收估算

| 类别 | 估算大小 |
|------|----------|
| `tmp/native-dist/claude` | ~190 MB |
| `tmp/npm-pack/*.tgz` | ~16 MB |
| `tmp/proxy-dumps*/` | ~2 MB |
| 其他临时文件 | < 1 MB |
| **合计** | **~209 MB** |

---

## 七、风险提示

- **无风险**: 所有删除目标均为临时文件、调试产物、构建产物
- **已排除**: `src/official/*`, `src/session/*`, `docs/*`, `.ai/coord/*`, `.ai/iterations/*` 均未触碰
- **可逆性**: 删除的文件均可重新生成或从 git 历史恢复（如果已提交过）
