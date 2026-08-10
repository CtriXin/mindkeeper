# Auto-Skills Project Structure v1

This document is the project-level structure baseline for future incremental reads. It supersedes the old deployment-only architecture overview as the first file to read when resuming system work.

## Snapshot

| Field | Value |
| --- | --- |
| Baseline time | 2026-06-12T01:42:03Z |
| Repo root | `/Users/xin/auto-skills` |
| Branch | `feature/worktree-management` |
| Baseline HEAD | `7624b927244ee250886b785881cf63e1e6691a3b` |
| HEAD commit time | `2026-05-08T19:03:37+08:00` |
| HEAD subject | `feat(looop): export brainkeeper checkpoints` |
| Baseline source docs | `/Users/xin/Library/Mobile Documents/com~apple~CloudDocs/ARCHITECTURE_REDUCTION_LEDGER_2026-06-11.md`, `/Users/xin/Library/Mobile Documents/com~apple~CloudDocs/ARCHITECTURE_REDUCTION_REVIEW_2026-06-11.md` |

Working tree note: the repo is dirty at this snapshot, but the Mission Control surgery candidate paths checked in this pass were clean: `shared-skills/mission-control`, `CtriXin-repo/review-hub`, `CtriXin-repo/interview`, `CtriXin-repo/digger`, `CtriXin-repo/redline-guard`, `CtriXin-repo/level-up`, and `CtriXin-repo/mommy`.

## Incremental Read Protocol

For the next iteration, do not reread the whole repo by default.

1. Read this file first.
2. Check `git status --short` and compare current `git rev-parse HEAD` with the baseline HEAD above.
3. If the HEAD or relevant files changed, read only changed paths plus the owning module docs.
4. For Mission Control work, treat `shared-skills/mission-control/references/work-contract.json` as executable truth; `SKILL.md` is operating guidance.
5. For review-flow work, read the specific adapter docs only: `review-hub`, `digger`, `redline-guard`, `level-up`.
6. If fresh-session continuity is needed, read `.agent.local/continuity/pickup.md`, `active.json`, then the active checkpoint.

## Architecture Principle

The reduction direction is consistent with the 2026-06-11 architecture reduction docs:

```text
One lifecycle authority.
One runtime authority.
One knowledge authority.
One continuity authority.
One source authority.
One verification authority.
One evidence archive.
Domain ops only where truly domain-specific.
```

Do not add another top-level coordinator unless one existing top-level coordinator is retired.

## Authority Map

| Authority | Owner | Role |
| --- | --- | --- |
| Task lifecycle | Mission Control | Classify, route, block, resume, close task phases. |
| Runtime/model/session | MMS | Model/provider/protocol/session/rescue authority. |
| Durable knowledge | xmem | Verified/inferred/stale facts, invariants, pitfalls, preflight blockers. |
| Continuity state | Handover / agent continuity v1 | Active task, pickup, owner, next action, checkpoint source of truth. |
| Source/requirements | Creator Gate inside Mission Control | Source accounting, source pack, requirement ledger, acceptance contract. |
| Verification/done claim | Work Gate inside Mission Control | QA, atomic checks, manual_pending, closeout status. |
| Scoped implementation | Executor / current coding agent | Edit only inside allowed scope and evidence packet. |
| Evidence archive | Issue Recorder | Timeline, source, fix evidence, verification, reusable lessons. |
| Domain ops | SCMP Ops, Feishu Ops | Deploy/source/read-back only for their domain. |
| Review evidence | Review Hub, Digger, Redline Guard | Produce review/audit evidence; do not own final done or deploy authority. |
| Experiment loop | Level Up | L3 local autopilot and PR packet evidence; not merge/deploy authority. |

## Core Flow

```text
User
  -> Mission Control
     -> xmem preflight when history/domain risk matters
     -> Handover when continuity/resume matters
     -> Creator Gate/source gates when source-backed
     -> Executor/current agent for scoped implementation
     -> Work Gate for done-state verification
     -> Issue Recorder for evidence archive
     -> SCMP Ops/Feishu Ops only for domain-specific operations
```

Fast local task:

```text
User -> Mission Control fast lane -> scoped implementation -> local validation -> scoped diff -> secret scan -> closeout
```

