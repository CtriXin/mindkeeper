# agent-spec

这是 `CtriXin-repo` 根目录下的最小角色定义层。

它的作用很简单：
- 把常用 agent 角色沉淀成固定“角色卡”
- 让 Hive / discuss / a2a / designer 后续可以复用同一套定义
- 减少每次临时拼 prompt、靠记忆补角色关注点

它**不是**：
- runtime
- orchestrator
- 自动流引擎
- 消息桥接层

一句话：

> `agent-spec` 管“这个角色是谁、该看什么、该输出什么”；
> `hive` / `hive-discuss` / `agent-discuss` 管“这个角色怎么跑起来”。

## 现在它还多了什么

现在的 `agent-spec` 不只是角色卡集合，还多了两层统一约束：

- **agent taxonomy**：把 agent 分成 `Soul agent` 和 `Protocol agent`
- **universal protocol**：给 pipeline 调用一个统一的 invoke/result 信封

对应文件：
- `protocols/universal.md`
- `roles/*.md` 内各自的 Prompt block

这两层的关系是：
- `Soul agent` / `Protocol agent` 决定 Prompt block 开头该先写什么
- `agent-spec/v1` 决定 agent 之间怎么接线

## 现在怎么用

第一阶段先当共享角色卡使用。

## Agent 类型

`agent-spec` 现在分两类 agent，这不是文风偏好，而是硬规则。

### Soul agents

核心价值来自 `taste`、`judgment`、`craft`、`framing`。

这类 agent 的 Prompt block 前 2-4 行，必须先建立：
- 我是谁
- 我靠什么判断
- 然后才补充我在 pipeline 里的位置

当前包括：
- `writer-soul`
- `designer-soul`
- `copywriter`
- `discussion-partner`
- `strategist`

### Protocol agents

核心价值来自检查、路由、gate、handoff、extraction。

这类 agent 的 Prompt block 前 2-4 行，可以先建立：
- 我在流程里负责什么
- 我的输入输出 contract 是什么
- 我的 escalation / handoff 行为是什么

当前包括：
- `challenger`
- `architect`
- `subtractor`
- `audit`
- `growth`
- `authority`
- `image-slot`
- `evolution-memory`

一个直观理解：
- `writer-soul` 的第一反应应该是“这篇文章该怎么写”
- `audit` 的第一反应可以是“这份产出是否该放行”

## 通用协议怎么用

如果你是人工调用，可以直接给 agent 一个自然语言 brief。

如果你是 pipeline / orchestrator 调用，用 `agent-spec/v1`：

```json
{
  "_protocol": "agent-spec/v1",
  "_mode": "pipeline",
  "_from": "user",
  "_session": "demo-001",
  "brief": {
    "keyword": "best note taking app for students",
    "page_type": "comparison",
    "intent": "user wants a recommendation",
    "word_count": 1400
  }
}
```

返回结果统一是：

```json
{
  "_protocol": "agent-spec/v1",
  "_agent": "writer-soul",
  "_status": "done",
  "_escalate_to": null,
  "_escalate_reason": null,
  "_handoff": "image-slot",
  "_session": "demo-001",
  "result": {
    "title": "string",
    "body": "markdown"
  }
}
```

状态语义：
- `done`：完成，可交付或进入下游 handoff
- `escalate`：不能继续，必须路由到上游或指定 agent
- `partial`：结果不完整，但还能继续跑

## 两个最小示例

### 1. Soul agent：`writer-soul`

适合：你已经有比较清楚的 article brief，需要一个有判断力的 writer。

最小 pipeline 调用：

```json
{
  "_protocol": "agent-spec/v1",
  "_mode": "pipeline",
  "_from": "strategist",
  "_session": "article-42",
  "brief": {
    "keyword": "best budget mechanical keyboard",
    "page_type": "comparison",
    "intent": "buyer-intent",
    "word_count": 1800
  }
}
```

理解重点不是“它是 leaf-agent”，而是：
- 它先是 writer
- 再是带 judgment 的 specialist
- 最后才是 pipeline 节点

### 2. Protocol agent：`audit`

适合：你已经有页面或文章产物，需要一个明确的 publish gate。

最小 pipeline 调用：

```json
{
  "_protocol": "agent-spec/v1",
  "_mode": "pipeline",
  "_from": "writer-soul",
  "_session": "article-42",
  "brief": {
    "artifact": "<article markdown>",
    "task_goal": "publish-ready comparison article",
    "target_page_type": "comparison"
  }
}
```

这里 protocol-first 就合理，因为 `audit` 的价值本来就来自 gate 和 verdict。

