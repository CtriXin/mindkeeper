# Feishu Workflows

Detailed Feishu/lark-cli operation procedures. This file is a candidate for future extraction into `feishu-ops/SKILL.md`.

---

## Module Info

- **Current Owner**: scmp-ops (may become feishu-ops)
- **Extraction Criteria**: When non-SCMP Feishu tasks appear (e.g., pure data operations without deploy)
- **Dependencies**: lark-cli, /Users/xin/.lark-cli/config.json

---

## Environment Setup

Always prefer the real user environment first:

```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli ...
```

If `lark-cli` reports `not configured`:
1. Check `HOME` is set to `/Users/xin`
2. Rerun with `HOME=/Users/xin`
3. Confirm `/Users/xin/.lark-cli/config.json` exists
4. Only then conclude there is a real auth/config problem

If the CLI path is not on `PATH`, use explicit executable path.

---

## Base Token Resolution

**Critical**: wiki doc token ≠ Bitable base token.

When a Feishu wiki URL embeds a Bitable table:

1. Extract the wiki doc token from the URL (e.g., `LAxNw1U9yiOvqMkxMjccLUCtnRe`)
2. Query the actual Bitable base token:

```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli api GET "/open-apis/bitable/v1/apps/{wiki_doc_token}"
```

3. Use the returned `app_token` (e.g., `I7m2bnPDgaYnwksqp1jcmmW9nOd`) as `--base-token` in all subsequent `lark-cli base` commands

Using the wiki doc token directly as base token will fail with error `800010608` or `800004006` "invalid recordId format".

---

## Record Operations

### List Records

```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli base +record-list \
  --base-token <base> --table-id <table> --limit 300
```

### Get Single Record

```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli base +record-get \
  --base-token <base> --table-id <table> --record-id <record_id>
```

### Upsert Record

```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli base +record-upsert \
  --base-token <base> --table-id <table> --record-id <record_id> \
  --json '{"项目状态":["AI DONE"]}'
```

**Notes**:
- Prefer the flat record payload shape
- Do not assume nested shapes like `{"fields": {...}}` are accepted
- Confirm the actual persisted value from `.data.record["项目状态"]` on read-back
- For select fields, use array format: `["AI DONE"]` not `"AI DONE"`

### Batch Status Update Workflow

For updating multiple bug records to `AI DONE` after verification:

1. **List records with filter**:
```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli base +record-list \
  --base-token <base> --table-id <table> --limit 300
```

2. **Extract record IDs** for target records (e.g., owned by 宋鑫，status = AI FIXING)

3. **Update each record**:
```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli base +record-upsert \
  --base-token <base> --table-id <table> --record-id <record_id> \
  --json '{"项目状态":["AI DONE"]}'
```

4. **Read-back verify each**:
```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli base +record-get \
  --base-token <base> --table-id <table> --record-id <record_id>
```

5. **Rescan open bugs** after batch completion to catch any new records created during fixing.

---

## Attachment Download

For screenshot-driven ad bugs:

1. Read the record to get `file_token`
2. Fetch a temporary download URL:

```bash
HOME=/Users/xin lark-cli api GET /open-apis/drive/v1/medias/batch_get_tmp_download_url \
  --params '{"file_tokens":"<file_token>"}'
```

3. Download with `curl -L '<tmp_download_url>' -o <file>`
4. Inspect the screenshot locally before deciding which ad slot / position is wrong

---

## Status Protocol

### AI Workflow States

| State | When to Use |
|-------|-------------|
| `AI FIXING` | Before changing code |
| `AI DONE` | After deploy + verification succeeds |

**Rules**:
1. Never mark `AI DONE` before real online verification is complete
2. Do not use legacy states like `已完成` unless user explicitly asks
3. Always read back the record after the write
4. Owner filter is strict: only process records where `负责人` contains `宋鑫`
5. Re-apply owner filter every time you rescan open bugs
6. After finishing a batch, immediately rescan open bugs again (new records may have been created)

### Record ID Discipline

- Distinguish "new bug" vs "old bug not updated" by `record_id`, not by natural-language similarity
- Similar wording may correspond to a brand-new record
- Always preserve and compare `record_id` when tracking progress

---

## Default Configuration

| Key | Value |
|-----|-------|
| Default Owner | `宋鑫` |
| lark-cli Home | `/Users/xin` |
| lark-cli Bin | `/Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli` |
| Status Field | `项目状态` |
| Status Format | Array: `["AI DONE"]` |

---

## Future Extraction Notes

This module is a candidate for extraction into `feishu-ops/SKILL.md` when:
1. Non-SCMP Feishu tasks appear (pure data operations)
2. Cross-project Feishu workflows emerge
3. User explicitly requests standalone Feishu skill

When extracted, maintain backward compatibility by:
1. Keeping command syntax unchanged
2. Preserving default configuration values
3. Updating scmp-ops to call feishu-ops for base operations
