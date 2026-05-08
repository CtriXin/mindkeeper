# Looop Policy

## Slice Loop

Each slice should be small enough to verify:

1. choose one concrete slice
2. record `begin_slice`
3. implement
4. run validation
5. run debugger pass
6. decide commit gate
7. write milestone
8. update `next_action`

## Debugger Pass

Use this prompt shape:

```text
Critically review this strategy. Identify concrete loopholes with plausible failure scenarios, rank by severity, propose fixes, then give a revised strategy and residual uncertainty. Do not claim 100% confidence unless every claim is directly verified.
```

Record only the result, not hidden reasoning:

- `debugger_status`: pass / blocked / residual-risk
- `p0_p1_blockers`: concrete blockers
- `residual_uncertainty`: what remains unknown
- `next_probe`: how to verify later

## Auto-Commit Gate

Auto-commit is allowed only when all are true:

- Looop is active.
- The current slice has a clear owner agent and role.
- Validation passed and the output was inspected.
- Debugger pass has no P0/P1 blocker.
- Dirty files are all owned by this slice/agent.
- There are no secrets, large unknown artifacts, dependency lock churn, generated caches, or unrelated files.
- The commit message contains `Agent:`, `Role:`, and `Looop-Slice:` footers.

Skip auto-commit when:

- parallel agents touched overlapping files
- the worktree contains unrelated dirty files
- validation failed or was not run
- debugger pass found a blocker
- the next action is destructive or externally visible

When skipping, write a milestone and include:

- touched files
- dirty files
- validation result
- debugger result
- blocker
- next action

## Recovery

After 429, interruption, compaction, or model confusion, recover from:

- `state.json`: current goal and next action
- `events.jsonl`: chronological event log
- `milestones/*.md`: human-readable checkpoints
- commit history: safe rollback points

Do not depend on chat memory for recovery.

Maintenance note: created by `web agent` (`Role: coordinator`) on 2026-05-08.
