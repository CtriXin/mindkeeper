# INC Operating Guide

INC is LLR's evidence-chain operating mode for reducing uncertainty, calibrating expert judgment, and making the current task contract legible before or without ACTIVE authorization.

INC is not passive planning. It is not a questionnaire. It is not weaker than ACTIVE in tool use. The difference is commitment: INC may explore, test, search, compare, and make bounded changes, but it must not treat the work as the authorized mainline.

## When To Use The Full INC Loop

Use the full INC operating loop when the task needs more than a quick clarification.

Typical signals include:

- the user's goal is unclear or underspecified
- the user may not know the domain well enough to define acceptance criteria
- expert defaults, quality bars, risks, or hidden requirements matter
- domain practice, standards, tools, versions, or conventions may affect the answer
- the task may remain INC-only research or decision support
- the next move is not obvious: continue INC, synthesize, ask a targeted question, or propose ACTIVE

For tiny or obvious INC updates, keep the loop lightweight.

## The INC Operating Loop

Use this loop as a judgment aid, not a rigid checklist:

1. Orient: identify user signals, task type, ambiguity, and likely final artifact.
2. Calibrate: inspect domain practice when expert framing or current standards may matter.
3. Map: build the domain map and project map from evidence.
4. Probe: run bounded searches, file reads, commands, experiments, or comparisons to close evidence gaps.
5. Synthesize: convert evidence into the current recoverable understanding.
6. Decide: choose the next INC move or propose ACTIVE only when commitment would be meaningful.

Do not keep exploring as a posture. Continue INC only when a specific evidence gap still blocks a reliable synthesis or contract.

## Build Two Maps

Build two maps in parallel:

- Domain map: how an expert would frame the task, quality bar, success criteria, common failure modes, and accepted practices.
- Project map: what the current repository, files, commands, data, runtime, constraints, and user corrections actually show.

A good INC synthesis uses both maps. Domain knowledge without project evidence is generic. Project evidence without domain framing may miss the real quality bar.

## Discovery Before Validation

When the domain frame is uncertain, do discovery before validation.

Discovery explore means using the user's wording, project vocabulary, artifact names, data labels, failure symptoms, audience, and quality terms to discover the domain's own language and standards.

Validation search means using a known concept, method, framework, or hypothesis to confirm whether it is appropriate.

Do not start with validation search unless the user request or project evidence already points to that concept. Starting from remembered solution terms can make the agent confirm its prior knowledge instead of discovering what the task domain actually requires.

## Discovery-First Domain Calibration

Run domain calibration when expert framing, current practice, standards, tools, versions, or conventions may affect the task.

When the domain frame is uncertain, do discovery before validation.

Start with seed keywords from:

- the user's exact wording
- project names, directory names, file names, and document titles
- dataset names, labels, fields, metrics, logs, and error messages
- artifact type and target audience
- stated constraints, quality words, and failure symptoms
- tools, libraries, frameworks, or config names found in the project

Use a query ladder:

1. Literal seed queries: search the user's and project's own terms first.
2. Domain vocabulary queries: discover how experts name the problem, artifacts, metrics, and failure modes.
3. Practice and quality-bar queries: find common approaches, expected outputs, and acceptance standards.
4. Benchmark, evaluation, and standard queries: identify datasets, metrics, protocols, and authority sources.
5. Failure-mode queries: discover common pitfalls and unacceptable shortcuts.
6. Current authoritative-source queries: prefer official docs, standards, papers, benchmark pages, or respected ecosystem sources when recency matters.
7. Validation queries: only after discovery, validate candidate methods, assumptions, and expert defaults.

Do not search only for the answer you already expect. Avoid starting with remembered method names unless the user or project evidence already points there.

Use calibration results to update:

- `thinking.expert_defaults`: professional defaults discovered or confirmed by calibration
- `thinking.verified_constraints`: constraints supported by authoritative sources, project evidence, or user statements
- `thinking.evidence_chain`: only claims that materially affect the current task
- `thinking.open_decisions`: inferred needs that still require user confirmation

If external calibration is skipped, make the reason clear: project evidence is sufficient, the user narrowed scope, network use is unavailable, or the task is purely local.

## Project Grounding

Ground INC in direct evidence. Prefer narrow probes over broad questions.

Useful probes include:

- reading repository structure, docs, configs, and entrypoints
- inspecting tests, scripts, manifests, data, generated artifacts, and logs
- running safe commands to verify assumptions
- creating small probes or bounded changes when that is the best way to obtain evidence
- comparing current project behavior against domain expectations

Do not ask the user for information that can be reasonably discovered from the project or public authoritative sources.

## Evidence Chain

INC should build a strong evidence chain from the user's request to the proposed contract or decision.

A useful evidence chain connects:

- user signals: what the user asked for, corrected, rejected, or emphasized
- domain inference: what an expert would infer from those signals
- project evidence: what files, commands, data, runtime behavior, or sources show
- inferred needs: hidden deliverables, quality bars, constraints, or risks
- proposed contract: objective, requirements, success criteria, guardrails, next action, and completion signal
- confirmation gate: which inferred or extrapolated parts require user confirmation

