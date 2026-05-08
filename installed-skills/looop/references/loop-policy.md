# Looop Policy

## Slice Loop

Each slice should be small enough to verify:

1. choose one concrete slice
2. record `begin_slice`; this captures the dirty worktree baseline
3. implement
4. run validation
5. run debugger pass
6. record `iteration-result`
7. decide commit gate
8. write milestone
9. update `next_action`

## Modes

- `hands-off`: use when the objective is bounded, the verification path is clear, and the agent should continue without steering until the stop condition is met or a real blocker appears.
- `companion`: use when the work is exploratory, design-heavy, research-heavy, or likely to need review between slices. Completion means "ready for host review", not automatic user acceptance.

In both modes, Looop must preserve user changes and avoid destructive cleanup. Never copy GNHF-style hard reset behavior into a shared dirty worktree.

## Iteration Result

After each meaningful slice, record:

- `success`: true only if this slice materially moved the objective forward.
- `summary`: one concise sentence.
- `key_changes_made`: logical outcomes, not a raw file list.
- `key_learnings`: facts future iterations would not know from prior notes.
- `validation`: command/result evidence or explicit reason validation could not run.
- `debugger`: blocker/risk review result.
- `should_fully_stop`: true only when the stop condition is fully met.

A complete no-op slice is not success. If there are no file changes and no new learning worth recording, mark it as failed/no-op, stop the loop, and relaunch with a narrower slice instead of spinning.

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
- The current slice started from a clean dirty baseline, or every baseline dirty file is explicitly handled outside auto-commit.
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
- patch snapshot path when a diff exists
- validation result
- debugger result
- blocker
- next action

## Recovery

After 429, interruption, compaction, or model confusion, recover from:

- `state.json`: current goal and next action
- `notes.md`: compact iteration results and learnings
- `events.jsonl`: chronological event log
- `milestones/*.md`: human-readable checkpoints
- `exit-summary.md`: closeout state for handoff/review
- commit history: safe rollback points

Do not depend on chat memory for recovery.

Maintenance note: created by `web agent` (`Role: coordinator`) on 2026-05-08.
