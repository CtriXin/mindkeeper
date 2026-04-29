# Contributing to BrainKeeper

## 贡献方式

BrainKeeper 是开源项目，欢迎贡献！但为了保持项目质量和方向一致性，**所有贡献必须通过 Pull Request**。

## PR 流程

1. **Fork** 本仓库
2. 创建 feature branch: `git checkout -b feature/your-feature`
3. 提交改动（遵循 commit 规范）
4. 推送到你的 fork: `git push origin feature/your-feature`
5. 创建 **Pull Request**

## 什么样的 PR 会被接受

✅ **欢迎**：
- Bug 修复
- 文档改进
- 新的认知对象类型设计
- 学习回路优化
- 性能改进
- 测试覆盖

⚠️ **需要讨论**：
- 架构改动
- 新增依赖
- API 变更
- 大规模 recipe 重组或命名规范调整

❌ **不接受**：
- 直接 push 到 main
- 未经讨论的大规模重构
- 与项目方向不一致的功能

## Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: 新功能
fix: Bug 修复
docs: 文档
refactor: 重构
test: 测试
chore: 杂项
```

## Recipe 贡献约定

新增或整理 recipe 时，默认遵循下面的边界：

- 高频、跨项目、稳定复用的经验，可以新建独立 recipe
- 同一主题下的小补充，应优先并入现有 recipe，避免知识碎片化
- 项目专属经验应放进项目 recipe，不应塞进全局工具 recipe
- 只服务于一次任务的上下文，优先留在 thread / board，不要过早提升成 recipe

推荐命名：

- `rcp-brainkeeper-*`：BrainKeeper 自身与跨项目规则
- `rcp-lark-*`：Feishu / `lark-cli`
- `rcp-mms-env-*`：隔离环境 / `HOME` / 启动问题
- `rcp-<project>-*`：项目专属经验

## 行为准则

- 尊重他人
- 聚焦技术讨论
- 接受建设性反馈

---

*BrainKeeper — 真正懂你的 AI*
