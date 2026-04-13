# Startup Recipe

This is a personal quick-start note for continuing `scmp-ops` maintenance in later sessions.

## Current structure

- Main entry:
  - `SKILL.md`
- Shared UI metadata:
  - `agents/openai.yaml`
- Consolidated deploy / bug notes:
  - `references/ops-notes.md`
- Detailed ad-bug debugging rules:
  - `references/ad-bug-notes.md`
- Learnings staging area:
  - `references/learnings-inbox.md`
- Companion improvement skill:
  - `../scmp-self-improve/`

## Personal defaults

- This skill is personal-first; user-specific conventions are allowed here.
- Default real user environment when tool auth matters:
  - `HOME=/Users/xin`
- Feishu AI bug flow:
  - start -> `AI FIXING`
  - finish -> `AI DONE`
- Default Feishu owner scope:
  - `负责人` contains `宋鑫`

## Preferred release path

- `lookup -> repo -> branch -> change -> push -> deploy -> wait -> verify`
- If branch is a numbered release branch, prefer bumping before editing.
- Deploy is complete only after `Succeeded`.
- Verification uses:
  - first check
  - delayed recheck
  - post-purge recheck if needed

## COS special path

If the domain resolves to a `cos-website` target:
- treat bucket as production target
- use explicit `coscli -c /Users/xin/.cos.yaml -e cos.ap-singapore.myqcloud.com`
- smoke-test with a temporary file before overwriting real files
- back up the real file before overwrite

## Maintenance split

- Stable default workflow -> keep in `SKILL.md`
- Useful reusable detail -> keep in `references/ops-notes.md`
- Ad-specific triage/debug detail -> keep in `references/ad-bug-notes.md`
- Fresh but not-yet-promoted lesson -> keep in `references/learnings-inbox.md`
- One-off/project-specific pitfall -> keep in recipe/memory first
- Skill-evolution / promotion review -> use `scmp-self-improve`

## Next startup

If continuing this skill, read in this order:
1. `SKILL.md`
2. `references/startup-recipe.md`
3. `references/ops-notes.md`
4. `references/ad-bug-notes.md` if the task is ad-related
5. `references/learnings-inbox.md` if the task is a follow-up from recent incidents
6. `../scmp-self-improve/SKILL.md` if the user wants to refine the skill itself
