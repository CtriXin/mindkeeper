---
name: long-long-run
description: Use when a task needs a persistent session-bound runtime for long-running execution, project exploration, recovery, monitoring, or continued progress toward one main objective while still handling temporary user interruptions.
metadata:
  short-description: "LLR: INC evidence-chain exploration and ACTIVE authorized mainlines"
---

# Long Long Run

Use this skill when the work is not a short edit-and-exit task. Typical triggers:

- long-running training, tuning, evaluation, or monitoring
- project takeover, archaeology, recovery, or external-drive exploration
- tasks where one main objective must stay coherent across many turns

## What this skill is

`long-long-run` is a code-first, agent-owned evidence-chain harness.

It is not a questionnaire and it is not a giant state form.
It is not a project management system or evidence archive.

The runtime owns:

- session binding
- mode semantics
- authorization to start implementation
- current evidence-chain context
- progress checkpoints
- hook context and stop behavior

The agent should mainly control it through Python or a very small CLI surface.

## Runtime requirement

The runtime scripts require `python3`.

They use only the Python standard library and do not require third-party packages.

## Modes

The runtime has exactly three modes:

- `inc`
- `active`
- `disabled`

### `inc`

`INC` means Intent Noise Cancellation.

This is the default mode.

`INC` is for reducing uncertainty, clarifying the contract, and converging on the current best understanding of the work.

`INC` is not limited to passive analysis or conversational planning.
The agent should use judgment and take the actions needed to build or revise the evidence chain, make the work more legible, test assumptions, and clarify the contract, unless the user narrows that scope.

`INC` may be used as a standalone exploration or decision-support mode.
It does not have to lead to `ACTIVE`.

`INC` may inspect files, run commands, create probes, or make bounded changes when that is the right way to obtain evidence.

For substantive `INC` work, read [references/inc-best-practices.md](references/inc-best-practices.md) before synthesizing expert defaults, evidence-chain gaps, or the next `INC` move unless you have already read it in this session.
This especially applies when the user goal is unclear, the domain framing matters, acceptance criteria must be inferred, or the work may remain `INC`-only.

The distinction is semantic, not mechanical.

`INC` is allowed to stay live for the whole session.

`INC` does **not** have a stop guard.

`INC` does **not** grant implicit authorization to treat the work as the committed mainline.

### `active`

`ACTIVE` means the user has explicitly chosen to let the agent carry the agreed direction as the mainline.

`ACTIVE` is not defined by a different tool set.
It is defined by commitment and ownership: the work is now being pursued as the authorized implementation and delivery track.

`ACTIVE` means authorized continuation until the objective is complete, blocked, stopped by the user, or changed enough to require `INC`.

`ACTIVE` has the stop guard.

### `disabled`

There is no live long-long-run objective for the session.

## The core rule

Readiness is not authorization.

Capability is not commitment.

The agent may be fully ready in `INC` and still remain in `INC`.
The agent may act in `INC` without that implying a transition to `ACTIVE`.

The user decides whether to enter `ACTIVE`.
The agent decides whether and when it is appropriate to raise that transition.

The runtime may enter `ACTIVE` only after explicit user authorization.

If new evidence shows that the authorized mainline needs a material change, return to `INC` or ask the user for confirmation instead of silently expanding the contract.

## Expert defaults must be visible

In `INC`, the agent should act like a domain expert.

That means:

- propose strong default constraints
- propose quality standards and guardrails
- search when those standards are uncertain

Before presenting expert defaults, the agent should ask whether the domain needs calibration.

If current practice, ecosystem changes, standards, tools, versions, safety, policy, design conventions, or industry norms may affect the answer, perform a bounded domain calibration pass.

This pass should run discovery before validation: start from the user's wording and project vocabulary, discover domain terms and quality bars, then use focused searches to validate hypotheses.
It should not start from remembered solution terms unless the user or project evidence already points there.

If external calibration is skipped, the agent should make the reason visible.

But those defaults must not stay implicit.

The agent should surface them clearly so the user can:

- accept them
- adjust them
- reject them

`INC` must not feel like a black box.

## Default quality posture

Ambiguity does not imply demo.

Unless the user explicitly asks for a `demo`, `prototype`, `spike`, `POC`, or other disposable artifact, the default delivery posture is:

- `high_quality`

