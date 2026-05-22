# AGENTS.md

## Scope

本目录 `cc-consult-first/` 是一个 consult-first 实验目录。

目标：

- 让本地国产 LLM / 本地 `cc` 主导流程
- 把远端官方 `Claude Code` 收成 `consult brain`
- 明确 `device/workspace/session` 隔离
- 优先走最短可用 HTTP client，不等待 full broker runtime

## Release Note Handoff Rule

每次有已落地改动后，都要把本轮摘要追加到：

- `./.ai/agent-release-notes.md`

要求：
- 只追加，不覆盖
- 默认不进 git（见 `.gitignore`）
- 至少包含：时间、Agent、改动范围、摘要、可复用 bullets、验证结果

## Working Rules

- 始终用中文简体回复，technical terms 保持 English。
- 默认优先 consult-first，不把远端脑子伪装成本地主进程。
- 第一阶段只做最小可用，不提前引入 full agent loop。
- 保持 `device_id / workspace_id / session_id` 为一等公民。
- 如果后续要改成共享公共底座，再回头和上游项目对齐。
