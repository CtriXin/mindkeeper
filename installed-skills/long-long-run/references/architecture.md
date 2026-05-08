# Architecture Notes

`long-long-run` is a runtime harness, not a prompt checklist.

The design is intentionally small:

- `state.py` owns schema, normalization, load, and save
- `runtime.py` owns mode semantics, readiness, authorization, checkpointing, hook context, and stop logic
- `controller.py` is only a CLI facade

## Session Identity

The runtime is session-bound.

Identity resolution order is:

1. hook-provided `session_id`
2. explicit CLI or API `session_id`
3. explicit state `path`
4. `CODEX_THREAD_ID`

## State Philosophy

State stores current durable truth that affects runtime behavior.

It does not try to store every thought.
It does not preserve private chain-of-thought.
It does not act as a full evidence archive.

The persistent state is intentionally limited to:

- `runtime`
- `contract`
- `thinking`
- `activation`
- `progress`

Older schemas are not auto-migrated.

If a legacy state file is present, normal runtime operations should reject it and require an explicit rebuild before LLR state is trusted.

Hook context should not force repair before unrelated user work.
If the latest user request does not depend on LLR, the agent may leave the broken state unresolved until LLR is needed again.

## Current Schema

```json
{
  "runtime": {
    "schema_version": 1,
    "controller_version": 1,
    "skill": "long-long-run",
    "session_id": "",
    "mode": "disabled",
    "project_root": "",
    "created_at": "",
    "updated_at": "",
    "last_transition": ""
  },
  "contract": {
    "objective": "",
    "why_now": "",
    "requirements": [],
    "success_criteria": [],
    "guardrails": [],
    "delivery_posture": "high_quality",
    "confirmed": false
  },
  "thinking": {
    "inferred_intent": "",
    "evidence_chain": [],
    "expert_defaults": [],
    "verified_constraints": [],
    "assumptions": [],
    "risks": [],
    "open_decisions": []
  },
  "activation": {
    "status": "idle",
    "scope": "single",
    "evidence": "",
    "updated_at": ""
  },
  "progress": {
    "latest_checkpoint": "",
    "checkpoint_history": [],
    "next_action": "",
    "completion_signal": "",
    "blocker": {
      "kind": "none",
      "summary": ""
    },
    "closure": {
      "state": "open",
      "reason": "",
      "summary": "",
      "closed_at": ""
    }
  }
}
```

## Evidence Chain

`thinking.evidence_chain` stores current effective evidence, not history.

Each entry uses the minimal shape:

```json
{
  "claim": "Current conclusion that still stands.",
  "basis": "Evidence summary supporting the claim.",
  "implication": "How this claim affects the next action."
}
```

Rules:

- keep only evidence that still affects current judgment
- remove or replace evidence that has been overturned
- record major evidence changes as short checkpoints when the history matters
- use `verified_constraints` for stable constraints
- use `assumptions` for unverified beliefs that still affect action

## Completion Signal

`progress.completion_signal` records what evidence would make the agent judge the current objective complete enough to stop.

Examples:

- implementation: requested behavior exists and the relevant tests pass
- debugging: root cause is found, fixed, and verified
- research: gathered facts are strong enough to support the conclusion
- monitoring: observation window ends or the trigger condition is met
- migration: target objects are moved and verified

## Closure

`progress.closure` owns close semantics.

`runtime` stores machine state; closure stores task-end semantics.

Rules:

- `close()` sets `runtime.mode=disabled` and `progress.closure.state=closed`
- `close()` writes `reason`, `summary`, and `closed_at`
- `return_to_inc()` reopens closure and clears activation
- `activate()` also ensures closure is open

## Authorization Model

The runtime separates:

- readiness
- authorization

The agent may be ready in `INC` and still remain in `INC`.

Readiness is a signal for agent judgment, not a forced transition rule.

The agent decides whether and when to raise `ACTIVE`.

The user decides whether `ACTIVE` is entered.

Only explicit user authorization may unlock `ACTIVE`.

`activation.status=authorized` means the user allowed `ACTIVE`.
It is not a readiness signal and it is not permission to expand the contract without judgment.

If new evidence materially changes the objective, success criteria, or guardrails, the agent should return to `INC` or ask for confirmation.

## Checkpoint History

The runtime keeps a compact checkpoint trail:

- `progress.latest_checkpoint` is the current headline state
- `progress.checkpoint_history` is the short timeline of prior checkpoints

Use `checkpoint()` for frequent progress updates.

When evidence is replaced because it was overturned, do not keep the stale evidence in `thinking.evidence_chain`.
Capture the change in `checkpoint_history` with one short summary if the history matters.