Source-backed task:

```text
User -> Mission Control -> source pack -> source manifest -> requirement ledger -> QA/source review -> executor packet -> implementation -> Work Gate -> Issue Recorder
```

PR/deploy task target:

```text
VERIFY local -> create PR/MR -> Digger -> Review Hub post optional -> Redline Guard -> human/ops merge approval -> SHIP/deploy -> production verify
```

## Current Mission Control Shape

Mission Control is a contract-driven phase runner:

```text
INTAKE -> DECOMPOSE -> LOCATE -> EXECUTE -> VERIFY -> SHIP -> DONE
```

Current observed scale:

| Surface | Observed shape |
| --- | --- |
| Contract | `work-contract.json`: 7 phases, 56 gates, 9 task types, 4 workflow modes. |
| Runner | `scripts/work_runner.py`: large monolith, about 11.7k lines. |
| Dashboard | `scripts/mission_dashboard.py`: generated Chinese dashboard view layer, not source truth. |
| Tests | `scripts/test_work_enforcement.py`: behavior contract tests, about 1.5k lines. |

Health notes from the 2026-06-12 inspection:

- `work_runner.py init --mode fast "small bugfix"` worked and classified `bugfix`.
- `doctor --drift --json` had latency/no-progress risk in interactive use.
- Full enforcement tests did not finish within a short interactive timeout.
- The runner is useful but has become a hotspot; surgery should add narrow gates/adapters before broad refactors.

## Review And PR Gate Model

Review capabilities should be layered, not centralized into a new coordinator.

| Capability | Correct layer | Notes |
| --- | --- | --- |
| `interview` | Mission Control front gate | Lightweight execution-shape questions; not a heavy workshop. |
| `review-hub` | Managed review request/evidence adapter | Phase-based multi-model fanout; can use OpenCode worker plans. |
| `digger` | PR/MR reviewer and validation evidence | CodeRabbit-like CI reviewer; not final merge gate. |
| `redline-guard` | Final pre-merge readiness gate evidence | Reports `mergeable`, `needs-review`, `blocked`, or `unknown`; never merges/deploys by default. |
| `level-up` | L3 experiment/autopilot runtime | Generates PR packet/evidence; should not own Mission Control policy. |
| `mommy` | Shallow conversational front door | Can route to Mission Control but should not become a lifecycle authority. |

## Planned Surgery Priority

### P0: Structure Baseline

Status: this document.

Goal: avoid fresh sessions rereading the whole project; establish current authority map and next read order.

### P1: `interview-intake` Gate

Status: implemented in working tree on 2026-06-12.

Add a Mission Control front gate before `startup-intake`.

Proposed artifacts:

```text
<artifact-root>/.mission/interview-intake.json
<artifact-root>/.mission/interview-intake.md
```

Questions it may ask or default:

- full flow vs dispatch/review-only
- stop at gate packet vs continue implementation
- deploy allowed vs human approval required
- PR review required before deploy
- review-hub pre/mid/post enabled
- failure policy: auto-fix loop vs stop for human

Stop states:

```text
ready
needs-human
dispatch-only
deploy-blocked
review-required
```

### P2: Flow Weight Reduction And Stop Policy

Status: next.

Recent issue-recorder evidence shows small fixes are often pulled into full source, visual, ad, and deploy evidence chains. Fix that before adding more review fanout.

#### P2a: `qa_stop_policy`

Make QA/review blocking explicit instead of scattering it across `review_policy`, `stop_conditions`, and individual gates.

Candidate values:

```text
none
advisory
stop-before-execute
stop-before-ship
stop-on-review-fail
manual-approval-required
```

This policy should be written by `interview-intake` and consumed by later Review Hub, Digger, Redline, Work Gate, and SHIP gates.

#### P2b: Tiny/Small Fix Lane

Add a genuinely light lane for scoped fixes that are not source-backed, visual-risk, ad-runtime, telemetry, PR, or deploy tasks.

Candidate hard gates:

```text
classification
interview-intake
git-status
local-validation
scoped-diff
secret-scan
```

