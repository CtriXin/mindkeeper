# Task 02 · Single Agent

## 类型
- 单独任务
- 推荐：单个 agent
- 难度：中级

## 目标
审计 `cc-official-broker` 当前目录下的临时文件、示例文件、重复产物，给出“删除 / 归档 / 保留”三分类。

## 范围
- `/Users/xin/auto-skills-wt-cc-official-broker-native/CtriXin-repo/cc-official-broker`

## 必答输出
1. 三列表：删除 / 归档 / 保留
2. 每项都要有理由
3. 删除动作必须是可逆优先，不能先动关键源码/关键文档
4. 指出哪些目录后续应加入 `.gitignore`

## 强约束
- 当前不要直接执行大删除
- 不要碰：
  - `src/official/*`
  - `src/session/*`
  - `docs/*` 主设计文档
  - `.ai/coord/*`
  - `.ai/iterations/*`
- 重点看：
  - `tmp/`
  - `demo.txt`
  - 重复 diagrams / proxy dumps / npm-pack / smoke 文件

## 结果回写位置
- `./.ai/coord/handoffs/<timestamp>-cleanup-agent-to-codex-main.md`
- `./.ai/iterations/<latest>/CLEANUP_AUDIT.md`
