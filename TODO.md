# BrainKeeper TODO — 四象限

> 最后更新：2026-03-28
> 活跃待办请看 board: `mk bd brainkeeper`

---

## 🔴 紧急且重要（本周）

### 1. lastVerified 入口
- [ ] brain_recall 后支持 "验证通过" 反馈，更新 recipe 的 lastVerified
- [ ] 考虑新增 brain_verify 工具或在 brain_learn 中支持 verify_only 模式

### 2. related 字段入口
- [ ] brain_learn 支持传入 related 参数（关联 recipe IDs）
- [ ] brain_recall 结果中展示 related recipes 提示

---

## 🟡 重要不紧急（本月）

### 3. 同义词表持续扩充
- [ ] 根据实际使用中的 miss 案例补充
- [ ] 考虑用户自定义同义词（~/.sce/brain/synonyms.json）

### 4. Bootstrap 推送阈值调优
- [ ] 当前阈值 0.5，需根据实际匹配质量调整
- [ ] 考虑 repo/framework 过滤（只推送同框架的 recipe）

### 4.1 Hive continuity support
- [ ] 为 Hive 补一层 continuity seed，优先服务 compact / interrupt / new session 恢复
- [ ] 先按 `docs/HIVE_CONTINUITY_TODO.md` 做轻量索引，不进入 Hive 主循环

### 5. Scale-Adaptive 学习深度
- [ ] 轻量模式：< 3 文件，evidence 直接存
- [ ] 标准模式：3-10 文件，capture → distill
- [ ] 完整模式：> 10 文件，7 段全走

### 6. 信号采集
- [ ] 定义 4 类信号：Failure / Missing / Inefficiency / Suggestion
- [ ] 排除规则：闲聊、权限限制、一次性问题

---

## 🟢 紧急不重要（快速处理）

### 7. 代码清理
- [ ] 移除旧 Unit 相关代码（storage.ts 中的 loadUnit/saveUnit/deleteUnit 等）
- [ ] 更新 package.json 版本到 2.1.0
- [ ] 确认 .gitignore 完整

---

## ⚪ 不紧急不重要（Later / Maybe）

### 8. 高级功能
- [ ] Weibull 衰减（替代当前的线性天数阈值）
- [ ] Thread Capsule 编译器
- [ ] Preheater 预热器

### 9. 可视化
- [ ] Web UI 查看 recipe 库和 board
- [ ] 知识图谱展示 recipe 关联
- [ ] 时间线视图

### 10. 跨设备同步
- [ ] 云端 sync 方案设计
- [ ] 冲突解决策略
- [ ] 隐私分级（sync: true/false）

### 11. 多人协作
- [ ] 共享 recipe 库（团队级）
- [ ] 个人 board vs 团队 board 隔离

---

## 已完成 ✅

- [x] v2.0: Recipe 驱动架构（steps/files/gotchas/corrections/changelog）
- [x] v2.0: 8 个 MCP 工具
- [x] v2.0: 四象限看板系统
- [x] v2.0: Thread 蒸馏与恢复
- [x] v2.1: Recall 语义升级（55+ 同义词/trigram/tags/缩写展开）
- [x] v2.1: Bootstrap 自动推送 recipe
- [x] v2.1: Recipe 衰减检测 + 自动降权
- [x] v2.1: Board 僵尸 item 检测
- [x] v2.1: Board-Thread-Recipe 三域关联
- [x] v2.1: brain_list 健康摘要
- [x] ~/.sce/ 目录结构
- [x] 📌 pin 机制
- [x] Procedure Markdown 格式
- [x] brainkeeper-guide "下一步建议"
- [x] Board aliases 字段支持
- [x] Bootstrap loadThreadDetails import 修复
- [x] v2.2: CLI 统一（mk rcp/bd/dst 简写、thread ID 完整显示）
- [x] v2.2: TTL 状态驱动（有待续 14d / 默认 7d）
- [x] v2.2: Checkpoint 多 repo 自动检测拆分
- [x] v2.2: Distill 后处理 hint（recipe候选 + board联动 + next→board）
- [x] v2.2: sce-hook-start 启动钩子验证通过
- [x] agent-rules 归档（精华迁至全局 CLAUDE.md）