人工调用时，直接用稳定角色名：
- `challenger`
- `architect`
- `subtractor`
- `discussion-partner`
- `designer-soul`
- `strategist`
- `copywriter`
- `writer-soul`
- `image-slot`
- `frontend-architect`
- `growth`
- `audit`
- `authority`
- `evolution-memory`

如果你记不住这些英文名，直接说中文意图也行：
- “找风险 / 找 bug” → `challenger`
- “看结构 / 看耦合” → `architect`
- “看哪里写多了 / 能不能简化” → `subtractor`
- “讨论一下方向 / 给我 pushback” → `discussion-partner`
- “先定设计方向 / 不要太 AI” → `designer-soul`
- “帮我做 SEO / 内容策略” → `strategist`
- “帮我写内容 / 改文案 / 去 AI 味” → `copywriter`
- “写一篇 SEO 能打、不要太 AI 的文章” → `writer-soul`
- “按关键词写长文并先自审” → `writer-soul`
- “用 writer-soul 的 comparison mode 写这篇” → `writer-soul`
- “用 writer-soul 先写，再输出 final check” → `writer-soul`
- “把这次反馈记成 evolution-memory 的规则候选” → `writer-soul` + `evolution-memory`
- “给文章配图 / 搜图 / 选图 / 筛图” → `image-slot`
- “把方向落成页面结构” → `frontend-architect`
- “做图文能力插槽” → `image-slot`
- “一个 key 用完自动试下一个” → `image-slot`

推荐图文链路：
- `writer-soul` → `image-slot` → `frontend-architect` → `audit`

如果只是写文，不要默认带上 `image-slot`；需要图文时再挂这个能力。

如果是实现层目录：
- 角色定义在 `agent-spec/roles/`
- 项目实现落在具体项目里，例如 `llm-creator-ops/lib/`

所以：
- `writer-soul` / `image-slot` 的角色卡在 `agent-spec`
- 真正的 API/provider/fallback 实现应在 `llm-creator-ops`

背景与维护说明仍在：
- `../agency-agents-notes/README.md`
- `../agency-agents-notes/ROLE_SYSTEM_HANDOFF.md`

它们不是主入口，只是给后续 agent 理解演化背景用。

- “把方向落成页面结构” → `frontend-architect`
- “看看怎么赚钱 / 怎么转化 / 广告怎么放” → `growth`
- “帮我做最终审核 / 能不能发” → `audit`
- “帮我想外链 / authority / PR 方向” → `authority`
- “帮我总结这轮经验 / 做 handoff” → `evolution-memory`

所以你以后不需要背角色名，直接说中文任务，我来映射。

一个常见工作流可以是：
- `strategist` → `designer-soul` → `copywriter` → `frontend-architect` → `growth` → `audit`
- 做站外补强时，再加 `authority`
- 做阶段收口时，用 `evolution-memory`


比如：
- 用 `challenger` 看边界条件和 bug 风险
- 用 `architect` 看结构是否扛得住变化
- 用 `subtractor` 看哪里写多了
- 用 `discussion-partner` 做方向讨论和 pushback
- 用 `designer-soul` 做设计方向判断
- 用 `strategist` 做 SEO / 内容 / 信息架构策略
- 用 `copywriter` 做高信号文案与页面内容展开
- 用 `frontend-architect` 把 design direction 落成页面实现方向
- 用 `growth` 看 monetization / conversion / ad layout
- 用 `audit` 做最终 publish gate
- 用 `authority` 看 off-page SEO / authority 获取
- 用 `evolution-memory` 做迭代记忆与 handoff 总结

## 后面怎么接到项目里

后续接线时按这个思路：
- `hive` / `hive-discuss`：逐步从这里读角色定义
- `agent-2-agent` / `agent-discuss`：减少 `SKILL.md` 里重复角色描述
- `designer`：把 `designer-soul` 作为可复用角色输出

## 目录

- `index.json`：角色索引
- `protocols/universal.md`：通用 invoke/result 协议、状态语义、agent taxonomy
- `roles/*.md`：每个角色一张卡

## 背景说明（只在需要时读）

日常使用时，**以 `agent-spec/` 为主入口**。

如果后续 agent 需要理解：
- 这套角色系统为什么要做
- 最初参考了什么
- 后续怎么继续维护和迭代

再读这些背景文件：
- `../agency-agents-notes/README.md`
- `../agency-agents-notes/ROLE_SYSTEM_HANDOFF.md`

也就是说：
- `agent-spec/` = 正式角色定义
- `agency-agents-notes/` = 背景与维护说明

未来 agent 默认先看 `agent-spec/`，只有需要历史背景时再去 `agency-agents-notes/`。
