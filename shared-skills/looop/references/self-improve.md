# Looop Self-Improve

Looop 可以学习，但只能学习可追溯的东西：真实运行证据、验证日志、项目 postmortem、官方文档、源码、已知工具/skill 的稳定行为。

This borrows three proven local patterns:

- `scmp-self-improve`: capture first, classify, then promote selectively; keep the main skill short.
- `hive-self-improve`: store evidence in a fixed location, fingerprint recurring issues, rank by priority/frequency/recency.
- `looop`: keep the run moving, but leave enough structured evidence for another agent to recover and improve the next run.

## What To Learn

- 真实 loop 失败模式：跑偏、空转、429 后丢上下文、验证不足、后台进程未停、commit 污染、并行改动冲突。
- 可迁移执行策略：更小 slice、更清晰 stop condition、更好的 debugger prompt、更可靠的 recovery 证据。
- 外部项目经验：Codex `/goal`、GNHF、debug skill、multi-review、pilot、executor、issue-recorder、web-access 等能被验证的机制。

## How To Learn

Use:

```bash
python3 /Users/xin/auto-skills/shared-skills/looop/scripts/controller.py learn \
  --source "source name or URL" \
  --summary "one reusable lesson" \
  --evidence "what was observed or verified" \
  --tag loop \
  --lesson-type candidate \
  --priority P2 \
  --promote-candidate
```

Rules:

- Prefer primary sources and local run evidence.
- For current external tools or changing APIs, use web-access before recording conclusions.
- Do not promote a lesson into `SKILL.md` after one anecdote unless it fixes a P0/P1 safety issue.
- Promote recurring lessons after at least two real runs or one directly verified source plus one local validation.
- Keep `SKILL.md` lean; detailed patterns belong in references.

## Classification

Use SCMP-style promotion buckets:

- `one-off`: keep as run memory only.
- `candidate`: fresh lesson, promising but not promoted.
- `reusable-detail`: validated and likely useful again; keep in references.
- `stable-default`: short, cross-project, expensive to forget; eligible for `SKILL.md`.

Use Hive-style priority:

- `P0`: active blocker or safety issue.
- `P1`: high-value recurring waste.
- `P2`: useful improvement.
- `P3`: observation only.

Looop computes a learning fingerprint from `lesson_type + summary + tags` unless one is provided. Repeated fingerprints are marked duplicate so future review can count recurrence without bloating the log.

## Promotion Gate

A learning can become a stable Looop rule only when:

- it has concrete evidence in `learnings.jsonl`, `notes.md`, validation logs, or source links
- it reduces a real loop failure mode
- it does not weaken safety around user changes, credentials, destructive git, billing, or production
- it still works when another agent resumes from scratch

## Review Cadence

Run a promotion review when any of these is true:

- unresolved `P0` learnings exist
- `P1` duplicates recur across 2+ real runs
- there are 8+ unreviewed candidate learnings
- the last Looop self-improve review is older than 7 days
- the user explicitly asks to upgrade Looop behavior

Promotion review should rank by priority, frequency, recency, and blast-radius reduction. Promote only the strongest one to three lessons per pass.

Maintenance note: added by `web agent` (`Role: coordinator`) on 2026-05-08.
