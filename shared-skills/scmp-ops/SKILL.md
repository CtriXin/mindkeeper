---
name: scmp-ops
description: "Use when the task involves SCMP-oriented online operations: domain/service lookup, locating the matching git repo, entering or bumping a release branch, making deployable changes, pushing, deploying through SCMP, waiting for pipeline completion, verifying production after rollout, or reading/updating Feishu via lark-cli. Trigger on requests mentioning lookup, push, deploy, branch bump/increment, SCMP, lark-cli, Feishu, 飞书，域名对应服务，发版，上线验证，pipeline, run id, or post-deploy checks."
---

# SCMP Ops

A low-variance workflow for online domain/service changes. Follow this path unless the user explicitly asks for a different one.

---

## Module Structure

This skill is organized into logical modules for potential future extraction:

| Module | File | Purpose |
|--------|------|---------|
| **Core Deploy** | `SKILL.md` (this file) | SCMP deployment flow, branch policy, verification |
| **Feishu Operations** | `references/feishu-workflows.md` | lark-cli CRUD, token resolution, status protocol |
| **Ad-Bug Runtime** | `references/ad-bug-runtime.md` | Ad debugging, device verification, attachment inspection |
| **Playwright Artifacts** | `references/playwright-artifacts.md` | Git-backed storage path, naming, and report/screenshot archiving |
| **Ops Notes** | `references/ops-notes.md` | Deploy/cache/COS lessons |
| **Learnings Inbox** | `references/learnings-inbox.md` | New lessons pending promotion |

**Extraction criteria**: Modules may become separate skills when non-SCMP use cases emerge.

---

## Core Deploy Workflow

### 1) Resolve Service

```bash
rf getcf <domain>
HOME=/Users/xin /Users/xin/auto-skills/bin/lookup <domain>
```

Use `rf getcf` for authoritative current binding. Use `lookup` to get service name, git URL, and deployed branch.

### 2) Locate Repo

```bash
git status --short --branch
git remote -v
```

If no local repo exists but `lookup` gave authoritative git URL, clone first.

### 3) Branch Policy

- Determine current deployed branch from `lookup`/SCMP
- If numeric release branch (e.g., `1.0.0.3`), prefer incrementing before editing
- Do not edit live deployed branch unless user explicitly wants hot patch

```bash
git checkout 1.0.0.3
git checkout -b 1.0.0.4
```

### 4) Implement Change

Prefer smallest correct change. Before editing:
- Inspect writable scope
- Note unrelated dirty files
- Avoid touching unrelated code

### 5) Local Validation

Run smallest meaningful validation:
- Build / type check
- Local HTML/source inspection
- Local preview if runtime behavior matters

Do not stop at "build passed" for deployment-sensitive changes.

When Playwright is used for verification:
- prefer preserving a reusable HTML report, not only terminal output
- store artifacts in the central archive described in `references/playwright-artifacts.md`
- keep project / branch / issue separation so later regressions stay traceable

When the task comes from a bug / issue source such as Feishu:
- create or update a durable issue record in the canonical issue archive
- record the problem, likely cause, fix summary, and verification result
- if screenshots or Playwright evidence exist, keep them under the same issue slug

### 6) Push

```bash
git add <files>
git commit -m "<clear message>"
git push origin <branch>
```

### 7) Deploy

Use repo-local deploy metadata (`.deploy-service`, `.deploy-name`).

Default safe pattern:

```bash
HOME=/Users/xin python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py \
  --token-file /Users/xin/.scmp_token.json \
  deploy <service> --env prod --branch <branch> --version <version> --no-interactive --print-payload
```

Fall back to direct `scmp_cli.py` when you need explicit `--token-file`, `--version`, or payload inspection.

### 8) Wait for Completion

Do not treat "triggered" as "done". Poll until terminal state:

```bash
HOME=/Users/xin python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py current <service> <pipeline>
```

Release complete only when `status=True` with `reason=Succeeded`.

After `Succeeded`, wait for stabilization before verification:
- Tracking/analytics: 30-120s
- SEO/HTML injection: 30-120s  
- Static assets: 30-60s

### 9) Production Verification

Always verify with cache-busting where relevant:

```bash
curl -L -s "https://domain/?check=$(date +%s)" | rg "expected-string"
curl -I "https://domain/old-path?check=$(date +%s)"
```

**Three-stage verification cadence**:
1. 首验 — immediately after `Succeeded` (quick signal, not decisive for cache-sensitive changes)
2. 延迟复验 — after stabilization wait (decisive check)
3. 清缓存后复验 — if delayed recheck fails, purge cache and verify again

Interpretation:
- First fail + delayed pass → rollout/cache timing
- Delayed fail + post-purge pass → cache issue
- Still failing after all three → likely code/config issue

