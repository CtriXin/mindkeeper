# Task 03 · Single Agent

## 类型
- 单独任务
- 推荐：单个强 agent
- 难度：高级

## 目标
为主线 `official CLI -> self-hosted gateway -> server official runtime pool` 写一份 acceptance spec，只定义“做成算什么”，先不实现。

## 必答输出
1. happy path
2. auth path
3. sticky/session path
4. failure/recovery path
5. local tools 最小策略
6. telemetry/privacy 边界
7. 验收 checklist

## 强约束
- 必须结合现有仓库事实
- 必须引用现有文件路径
- 不要发明全新系统
- 默认本地复杂度最小化
- 默认服务器是唯一上游真相

## 结果回写位置
- `./.ai/coord/handoffs/<timestamp>-spec-agent-to-codex-main.md`
- `./docs/NATIVE_GATEWAY_MAINLINE_PLAN.md` 补充建议段落（如果你被允许直接编辑）