Do not run source-pack, requirement-ledger, QA check-spec, work-gate closeout, issue-recorder closeout, or Review Hub unless the task explicitly asks for them or risk classifiers require them.

#### P2c: `check --gate all` Required-Only Default

Change `check --gate all` to run required gates by default. Advisory gates should require an explicit flag such as `--include-advisory`.

#### P2d: Scoped Production Closeout

For scoped one-domain config, header, ad-removal, and small production fixes, production target/control verification should be reportable success. Recorder closeout, unrelated runtime families, telemetry, lazy-load, click, and ad-family gates should stay `not_applicable_with_reason` or archival pending unless the shared runtime changed or the user asked for audit closure.

### P3: Review Hub Managed Gates

Add Mission Control gates that create and consume Review Hub requests without copy-paste prompts, after P2 stops making small fixes heavy.

Candidate gates:

```text
review-hub-pre
review-hub-mid
review-hub-post
review-hub-aggregate
```

OpenCode bridge:

```text
Mission Control -> review-hub request --artifact-mode mission-control -> review-hub worker-plan --runner opencode -> OpenCode subagents -> review-hub aggregate -> Work Gate evidence
```

### P4: PR Review / Redline Pre-Ship Lane

Add resumable PR/MR gates after local verify and before deploy.

Candidate gates:

```text
pr-created
digger-review
redline-guard
pre-ship-approval
```

States:

```text
PR_REVIEW_WAITING
DIGGER_BLOCKED
REDLINE_BLOCKED
REDLINE_MERGEABLE
SHIP_ALLOWED
```

Resume rule: blocked review sends the task back to `EXECUTE`; mergeable review can advance to `SHIP` only when human/ops policy allows it.

### P5: Level Up Boundary Cleanup

Keep `level-up` as an experiment loop and PR packet producer. Do not let `level-up` become a second Mission Control. It may call `redline-guard` as an adapter, but Mission Control owns lifecycle, merge/deploy policy, and closeout state.

### P6: Runner Refactor After Gates Exist

Only after P2-P4 are working, split `work_runner.py` by stable ownership:

```text
contract loading and classification
artifact IO
source and coverage gates
visual and UI gates
review and PR gates
ship and deploy gates
dashboard adapter
```

Do not start with a broad runner refactor; add gates narrowly, then extract repeated patterns with tests.

## Module Disposition Summary

| Module group | Direction |
| --- | --- |
| Mission Control | Keep as single lifecycle authority; slim over time. |
| Creator Gate / Work Gate | Absorb as Mission Control internal source/verification gates. |
| Review Hub | Promote over Multi Review as review lane adapter/evidence producer. |
| Multi Review | Retire or absorb after Review Hub is stable. |
| Digger / Redline Guard | Use after PR/MR; feed evidence into pre-ship gate. |
| Level Up | Keep as L3 experiment loop, not a lifecycle coordinator. |
| Mommy / Interview | Use as light front doors; only Mission Control owns lifecycle. |
| Hive / Mobius / Pilot / Looop | Downgrade to optional lab/tool/special mode; not default top-level authority. |
| xmem / Handover | Keep as knowledge and continuity authorities. |
| SCMP / Feishu Ops | Keep domain-specific authority only. |
| Domain Tool Core / SCMP Deploy / `bin/deploy` / `bin/push` | Ops/legacy toolkit; important operationally, not project-level lifecycle authority. |

## Legacy Ops Components

The original architecture centered on:

```text
Excel/domain config -> domain-tool-core -> JSON config -> SCMP deploy -> live service
Git repo -> push script -> version bump -> deploy script -> SCMP
```

That system remains useful, but it is now an Ops subgraph under SCMP/domain work. It should not define the whole auto-skills architecture.

Relevant paths:

```text
bin/deploy
bin/push
domain-tool-core/
scmp-deploy/
```

## Update Rule

When the next architecture iteration lands:

1. Update the snapshot block with new HEAD, branch, repo time, and dirty-scope note.
2. Append only meaningful changes to the planned surgery section.
3. Keep this file conclusion-first and authority-focused.
4. If an implemented gate changes project conventions, update the owning skill doc or `work-contract.json` in the same change.
5. Do not add new top-level workflow names unless one existing coordinator is retired or explicitly downgraded.