---

## Feishu Integration

This skill integrates with Feishu for bug-driven workflows. Detailed operations are in `references/feishu-workflows.md`.

### When to Use Feishu

- Task originates from Feishu bug table
- User requests Feishu status updates
- Post-deploy verification requires state sync

### Status Protocol

| State | When |
|-------|------|
| `AI FIXING` | Before code change |
| `AI DONE` | After deploy + verification |

**Rules**:
1. Never mark `AI DONE` before online verification
2. Always read back after write
3. Owner filter: only process records where `负责人` contains `宋鑫`
4. Rescan open bugs after batch completion (new records may appear)

### Core Feishu Operations

```bash
# Resolve base token from wiki doc token
HOME=/Users/xin lark-cli api GET "/open-apis/bitable/v1/apps/{wiki_doc_token}"

# List records
HOME=/Users/xin lark-cli base +record-list --base-token <base> --table-id <table> --limit 300

# Update status (array format for select fields)
HOME=/Users/xin lark-cli base +record-upsert \
  --base-token <base> --table-id <table> --record-id <record_id> \
  --json '{"项目状态":["AI DONE"]}'

# Read-back verify
HOME=/Users/xin lark-cli base +record-get \
  --base-token <base> --table-id <table> --record-id <record_id>
```

**See `references/feishu-workflows.md` for**: detailed token resolution, batch workflows, attachment download, status protocol edge cases.

---

## Ad-Bug Runtime Checklist

For AdSense / lazy-load / placement bugs, use the classification and verification rules in `references/ad-bug-runtime.md`.

### Quick Reference

**Bug buckets**:
- `位置不对` → adjust placement anchors
- `slot 不对` → compare sheet/config/runtime
- `空白区域没隐藏` → inspect state machine + collapse
- `没有 iframe` → verify render vs hide expectation
- `desktop/mobile 分叉` → validate each device separately

**Device verification**:
- Desktop and mobile are separate
- Use real mobile UA if server output differs by device
- Capture: slot id, `data-ad-status`, `adsbygoogle-status`, computed display/height

**Runtime truth**:
- `iframe exists` ≠ `filled`
- `adsbygoogle-status="done"` ≠ success
- Final state: `filled` → show, `unfilled/error` → hide

---

## Core Policy Rules

1. **Deploy flow**: `lookup → repo → branch → change → push → deploy → wait → verify`
2. **Token**: Use `HOME=/Users/xin` and explicit `--token-file /Users/xin/.scmp_token.json`
3. **Never assume repo from memory** when domain/service can be resolved
4. **Wait + verify** after every production deploy
5. **Feishu write requires read-back** — never trust write success alone
6. **Increment branch** for numbered release branches
7. **COS static sites**: backup before overwrite, verify online after each change
8. **Route ownership**: identify what serves the URL (server route / SSR / static / CDN) before editing
9. **Legacy URL migrations**: verify redirects and query preservation as part of release
10. **Playwright evidence**: archive HTML report and screenshots to the central tracking path using project / branch / issue folders
11. **Issue record**: for bug-driven SCMP work, update the canonical issue record with problem / cause / fix / verification summary

---

## Auto-Trigger Self-Improve

After completing a Feishu-driven bug-fix batch, automatically invoke `scmp-self-improve` when:

1. **Multiple bugs fixed**: 2+ records switched to `AI DONE`
2. **New failure mode**: first-time error, deployment surprise, verification blind spot
3. **User requests**: "总结一下", "复盘", "记录经验"

Do NOT auto-trigger for single bug fixes without notable incidents.

---

## Output Contract

When finishing a release task, report:

- Resolved service / local repo path
- Branch used / bumped to
- Files changed / commit id
- Deploy service / pipeline / run id / version
- Verification evidence
- Any unresolved risk

If Feishu was involved:
- Which records switched to `AI FIXING` / `AI DONE`
- Read-back confirmation result

---

## Guardrails

- Never skip `wait + verify` after production deploy
- Never use sandbox HOME for SCMP/lark-cli when user HOME matters
- Never mark domain as confirmed if `lookup` failed — mark as inferred
- Never update Feishu status without read-back check
- Never edit live deployed branch if clean incremental branch is expected
- Never treat "HTML contains code" as enough for runtime-triggered events
- Never close release task with only local validation if user asked for deploy/online verification

---

## Related Files

| File | Purpose |
|------|---------|
| `references/feishu-workflows.md` | Feishu/lark-cli operations |
| `references/ad-bug-runtime.md` | Ad debugging checklist |
| `references/ops-notes.md` | Deploy/cache/COS lessons |
| `references/learnings-inbox.md` | New lessons pending promotion |
| `references/promotion-log.md` | Promotion audit trail |
