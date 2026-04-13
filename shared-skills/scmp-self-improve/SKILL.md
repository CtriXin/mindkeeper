---
name: scmp-self-improve
description: Use when the user wants to evolve `scmp-ops`, capture lessons from recent SCMP / Feishu / deploy / bug-fix work, decide what should be promoted into stable skill rules, or keep a lightweight continuous-improvement loop for company operations. Trigger on requests mentioning 复盘, 沉淀经验, 升级技能, 进化, 自我改进, promote rules, update scmp-ops, 记录教训, or make future bug-fix work smoother. Also auto-triggered by `scmp-ops` after batch bug-fix sessions (2+ bugs fixed, new failure modes, or explicit user request like "总结一下").
---

# SCMP Self Improve

Use this skill to improve the `scmp-ops` ecosystem without bloating the main workflow.

This skill is intentionally lightweight:
- `scmp-ops` stays the stable operational backbone
- new lessons are captured first
- only repeated, validated lessons get promoted

## Goal

Make company bug-fix and release work smoother over time by enforcing:

1. **capture**
2. **classify**
3. **promote selectively**

Do not rewrite the main skill after every task.

## Default workflow

### 1) Read current state

Read these in order:

1. `/Users/xin/auto-skills/shared-skills/scmp-ops/SKILL.md`
2. `/Users/xin/auto-skills/shared-skills/scmp-ops/references/learnings-inbox.md`
3. the most relevant note file:
   - `/Users/xin/auto-skills/shared-skills/scmp-ops/references/ops-notes.md`
   - `/Users/xin/auto-skills/shared-skills/scmp-ops/references/ad-bug-notes.md`

If the user asks for broader reflection, also read:
- `references/review-loop.md`
- `references/session-close-template.md`
- `references/promotion-checklist.md`
- `references/promotion-log.md`

### 2) Extract lessons from the recent task

Look for:
- repeated failures
- user corrections
- verification blind spots
- deployment/cache surprises
- Feishu / `lark-cli` gotchas
- runtime/debug patterns that saved time

Prefer concrete lessons over abstract advice.

Bad:
- "be more careful"

Good:
- "for shared static assets on COS, verify both cache-busted and normal asset URLs"

### 3) Classify each lesson

Classify into one of these buckets:

1. **one-off**
   - keep in recipe/memory only
2. **new candidate**
   - append to `scmp-ops/references/learnings-inbox.md`
3. **reusable detailed rule**
   - promote to:
     - `scmp-ops/references/ops-notes.md`
     - or `scmp-ops/references/ad-bug-notes.md`
4. **stable default behavior**
   - promote to `scmp-ops/SKILL.md`

Promotion threshold for `SKILL.md`:
- repeated `2-3` times or more
- cross-project
- validated with concrete evidence
- expensive to forget

### 4) Keep the main skill short

When updating `scmp-ops/SKILL.md`:
- keep only default behavior
- avoid project-specific DOM quirks
- avoid long examples unless needed
- prefer linking to references files

### 5) Write the result

Use this default output format:

- what was learned
- where it was stored
- whether it was promoted
- why it was or was not promoted

### 6) Update the promotion log when promotion happens

If you promote a lesson into:
- `scmp-ops/SKILL.md`
- `scmp-ops/references/ops-notes.md`
- `scmp-ops/references/ad-bug-notes.md`

then also append a short entry to:
- `references/promotion-log.md`

This avoids repeating the same promotion work in later sessions.

## Usage modes

### Mode A: session close

Use when:
- a bug-fix batch just ended
- a release just ended
- the user wants "总结一下 / 复盘一下 / 记录经验"

Default action:
1. read the recent task context
2. extract `1-3` concrete lessons
3. write them to `learnings-inbox.md` unless promotion is already justified
4. answer with:
   - lessons
   - storage target
   - whether promotion is needed now

For this mode, use:
- `references/session-close-template.md`

### Mode B: promotion review

Use when:
- the user asks to improve `scmp-ops`
- multiple similar incidents have accumulated
- the user asks what should become a real rule

Default action:
1. read `learnings-inbox.md`
2. group repeated patterns
3. apply `references/promotion-checklist.md`
4. promote only the strongest candidates
5. log the promotion in `references/promotion-log.md`

### Mode C: cleanup / dedupe

Use when the inbox becomes noisy.

Default action:
1. merge duplicate lessons
2. remove clearly obsolete one-offs
3. tighten wording without losing evidence
4. keep the inbox short and scannable

## Feishu Module Extraction Check

**When**: At the start of any session involving Feishu operations (lark-cli commands, Bitable updates, status sync workflows).

**Action**: Check `scmp-ops/references/learnings-inbox.md` for the `feishu-module-extraction-trigger` meta-rule. Evaluate the 5 trigger conditions:

1. **3+ non-SCMP Feishu operations** — pure data tasks without deploy steps
2. **User explicitly requests** standalone Feishu skill again
3. **Cross-project Feishu workflows** emerge (Feishu-only automation, multi-platform integrations)
4. **`feishu-workflows.md` exceeds ~400 lines** with reusable content
5. **OpenClaw/Hermes Agent integration** requires independent Feishu tool layer

**If any condition is met**, prompt the user:

> Feishu module has grown — ready to extract to standalone `feishu-ops` skill?

**If extraction is triggered**:
1. Create `feishu-ops/SKILL.md` based on `scmp-ops/references/feishu-workflows.md`
2. Move `feishu-workflows.md` to the new skill's references
3. Update `scmp-ops/SKILL.md` to reference `feishu-ops` for Feishu operations
4. Log the extraction in `references/promotion-log.md`

---

## Guardrails

- Do not turn every bug into a new main rule.
- Do not promote unverified guesses.
- Do not mix temporary incident notes into stable SOP.
- Do not duplicate the same lesson across multiple files unless promotion is intentional.
- Prefer delayed promotion over immediate main-skill edits.

## When to update which file

- `scmp-ops/SKILL.md`
  - stable workflow defaults
- `scmp-ops/references/ops-notes.md`
  - reusable deploy / verify / Feishu details
- `scmp-ops/references/ad-bug-notes.md`
  - reusable ad-debug and placement-validation details
- `scmp-ops/references/learnings-inbox.md`
  - fresh learnings not yet promoted
- `scmp-self-improve/references/promotion-log.md`
  - short audit trail of what was promoted and why

## Default deliverables

This skill should usually leave behind one or more of:

1. a new inbox entry
2. a promotion to `scmp-ops`
3. a promotion log entry
4. a concise explanation of why nothing was promoted yet

## Companion relationship

This skill does not replace `scmp-ops`.

Use:
- `scmp-ops` for doing the work
- `scmp-self-improve` for improving how that work is done over time
