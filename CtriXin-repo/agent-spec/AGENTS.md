# AGENTS.md - agent-spec

This file applies to both `Codex` and `Claude` when working inside `agent-spec/`.

## Release Handoff

- After each landed iteration, append a record to `./.ai/agent-release-notes.md`.
- Keep that file ignored in this project's `.gitignore`; it is local release-prep context.
- Each record should include:
  - timestamp
  - agent name
  - landed commit / tag / release, if any
  - changed file scope
  - concise landed summary
  - reusable release-note bullets
  - validation run and result
- Before preparing a version bump, tag, or shared release summary, read this file first.

## Read Order

1. `/Users/xin/auto-skills/CtriXin-repo/HANDBOOK.md`
2. `README.md`
3. the target role card under `roles/`

Do not jump straight into editing role definitions without reading the project context first.

## Scope

`agent-spec/` defines reusable role cards only.
It does not own runtime orchestration, provider wiring, or execution pipelines.