## Runtime shape

State is intentionally small.

The runtime keeps only:

- `runtime`
- `contract`
- `thinking`
- `activation`
- `progress`

Do not try to store every thought.

Only store current durable truth that changes runtime behavior.

`thinking` is a working model, not private chain-of-thought.
`thinking.evidence_chain` should contain only current effective evidence.
If evidence is overturned, remove or replace it in `evidence_chain`; record the major change as a short checkpoint if the history matters.

`progress.completion_signal` records what evidence would make the agent judge the current objective complete enough to stop.

`progress.closure` records whether the current long-running objective is open or closed.

The stop guard helps prevent premature stopping in `ACTIVE`.
It prevents stopping merely because a local step produced a useful update while the authorized mainline still has a clear, contract-covered next step.

## Legacy states

This runtime does not auto-migrate old `long-long-run` JSON.

If an older schema is found, normal runtime operations should surface a repair requirement.

Repair is required before relying on LLR state.
It does not have to happen before answering an unrelated user message.

When repair is needed, the agent should:

- read the old JSON explicitly
- infer the still-valid objective, contract, and progress
- rebuild the state in the current schema through the new runtime API

## Scripts

Primary scripts:

- [state.py](scripts/state.py)
- [runtime.py](scripts/runtime.py)
- [controller.py](scripts/controller.py)
- [test_runtime.py](scripts/test_runtime.py)

Hook adapters:

- [state_context_hook.py](scripts/state_context_hook.py)
- [stop_guard.py](scripts/stop_guard.py)

## Python-first usage

Prefer Python over large JSON patch commands.

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export LLR_PY="$CODEX_HOME/skills/long-long-run/scripts"
export LLR_CTL="$CODEX_HOME/skills/long-long-run/scripts/controller.py"
```

```bash
python3 - <<'PY'
import os
import sys

sys.path.insert(0, os.environ["LLR_PY"])
from runtime import current_runtime

rt = current_runtime()

print(rt.bind(auto_create=True, project_root="/path/to/project"))

print(
    rt.update_contract(
        {
            "objective": "Map the legacy project and define the agreed implementation path.",
            "why_now": "The user needs a reliable takeover and wants implementation only after explicit approval.",
            "requirements": ["Base conclusions on direct evidence."],
            "success_criteria": ["Produce a coherent project map and a clear execution path."],
            "guardrails": ["Do not start implementation before authorization."],
            "confirmed": True,
        }
    )
)

print(
    rt.update_thinking(
        {
            "inferred_intent": "Stay in INC while reconstructing the project from its artifacts.",
            "evidence_chain": [
                {
                    "claim": "The project needs evidence-backed mapping before implementation.",
                    "basis": "The user asked for a reliable takeover and explicit approval before active work.",
                    "implication": "Continue INC until the contract and authorization boundary are legible.",
                }
            ],
            "expert_defaults": ["Start from repo structure, docs, configs, and run entrypoints."],
            "verified_constraints": ["Use the actual environment and deployment docs as the source of truth."],
            "open_decisions": ["Whether to begin implementation after the mapping is complete."],
        }
    )
)

print(
    rt.checkpoint(
        summary="Finished the first project scan.",
        next_action="Read the backend entrypoints and dependency manifests.",
    )
)

print(
    rt.update(
        {
            "progress": {
                "completion_signal": "The project map and agreed execution path are captured."
            }
        }
    )
)
PY
```

## CLI usage

Use the CLI when a direct script call is simpler than a Python snippet.

```bash
python3 "$LLR_CTL" current \
  --auto-create \
  --project-root /path/to/project

python3 "$LLR_CTL" checkpoint \
  --summary "Finished the first project scan." \
  --next-action "Read the backend entrypoints."

python3 "$LLR_CTL" authorize-active \
  --evidence "The user explicitly said: start implementation now."

python3 "$LLR_CTL" activate

python3 "$LLR_PY/test_runtime.py"
```

## References

Read only what you need:

- hook behavior: [references/hooks.md](references/hooks.md)
- INC exploration practice: [references/inc-best-practices.md](references/inc-best-practices.md)
- runtime architecture: [references/architecture.md](references/architecture.md)
- optional prompt reminders: [references/prompt-templates.md](references/prompt-templates.md)
- worked examples: [references/examples.md](references/examples.md)
