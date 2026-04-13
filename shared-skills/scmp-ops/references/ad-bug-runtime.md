# Ad Bug Runtime Checklist

AdSense / lazy-load / "no iframe" / placement debugging rules.

---

## Bug Classification

Before coding, classify each ad-related bug into one of these buckets:

| Bucket | Fix Path |
|--------|----------|
| `位置不对` | Compare placement sheet + screenshot; adjust placement anchors |
| `slot 不对` | Compare exact ad slot in sheet/config/runtime |
| `空白区域没隐藏` | Inspect state machine + collapse CSS/DOM |
| `没有 iframe` | Verify whether the ad should render or should stay hidden |
| `desktop/mobile 分叉` | Validate each device independently |
| `旧广告残留` | Separate cleanup commit if not required for immediate release |

---

## Runtime Truth Rules

1. **Screenshot-first debugging**
   - For screenshot-led ad bugs, screenshots outrank plain cell text when they conflict
   - Inspect attachments before inferring from text alone

2. **Iframe existence is not truth**
   - Do not treat `iframe exists` as equivalent to `filled`
   - Do not treat `adsbygoogle-status="done"` as equivalent to successful render

3. **Final state logic**
   - `filled` → show
   - `unfilled` / `error` → hide

4. **Hidden ad occupying space**
   - Inspect both outer shell/container AND injected elements
   - Check: `ins.adsbygoogle`, injected `iframe`, injected `aswift_*`

5. **"没有 iframe" is not automatically a bug**
   - First decide whether the slot is supposed to render or supposed to end hidden

---

## Device Verification

1. **Desktop and mobile are separate**
   - Verify desktop separately
   - Verify mobile separately
   - If server output changes by device, mobile verification must use a real mobile `user-agent`, not only a narrow viewport

2. **Homepage ad strategies may differ**
   - Desktop homepage → stability-first, more eager
   - Mobile homepage → visibly delayed load

3. **Capture this evidence for each device**:
   - Slot id
   - `data-ad-status`
   - `adsbygoogle-status`
   - Shell/container class
   - Computed `display`
   - Computed height
   - Whether an iframe exists

---

## Slot Duplication Issues

If one slot id is duplicated for desktop/mobile in the same returned HTML:

1. Expect load suppression or ambiguous behavior
2. Prefer one active slot instance per request when runtime can avoid duplication
3. For server-rendered pages, request-time UA-specific rendering is safer than outputting both variants and hiding one with CSS

---

## Delayed Loading UX

If the task specifically asks for visible delayed-loading effect:

1. Treat that as a UX requirement, not just a technical lazy-loading requirement
2. Use smaller `rootMargin`
3. Use a post-intersection delay if needed

---

## Feishu Attachment Inspection

When a bug record contains screenshots/attachments and the visual note matters:

1. Read the record first to get `file_token`
2. Fetch a temporary download URL:

```bash
HOME=/Users/xin lark-cli api GET /open-apis/drive/v1/medias/batch_get_tmp_download_url \
  --params '{"file_tokens":"<file_token>"}'
```

3. Download with `curl -L '<tmp_download_url>' -o <file>`
4. Inspect the screenshot locally before deciding which ad slot / position is wrong

Use this path when the issue text says things like:
- "标红了"
- "截图里圈出来了"
- "广告还有一个不对"

---

## Feishu Table-Reading Rules

For advertising placement sheets:

1. Read the exact sheet tab the user references
2. Treat `位置描述（以 mobile 为主）` and screenshot columns as authoritative
3. If table text and screenshots disagree, prefer the screenshot/annotation evidence and record the conflict explicitly
4. If a row defines different positions for mobile and desktop, implement them as truly separate placements
5. If text says one thing but the screenshot clearly marks another target, prefer the screenshot and record that the sheet text and visual evidence differ

### Ordinal Placement Language

If the sheet uses ordinal placement language such as:
- `第 4 张卡片下方`
- `第一行卡片下方`
- `首个加粗标题上方`

Then verify the rendered DOM order explicitly instead of only checking slot id presence.

For card-grid placements, count the number of preceding `.article-card` siblings before the ad container — this catches `slot correct but anchor wrong` regressions.

---

## State Machine Lessons

Useful state split for debugging:

| State | Investigation Focus |
|-------|---------------------|
| `failed` | Load flow, duplicated instances, script timing |
| `loaded + unfilled + hidden` | Usually correct collapse, not a rendering bug |
| `loaded + visible + empty` | Likely a visibility/collapse bug |

---

## Old Ad Residue Policy

When the repo still contains legacy GPT/DoubleClick snippets:

1. Distinguish runtime safety from source cleanliness
2. If runtime already strips old ads, legacy residue is technical debt, not necessarily an urgent production bug
3. Prefer a separate cleanup commit for bulk source cleanup so it does not mix with state-machine/placement hotfixes

---

## Batch HTML Editing Policy

When bulk-editing many static HTML files:

1. Define a narrowly scoped match pattern first
2. Test on 3-5 representative pages before the full sweep
3. After replacement, count residual matches and confirm the expected count reaches zero
4. Spot-check representative pages after the sweep to ensure no layout blocks were accidentally removed

---

## Deployment Verification Policy

After deploy, verify in layers:

1. Returned HTML/source
2. Runtime DOM behavior
3. Business-visible outcome

For ad bugs, "verified" should usually include:
- Slot presence or absence is correct
- Final visibility is correct
- Iframe/state outcome matches the intended business rule
