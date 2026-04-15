---
name: issue-recorder
description: "Use when the user wants any project's dev/debug/verification work recorded into `/Users/xin/issue-tracking`, asks to 落档/记录/归档/back up work context or Playwright evidence, wants a repo to default to this recorder even outside SCMP, or asks for a thin project rule/AGENTS template for that recorder flow. Trigger on requests mentioning issue-tracking, recorder, worklog, 落档, 记录到这里, 归档, backup, buglist, 原始LLM记录, 开发过程记录, verification evidence, or PM2-managed recorder service."
---

# Issue Recorder

Use this skill to make `/Users/xin/issue-tracking` the default cross-project recorder, even when the task has nothing to do with SCMP.

Keep the workflow small:
- record early
- update during work
- close with verification
- avoid duplicate local recorder processes

## Read order

Read these in order:

1. `/Users/xin/issue-tracking/AGENTS.md`
2. `/Users/xin/issue-tracking/README.md`
3. `references/project-agents-template.md` only when the user wants a repo to adopt this recorder by default

Treat the `issue-tracking` repo as the canonical recorder contract. Do not fork a second recorder convention unless the user explicitly asks for it.

## Default workflow

### 1) Open the recorder early

Before long dev / debug / verification work, initialize or reuse the recorder entry from the target project repo:

```bash
ISSUE_SLUG="<feishu-record-id-or-short-slug>"

python3 /Users/xin/issue-tracking/scripts/record_cli.py init \
  --issue "$ISSUE_SLUG" \
  --field "Category=开发" \
  --field "Task name=<human-readable task name>" \
  --field "Source=<user request / Feishu task / bug source>" \
  --field "Status=in progress" \
  --field "Domain=<main domain when known>"
```

Rules:
- prefer running the command from the target project repo so `Project` and `Branch` auto-detect correctly
- if `ISSUE_SLUG` is opaque, immediately fill `Task name`, `Problem`, and a working `Fix summary`
- do not leave template placeholders once the answer is already known

### 2) Copy source before summarizing

If the task comes from Feishu, HTML mocks, screenshots, or external docs:

1. copy the raw source into the target repo first
2. then write:
   - source of truth
   - your understanding
   - code mapping
   - validation plan

This keeps the repo self-explanatory for later LLM handoff.

### 3) Update during the task

Do not wait until the end if the task is stateful.

Useful commands:

```bash
python3 /Users/xin/issue-tracking/scripts/record_cli.py append \
  --issue "$ISSUE_SLUG" \
  --section "Task Timeline" \
  --item "Found the real failing path after inspecting runtime output."

python3 /Users/xin/issue-tracking/scripts/record_cli.py append \
  --issue "$ISSUE_SLUG" \
  --section "Fix Process" \
  --item "Updated the rendering path and kept the existing lazy-load behavior."

python3 /Users/xin/issue-tracking/scripts/record_cli.py append \
  --issue "$ISSUE_SLUG" \
  --section "Impact Files" \
  --item '`src/server.js`'
```

Quality bar:
- `Task Timeline` should reflect real progress, not template filler
- `Impact Files` should point to concrete paths
- the first LLM copy should answer: `bug 是什么 / 怎么出现 / 怎么改的 / 后续怎么做`

### 4) Archive evidence

If the task produced screenshots, Playwright runs, or verification notes, keep them under the same issue slug inside:

```text
/Users/xin/issue-tracking/playwright/<project>/<branch>/<issue>/
```

Prefer durable file paths over terminal-only output.

### 5) Reuse the local recorder service

On this machine, the recorder UI should reuse the PM2-managed service:

```bash
PM2_HOME=/Users/xin/.pm2 pm2 status issue-tracking
PM2_HOME=/Users/xin/.pm2 pm2 restart issue-tracking
PM2_HOME=/Users/xin/.pm2 pm2 logs issue-tracking
```

Rules:
- do not start another `python3 scripts/archive_server.py` or `archivectl start` if PM2 app `issue-tracking` already exists
- ordinary `issue.md` / template / `build_*.py` edits do not need restart because pages rebuild on access
- restart only when `scripts/archive_server.py` or PM2 config changed, or when PM2 shows the app offline

### 6) Adopt it per repo when needed

If the user wants a repo to always record here:

1. add a thin local `AGENTS.md`
2. keep only repo-specific details there
3. point future LLMs to `/Users/xin/issue-tracking` and the right PM2 app name

Use `references/project-agents-template.md` as the starter template.

### 7) Close the recorder

Before finishing, write final fields:

```bash
python3 /Users/xin/issue-tracking/scripts/record_cli.py set-field \
  --issue "$ISSUE_SLUG" \
  --field "Status=done / verified" \
  --field "Fix summary=<what changed>" \
  --field "Verification=<how it was verified>"
```

If evidence exists, append the final paths too.

## Guardrails

- Do not treat the recorder as a replacement for the source repo's git history.
- Do not leave an opaque `record_id` as the only visible title.
- Do not leave placeholder bullets such as `path/to/file` or `Record the concrete...`.
- Do not spawn duplicate recorder servers on port `8047`.
- Prefer a thin per-repo rule file over copying a huge policy block into every project.
