# zhiji TODO — 四象限

> 最后更新：2026-03-25

---

## 🔴 紧急且重要（本周）

### 1. 建立 ~/.sce/ 目录结构
- [ ] 创建 6 层目录
- [ ] 创建 identity.json（吸收 SOUL.md 理念）
- [ ] 创建 beliefs/SUMMARY.md 模板
- [ ] 创建 HIGHLIGHTS.md 模板

### 2. 实现 📌 pin 机制
- [ ] 识别 "📌" 或 "pin this" 触发词
- [ ] 写入 ~/.sce/highlights/HIGHLIGHTS.md
- [ ] 格式：`- **标题** — 内容 [日期] [来源]`

### 3. Claude Code 集成
- [ ] 配置 MCP server 到 ~/.claude/settings.json
- [ ] 测试 brain_search / brain_store 工具
- [ ] SessionStart hook 自动加载 SUMMARY.md

---

## 🟡 重要不紧急（本月）

### 4. 实现信号采集（from self-evolution）
- [ ] 定义 4 类信号：Failure / Missing / Inefficiency / Suggestion
- [ ] 排除规则：闲聊、权限限制、一次性问题
- [ ] 格式：`[日期] [类型] 描述 | session | 关键词`

### 5. 实现学习回路状态机
- [ ] Capture: hooks + 手动触发
- [ ] Distill: evidence → observation
- [ ] Reflect: 为什么？可复用吗？
- [ ] Promote: observation → belief（需 gate）
- [ ] Compile: 生成 Thread Capsule
- [ ] Act: capability + policy gate
- [ ] Maintain: 衰减 + 验证 + 归档

### 6. 写 Spec 文档
- [ ] pcs-core-spec-v0.1.md
- [ ] continuity-contract.md
- [ ] learning-loop-spec.md

### 7. 定期知识下沉
- [ ] Daily: evidence 聚合
- [ ] Weekly: WEEKLY_SUMMARY.md
- [ ] Monthly: promote 到 belief
- [ ] Yearly: YEARLY_SUMMARY.md + 归档

---

## 🟢 紧急不重要（委派/快速处理）

### 8. 文档同步
- [ ] 更新 zhiji README 反映最新架构
- [ ] 同步 PROJECT_CARD.md
- [ ] 确保 CONTRIBUTING.md 完整

### 9. 代码清理
- [ ] 移除 dist/ 中的旧文件
- [ ] 确认 .gitignore 完整
- [ ] pnpm build 测试通过

---

## ⚪ 不紧急不重要（Later / Maybe）

### 10. 高级功能
- [ ] Weibull 衰减实现
- [ ] 信任层级 (trusted / quarantined / hostile)
- [ ] Preheater 预热器
- [ ] Thread Capsule 编译器

### 11. 可视化
- [ ] Web UI 查看记忆
- [ ] 知识图谱展示
- [ ] 时间线视图

### 12. 跨设备同步
- [ ] 云端 sync 方案设计
- [ ] 冲突解决策略
- [ ] 隐私分级（sync: true/false）

### 13. 评估框架
- [ ] effectiveness metrics
- [ ] efficiency metrics
- [ ] safety metrics
- [ ] learning quality metrics

---

## 已完成 ✅

- [x] 架构设计：SCE/PCS 分离
- [x] 6 类认知对象定义
- [x] 7 段学习回路定义
- [x] 项目命名：zhiji (知己)
- [x] Git 仓库建立
- [x] README / PROJECT_CARD / CONTRIBUTING
- [x] 10 项目 + 8 论文研究综合
- [x] agent-rules 链接到 mms

---

## 下一步行动

**现在**：执行 🔴 第 1 项 — 建立 ~/.sce/ 目录结构