Use `thinking.evidence_chain` only for current effective evidence:

- claim: the current conclusion that still stands
- basis: the evidence summary supporting it
- implication: how it changes the next action

Do not keep stale or overturned evidence in the current evidence chain. Remove or replace it. If the history matters, record one short checkpoint in `progress.checkpoint_history`.

## Continuity And Checkpoints

LLR should not depend on agent speed, a long short-term context window, or the model remembering everything between tool calls.

Before long, context-heavy, or fast multi-step work, write compact durable truth into the runtime instead of prose-only chat memory:

- overturned evidence
- current conclusion
- next action
- stop condition
- material blockers or residual uncertainty

Refresh `thinking.evidence_chain`, `progress.latest_checkpoint`, and `progress.next_action` after material user corrections, failed validation, or strategy changes. This keeps compaction, handoff, and stop guards from losing the thread.

Do not store every detail. Store the smallest current truth that would let a later agent resume correctly.

## Confidence Debugger Loop

Before committing to a strategy, closure, or "done" judgment, run this loop:

```text
Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes and run this loop until you are factually 100% confident in the new strategy.
```

Treat the line as a debugger loop, not as permission to fake certainty.

The loop should:

- list material loopholes and failure modes
- check stale, overturned, or missing evidence
- verify assumptions against files, commands, tests, sources, or user statements when verification is available
- apply fixes or run bounded probes
- repeat until no material loophole remains, or record the residual uncertainty and next verification step

Do not claim 100% confidence unless every material claim has supporting evidence. If residual uncertainty remains, state the risk plainly and keep it in the runtime state when it affects the next action.

Maintenance note: This continuity and confidence/debugger guidance was recorded by `web agent` (`Role: coordinator`) on 2026-05-08.

## Expert Extrapolation

In INC, do not only repeat the user's literal request. Use expert judgment to infer what the user may ultimately need.

Reasonable extrapolation may include:

- likely final artifacts or deliverables
- missing acceptance criteria
- hidden quality requirements
- downstream workflows
- risks the user did not name
- adjacent work needed for the stated goal to succeed

Treat extrapolated needs as hypotheses. Surface them as proposed additions, assumptions, or open decisions. Do not silently convert them into committed requirements. Extrapolated work must be confirmed by the user before it becomes ACTIVE mainline work.

## Runtime Field Discipline

Keep LLR state compact and current.

Use:

- `thinking.evidence_chain` for current evidence-backed claims and implications
- `thinking.expert_defaults` for professional defaults discovered or inferred
- `thinking.verified_constraints` for facts confirmed by files, commands, sources, or user statements
- `thinking.assumptions` for plausible but unverified beliefs that affect action
- `thinking.risks` for things likely to harm the objective
- `thinking.open_decisions` for choices requiring user judgment
- `progress.next_action` for the next concrete move
- `progress.completion_signal` for evidence that would make the objective complete enough to stop or synthesize

Do not store private reasoning. Do not turn the state file into a source archive, backlog, or project management board.

## Choosing The Next INC Move

After each meaningful evidence step, decide what should happen next:

- Continue INC exploration if a specific evidence gap still blocks reliable synthesis.
- Synthesize current understanding if enough evidence exists to explain the task, contract, or decision.
- Ask a targeted question if one user decision blocks the next move.
- Propose ACTIVE if the mainline is clear enough and entering ACTIVE would represent real commitment.
- Stay INC-only if the user wants research, validation, comparison, or decision support without implementation.

When recommending continued INC, make the next evidence-strengthening move visible when useful:

- evidence_gap: what is weak or missing
- next_probe: the file, command, source, experiment, comparison, or user decision to inspect next
- expected_signal: what would strengthen, weaken, or close the hypothesis
- stop_condition: when to stop this INC pass and re-evaluate

For small or obvious next steps, keep this lightweight.

## Raising ACTIVE

Readiness is not authorization. Capability is not commitment.

Raise ACTIVE only when:

- the domain map is good enough to define quality
- the project map is good enough to choose a mainline
- expert defaults, assumptions, constraints, and risks have been surfaced
- extrapolated requirements have been confirmed or clearly separated
- the next action and completion signal are clear
- ACTIVE would mean committed mainline execution, not merely more exploration

The user decides whether ACTIVE begins.

## INC-Only Work

INC may be the whole workflow.

Use INC-only mode when the user wants to understand, compare, validate, research, or decide without authorizing implementation.

Do not force an ACTIVE proposal. Keep strengthening the evidence chain, surfacing synthesis, and helping the user decide what the evidence means.

## Anti-Patterns

Avoid:

- questionnaire mode: asking broad questions before doing discoverable work
- memory-only expertise: relying on prior knowledge when current practice may matter
- validation-first search: starting with remembered solution terms before discovering the task domain's own language
- confirmation search: searching only for what you already believe
- fact hoarding: collecting evidence without synthesis
- endless exploration: continuing INC without a named evidence gap
- premature ACTIVE: proposing ACTIVE before commitment would mean anything
- silent extrapolation: turning inferred needs into requirements without confirmation
- stale evidence: keeping claims after later evidence invalidates them
- state bloat: using LLR as a backlog, archive, or project management system
