# MindKeeper — 项目规则

## 铁规

### 开源项目，禁止提交非公开内容

本项目是 MIT 开源项目，以下内容 **NEVER** 提交到 git：

- 营销文案（小红书、公众号、推广文稿）
- 海报/卡片 HTML 和截图 PNG
- 内部讨论记录、运营数据
- 任何含个人信息、内部链接的文件

这些文件只保留在本地，通过 `.gitignore` 隔离。如果误提交，必须立即从 git history 中清除。

### Commit 前必检

每次 commit 前必须 grep 检查以下关键词，发现即删或替换，**不得推送**：

- `/Users/xin` — 硬编码个人路径（注释中的通用示例用 `/Users/<user>` 替代）
- 内部 IP（如 `82.156.x.x`）
- `xiaohongshu`、`social/` — 营销内容
- `discuss-round` — 内部跨模型讨论记录

### 代码规范

- 保持 zero-load 原则：不加重运行时依赖
- 所有贡献必须通过 PR
- `dist/` 已入库，修改 `src/` 后必须同步 `npx tsc` 更新 `dist/`
- 测试必须通过：`pnpm test`
