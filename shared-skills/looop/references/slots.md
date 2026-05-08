# Looop Slots

Looop slots are domain profiles, not separate runtimes.

The runtime owns:

- state, events, milestones, validation records, recovery, hooks, and commit gates

The slot owns:

- candidate selection, domain-specific hard gates, evidence rules, and stop thresholds

## Current Slots

`bugloop` is the first registered slot.

- aliases: `bugloop`, `nightly-fix`, `nightly debug`, `nightly bug hunt`
- owner skill: `/Users/xin/auto-skills/shared-skills/bugloop/SKILL.md`
- target phase: `nightly-fix`
- default max iterations: `12`
- run log hint: `.ai/critical-debug/YYYY-MM-DD-nightly.md`

Use:

```bash
python3 /Users/xin/auto-skills/shared-skills/looop/scripts/controller.py start \
  --project-root /path/to/repo \
  --slot nightly-fix \
  --objective "Run a critical bug hunt" \
  --owner-agent "web agent" \
  --role "coordinator"
```

## Naming

Use `nightly-fix`, not `nighty_fix`.

`nightly-fix` is an alias for the `bugloop` slot. Do not create a third skill for it.

## Slot Boundary

Slots may set default target phase, done condition, iteration cap, and safety notes. They must not duplicate `.looop` state or create a second stop guard.

If a profile needs long-term memory, export only milestone-grade summaries into Brainkeeper. Do not store raw tool calls, full diffs, or unvalidated candidate theories as long-term memory.

Maintenance note: added by `web agent` (`Role: coordinator`) on 2026-05-08 when `bugloop` became a Looop profile slot.
