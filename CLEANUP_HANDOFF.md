# auto-skills cleanup handoff

This repo has been partially reduced using archive-first cleanup. Nothing was intentionally deleted without an archive copy.

## Archive receipts

Large archive run:

- `/Users/xin/auto-skills-archives/20260424-070318-auto-skills-pre-cleanup`

Old root candidates archive run:

- `/Users/xin/vibecoding/archives/auto-skills/20260424-081657-old-root-candidates`

## Restoring archived paths

Use the `MANIFEST.json` and `RESTORE.md` in the archive run. If a path has an `ARCHIVED.md` receipt, restore the archived original directory back to that exact original path before using it.

Receipts currently left in this repo:

- `tracking/ARCHIVED.md`
- `Ctri-model-switch/ARCHIVED.md`
- `.superset/ARCHIVED.md`

## Important notes for future LLMs

- `domain-tool-core/` is still meaningful and should not be moved casually.
- `domain-tool-core/node_modules/` was removed from the parent repo index with `git rm --cached`; local dependencies remain ignored/reinstallable.
- `antigravity-image/` is referenced by `bin/agimg` and should not be moved without updating scripts.
- `excalidraw-mcp/` was archived because the user confirmed it is unused. Restore from `/Users/xin/vibecoding/archives/auto-skills/20260424-085955-excalidraw-mcp-unused` if needed.
- `CtriXin-repo/` is intentionally ignored by the parent repo and was removed from the parent repo index; treat nested repos inside it as independent projects.
- `.claude/worktrees` may contain active git worktrees; do not delete automatically.
- Root `out/` was archived and removed from parent repo tracking.
- `tracking/` was archived and replaced with a receipt; restore it if old tracking records are needed.
- Prefer `/Users/xin/vibecoding` for future task sessions, worktrees, archives, and temp files.

## New cleanup archive runs

- Excalidraw MCP archive: `/Users/xin/vibecoding/archives/auto-skills/20260424-085955-excalidraw-mcp-unused`
- CtriXin parent tracking snapshot: `/Users/xin/vibecoding/archives/auto-skills/20260424-090509-ctrixin-parent-tracking-snapshot`

## Parent repo cleanup actions already applied

- Added ignore rules for `CtriXin-repo/`, `excalidraw-mcp/`, `tracking/`, `Ctri-model-switch/`, `.superset/`, and `out/`.
- Ran `git rm --cached` for `domain-tool-core/node_modules`, `out`, and `tracking`.
- Snapshotted then ran `git rm --cached -f` for `CtriXin-repo` parent-tracked files. The actual `CtriXin-repo` directory remains on disk.
