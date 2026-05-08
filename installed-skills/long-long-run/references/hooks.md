# Hooks

Hooks are thin adapters over the runtime harness.

They should not invent extra business logic.

The hook branch logic stays simple; the runtime prompt carries the behavioral guidance.

Broken or legacy state is not treated as disabled.
However, `UserPromptSubmit` should not force repair ahead of an unrelated user request.
The agent should repair only when the latest request depends on LLR, asks to resume the long-running objective, or needs LLR state to choose the next step.

## `UserPromptSubmit`

Calls `context_for_user_prompt()`.

`UserPromptSubmit` context should keep runtime state and behavioral instructions in separate
tagged sections. Prompt-facing state should use hybrid tagged Markdown inside
`<current_state>`.
Compact one-line summaries are for status/debug output, not hook instructions.

Behavior:

- no runtime state -> no-op
- broken state -> inject repair guidance, but do not force repair before unrelated user work
- `inc` and not authorized -> remind the agent to use `INC` for evidence-chain exploration and contract clarification
- `inc` and authorized -> remind the agent it may activate if the evidence chain still supports the contract
- `active` -> remind the agent to answer the user and then resume the authorized mainline when appropriate

`INC` can be standalone.
It may be used for research, validation, project archaeology, or decision support without ever entering `ACTIVE`.

`INC` is not limited to passive planning.
It may inspect files, run commands, create probes, or make bounded changes when that is the right way to obtain evidence.

## `Stop`

Calls `stop_decision(...)`.

Behavior:

- no runtime state -> allow
- broken state -> allow; the stop guard cannot enforce `ACTIVE` until the state is repaired
- `inc` -> allow
- `disabled` -> allow
- `active` -> block with a premature-stop prompt

`INC` intentionally has no stop wall.

That is by design:

- `INC` is a free dialogue and exploration mode
- it may stay live across long discovery, recovery, research, or project-forensics sessions
- implementation stop resistance belongs to `ACTIVE`, not to `INC`

## Stop Gate Semantics

The stop gate helps prevent premature stopping in `ACTIVE`.

It should prevent the agent from stopping just because it produced a useful local update while the authorized mainline still has a clear, contract-covered next step.

The active stop prompt should ask the agent to use:

- current contract
- evidence chain
- latest checkpoint
- next action
- completion signal
- blocker

The active stop prompt should use the same prompt-facing hybrid `<current_state>` structure as
`UserPromptSubmit`.

The agent may stop only when the objective is complete, the user asked to stop, the work is genuinely blocked, or the evidence shows that the mainline should return to `INC`.
When the agent decides to stop because the objective is complete or the user asked to stop, the prompt should identify the runtime state path and require the agent to close that state before ending the turn.

If `next_action` is stale, the agent should update it from current evidence before continuing.
