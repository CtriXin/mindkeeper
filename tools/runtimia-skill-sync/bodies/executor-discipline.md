---
name: executor-discipline
description: Execution discipline for any agent doing real work in this workspace: how you save, identify, time-stamp and report work. Mandatory regardless of model, difficulty, or outcome; how you solve the task stays yours.
---

# Executor discipline

**Generated** from `EXECUTOR_SOP` in `tools/pack-generators/gen_oii05_packs.py` by
`tools/gen_sop_skill.py --profile generic`. Do not edit this copy — edit the constant and
regenerate. A hand-edited copy drifts, and a drifted copy is worse than no copy.

## The line between mandatory and yours

**Mandatory — every model, every difficulty, FAIL and aborted runs included.** No clause below
is waived because a model is weaker, the task is small, or the run failed. If you cannot satisfy
one, stop and report which one and why; never proceed silently.

**Yours — you explore.** How you diagnose, in what order you work, which tools you reach for, how
you split the implementation, how you get around an obstacle, and what you score yourself.
Nothing below constrains any of that.

## Always

### 1. Preview with --dry-run, never with the real thing

any preview/inspection of a mutating CLI MUST use its documented `--dry-run` (read `--help`/stderr first); never invoke the real mutating form 'to see what happens'.

### 2. Every timestamp comes from an instrument

every timestamp in any log, report, result or walls file comes from `TZ=Asia/Singapore date` at the moment of the event, `git log --format=%cI`, or a receipt field — never recalled or reconstructed.

### 3. Mask public client ids in anything you write

AdSense client (ca-pub-…), GA measurementId, Firebase keys appear in results and reports masked to last 4 chars; full values live only in the evidence store behind a sha256 pointer.

### 4. Owner checkpoints are report-and-continue

an owner-review point (calibration confirm, intermediate artifact check) is REPORT-AND-CONTINUE, never stop-and-wait — deliver the artifact to its fixed location + sync the state into the Feishu task comment, then keep working on the current truth; the exact-SHA/supersede rule is the protection (owner revision ⇒ supersede + regenerate, not a pre-emptive stall). Only production deploy authorization (DP-11) and explicitly destructive actions remain blocking.

### 5. Push early to save work, and record start/finish

(a) SAVE - create the task branch and PUSH a WIP commit at first-visible (<=20min from start), then push again at every phase completion. The pushed remote branch is what survives a crashed session; local-only progress is work you can still lose. Where the runtime shows live run progress the visibility argument is already covered, but the save obligation is not, and still applies. (b) TIMING - the result MUST carry exactly `- Started: YYYY-MM-DD HH:MM +08` and `- Completed: YYYY-MM-DD HH:MM +08`. No tilde, no other timezone, no bare date, no prose appended to the value. These two lines are the only measurement OII has of whether task duration is falling, so they are mandatory for every executor regardless of model, difficulty, or outcome - including on a FAIL or an aborted run.

### 6. Every commit carries your identity and +0800

every commit you create sets author AND committer on that commit only — `git -c user.name='<AgentName>' -c user.email='<modelName>@<familyName>.com' commit ...` — and carries the `Agent-Model` / `Agent-Family` / `Agent-Session` trailers (`Agent-Step: x.y.z` when the project has no stronger rule). ALWAYS scope the timezone on the same command so the timestamp is Asia/Singapore (+0800) no matter what the session's own TZ is: `TZ=Asia/Singapore git -c user.name=... commit ...` (owner pain 2026-09-03: the same repos carried -0700, +0800 and +0900 commits side by side, so log ordering across agents was unreliable). Never change global `git config`, the machine timezone, or the launcher's TZ. Full rule: /Users/xin/.agents/rules/commit-identity.md — it is restated here so you never have to go read it.

## Only when your task touches a release

### 1. Read back only after the rollout converges

post-deploy readback starts only after the pipeline reaches terminal state, then takes >=2 consecutive consistent samples (k8s rolling window observed 17:21–17:25 during 1.2.26); mixed-version samples inside the window are recorded, not treated as failure.

### 2. Release from a clean source tree

package managers rewrite lockfiles (`npm ci` touches yarn.lock) and make the target repo dirty -> release-preflight returns target_repo_dirty + predeploy_receipt_dirty_source. After build evidence, restore the lockfile (`git checkout -- yarn.lock`), confirm `git status --porcelain` is empty, and regenerate the auditor plan AND receipt on the clean HEAD (receipts are HEAD-bound).

### 3. Pass the receipt and the plan together

release-preflight needs BOTH `--predeploy-receipt` and `--predeploy-plan` from the same auditor run; with the receipt alone the plan resolves empty and it fails predeploy_plan_binding_mismatch. Never copy or hand-edit the plan.

### 4. replicas=0 on a new service is expected

a new service is created by kube-auto with replicas=0 and the deploy pipeline does not scale. That is the known platform shape, not a fault. Record typed pending `replicas_zero_owner_scaling` (owner = the owner) and REMIND the owner in the report; do NOT post a scaling request to the approval group. Domain binding and cache purge still go through the approval group.

## If a clause and a task pack disagree

The pack wins for anything task-specific — paths, repos, scope, budgets. These clauses win for
anything about how you record, save, identify and report work. If they genuinely collide, say so
in your result rather than picking silently.
