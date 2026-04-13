# Review Loop

Use this reference when the user wants continuous improvement, not just one-off distillation.

## Minimal loop

1. identify the most concrete lesson from the recent task
2. decide whether it is:
   - one-off
   - candidate
   - reusable detail
   - stable default
3. write it to the smallest correct target
4. explain the promotion decision briefly

## Promotion questions

Before promoting into `scmp-ops/SKILL.md`, ask:

1. Did this happen more than once?
2. Would forgetting it likely cause a repeated production mistake?
3. Can another agent validate it with a concrete check?
4. Is it broader than one page, one domain, or one temporary project quirk?

If any answer is "no", prefer `learnings-inbox.md` or a reference file.

## Good examples

- repeated cache verification blind spot
- repeated `lark-cli` payload gotcha
- repeated responsive ad duplication failure
- repeated Feishu owner-scope mistake

## Bad examples

- one screenshot from one page with no generalization
- personal writing preference
- a single temporary outage
- a theory that was never verified

## Suggested cadence

- after important bug-fix batches
- after difficult releases
- after user corrections that reveal a stable pattern
- before or after updating `scmp-ops`

