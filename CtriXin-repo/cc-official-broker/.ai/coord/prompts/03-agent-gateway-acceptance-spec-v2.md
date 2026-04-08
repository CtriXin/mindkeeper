# Task 03 · Single Agent · V2

## 类型
- 单独任务
- 推荐：单个强 agent
- 难度：高级

## 这是 review 后重派任务
- 上一版没有真正交付 acceptance spec
- 这次不接受只改任务板、只留聊天结论、或只补几段概念说明
- 必须产出一个明确的 spec 文档和 handoff 文件

## 目标
为主线 `official CLI -> self-hosted gateway -> server official runtime pool` 写一份真正可验收的 acceptance spec。

## 强制交付物
你必须至少产出这两个文件：

1. `./docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md`
2. `./.ai/coord/handoffs/<timestamp>-spec-agent-to-codex-main.md`

## Spec 必须包含的章节
1. `happy path`
2. `auth path`
3. `sticky / session path`
4. `failure / recovery path`
5. `local tools minimal policy`
6. `telemetry / privacy boundary`
7. `acceptance checklist`
8. `out of scope`

## 强约束
- 必须结合现有仓库事实
- 必须引用现有文件路径
- 不要发明全新系统
- 默认本地复杂度最小化
- 默认服务器是唯一上游真相
- 必须明确写出：
  - 哪些能力已经存在于 `cc-official-broker`
  - 哪些能力准备从 `cc-mcp-bridge` 抽取
  - 哪些内容暂时不做

## 最终 handoff 必须回答
1. 这份 spec 的一句话结论
2. 新增/修改了哪些文件
3. 还有哪些验收点仍未定义
4. 推荐先实现哪 3 项

## 结果回写位置
- `./docs/NATIVE_GATEWAY_ACCEPTANCE_SPEC.md`
- `./.ai/coord/handoffs/<timestamp>-spec-agent-to-codex-main.md`
