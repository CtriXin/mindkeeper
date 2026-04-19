# CLAUDE.md - agent-spec

本文件给 `Claude` 在 `agent-spec/` 内工作时使用。

## First Read

开始前按这个顺序读：

1. `/Users/xin/auto-skills/CtriXin-repo/HANDBOOK.md`
2. `README.md`
3. 目标 role card（`roles/*.md`）

不要跳过项目上下文，直接改 role 定义。

## Scope

`agent-spec/` 只负责 reusable role cards：
- 定义角色是谁
- 定义角色看什么输入
- 定义角色交付什么输出
- 定义角色边界、handoff 与约束

它**不负责**：
- runtime orchestration
- provider wiring
- execution pipeline
- message transport

## Release Handoff

每次完成一轮**已落地改动**后，都要把摘要追加到：

`./.ai/agent-release-notes.md`

要求：
- 只追加，不覆盖旧记录
- 该文件保持在 `.gitignore` 中
- 每条至少包含：
  - timestamp
  - agent name
  - landed commit / tag / release（如有）
  - changed file scope
  - concise landed summary
  - reusable release-note bullets
  - validation run and result

在准备 version bump、tag、共享 release summary 之前，先读这个文件。

## Editing Rules

- 改 `roles/*.md` 时，优先保持 role boundary、input/output contract、handoff 语义一致
- 如果一个 role card 同时包含 human-readable 说明和 machine-consumable contract，不要只改一半
- 如果缺少项目级规则文件，优先补齐 `CLAUDE.md` / `AGENTS.md` / `.gitignore` / `./.ai/agent-release-notes.md`
- 不要把 runtime 设计塞回 role card，除非这个 role 本身就在声明 agent contract

## Done Definition

这类改动完成时，应满足：
- 目标 role card 已落地更新
- 项目级规则文件仍一致
- `./.ai/agent-release-notes.md` 已追加本轮记录
- 本轮验证结果已写明
