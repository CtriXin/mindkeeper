# Universal Agent Protocol — agent-spec/v1

All agents in this spec implement this protocol.
It enables standalone use, pipeline composition, and cross-agent handoff — without changing how the agent thinks or works.

---

## Design principles

- **Craft first**: the protocol is a transport layer, not an identity. An agent's judgment, taste, and rules are unchanged in both modes.
- **Standalone always works**: any agent can be invoked directly by a user with a natural language brief. The envelope is optional in standalone mode.
- **Pipeline is just structure**: in pipeline mode, the same agent accepts a structured brief and returns a structured result. Nothing else changes.
- **Escalation routes, not fails**: when an agent cannot proceed, it routes to a named agent with a reason — never silently stops.

---

## Invoke envelope

In **standalone mode**, the envelope is optional. Agents accept natural language or partial structured input directly from a user.

In **pipeline mode**, the envelope is required:

```json
{
  "_protocol": "agent-spec/v1",
  "_mode": "standalone | pipeline",
  "_from": "user | {agent_id}",
  "_session": "optional string — passed through unchanged",
  "brief": { }
}
```

`brief` contains the agent-specific input fields defined in each agent's own spec.

---

## Result envelope

All agents return this structure in pipeline mode:

```json
{
  "_protocol": "agent-spec/v1",
  "_agent": "{agent_id}",
  "_status": "done | escalate | partial",
  "_escalate_to": "agent_id | null",
  "_escalate_reason": "string | null",
  "_handoff": "agent_id | null",
  "_session": "echoed from invoke",
  "result": { }
}
```

`result` contains the agent-specific output fields defined in each agent's own spec.

---

## Status semantics

| Status | Meaning | Caller action |
|---|---|---|
| `done` | Task complete, full result available | Proceed to `_handoff` agent, or deliver to user |
| `escalate` | Cannot proceed — wrong inputs, missing context, or out of scope | Route to `_escalate_to` with `_escalate_reason` |
| `partial` | Result incomplete but usable — pipeline can continue with caveats | Proceed to `_handoff`, note `_escalate_reason` as a caveat |

---

## Mode behavior

|  | standalone | pipeline |
|---|---|---|
| Input format | Natural language or partial brief | Full structured `brief` inside envelope |
| Missing required inputs | Ask the user — do not guess | Return `"_status": "escalate"` with specific reason |
| Output format | Human-readable, conversational | Structured `result` inside envelope |
| Craft rules | Apply fully | Apply fully — identical quality bar |
| Tone | Professional, direct | Structured, precise |

**The craft rules, judgment criteria, and output quality bar are identical in both modes. The protocol is the wrapper, not the agent.**

---

## Composition rules

1. An agent receiving a pipeline invoke MUST echo `_session` in its result unchanged.
2. An agent may only escalate to an agent listed in its own spec's `_escalate_to` field.
3. `pipeline_context` (if present) must be passed through to the next agent without modification.
4. An agent MUST NOT invent outputs when inputs are insufficient — escalate instead.
5. A `partial` result includes a non-null `_escalate_reason` describing what is missing or incomplete.

---

## Handoff chaining

When `_status: "done"` and `_handoff` is non-null, the caller may automatically invoke the named agent with:

```json
{
  "_protocol": "agent-spec/v1",
  "_mode": "pipeline",
  "_from": "{current_agent_id}",
  "_session": "{echoed session}",
  "brief": { ...derived from current result... }
}
```

The calling orchestrator is responsible for mapping `result` fields to the next agent's `brief` fields.

---

## Agent type classification

### 判断标准

| 如果这个 agent 的核心价值来自… | 类型 |
|---|---|
| taste / judgment / craft / framing / 作者气质 | **Soul agent** |
| 检查 / 路由 / 对比 / gate / handoff / extraction | **Protocol agent** |

### Identity ordering rule（硬规则）

**Soul agents** — Prompt block 的前 2-4 行必须先建立 craft identity 和 judgment scope，再说 pipeline 位置：
1. 我是谁（职业身份 + 核心气质）
2. 我靠什么判断（craft philosophy）
3. 我在 pipeline 里的位置（最后补充）

**Protocol agents** — Prompt block 的前 2-4 行可以先建立执行角色和合约：
1. 我在流程里负责什么
2. 我的输入输出契约是什么
3. 我的 escalation 行为

违反这条规则的 agent，会把自己钉死在 pipeline 位置认知上，而不是判断/写作/设计认知上。

### Soul agents
- `writer-soul` — craft: long-form writing, taste, rhythm
- `designer-soul` — craft: design judgment, direction, anti-generic
- `copywriter` — craft: clarity, specificity, human-sounding copy
- `discussion-partner` — craft: structured thinking, pushback quality
- `strategist` — craft: SERP judgment, opportunity framing, architecture

### Protocol agents
- `challenger` — checks: edge cases, race conditions, security
- `architect` — checks: structural health, boundary clarity
- `subtractor` — checks: complexity reduction, deletion safety
- `audit` — gate: publish readiness, quality score
- `growth` — optimization: monetization, conversion, guardrails
- `authority` — extraction: off-page signals, outreach angles
- `image-slot` — resolution: visual slot planning and retrieval
- `evolution-memory` — persistence: memory distillation, rule promotion

---

## Agent registry (brief reference)

| Agent | Type | Primary escalate target |
|---|---|---|
| `strategist` | Upstream / Orchestrator-capable | — |
| `designer-soul` | Leaf / Design Specialist | `strategist` |
| `writer-soul` | Leaf / Writing Specialist | — |
| `copywriter` | Leaf / Content Execution | `strategist` |
| `frontend-architect` | Leaf / Implementation | `designer-soul`, `strategist` |
| `image-slot` | Leaf / Visual Resolver | — |
| `growth` | Leaf / Commercial Optimizer | `audit` |
| `audit` | Gate / Publish Decision | `strategist`, `designer-soul` |
| `authority` | Leaf / Off-page SEO | `strategist` |
| `challenger` | Leaf / Adversarial Reviewer | `architect` |
| `architect` | Leaf / Structural Reviewer | `subtractor` |
| `subtractor` | Leaf / Complexity Reducer | `architect` |
| `discussion-partner` | Interactive / Deliberation | — |
| `evolution-memory` | Memory / Persistence Layer | — |
