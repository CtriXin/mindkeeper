# Ad Bug Notes

Detailed Feishu ad-bug triage and runtime debugging rules for personal SCMP workflows.

## Feishu attachment inspection

When a bug record contains screenshots/attachments and the visual note matters:

1. Read the record first to get `file_token`.
2. Fetch a temporary download URL:

```bash
HOME=/Users/xin lark-cli api GET /open-apis/drive/v1/medias/batch_get_tmp_download_url \
  --params '{"file_tokens":"<file_token>"}'
```

3. Download with `curl -L '<tmp_download_url>' -o <file>`.
4. Inspect the screenshot locally before deciding which ad slot / position is wrong.

Use this path when the issue text says things like:
- “标红了”
- “截图里圈出来了”
- “广告还有一个不对”

Do not assume cell text alone captures visual annotations.

## Feishu bug triage classification

Before touching code, classify each ad-related bug into one of these buckets:

1. `位置不对`
2. `slot 不对`
3. `空白区域没隐藏`
4. `没有 iframe`
5. `desktop/mobile 分叉`
6. `旧广告残留`

Use the bucket to decide the fix path:
- `位置不对` -> compare placement sheet + screenshot; adjust placement anchors
- `slot 不对` -> compare exact ad slot in sheet/config/runtime
- `空白区域没隐藏` -> inspect state machine + collapse CSS/DOM
- `没有 iframe` -> verify whether the ad should render or should stay hidden
- `desktop/mobile 分叉` -> validate each device independently
- `旧广告残留` -> separate cleanup commit if not required for immediate release

## Feishu table-reading rule for ad sheets

For advertising placement sheets such as Feishu Sheets:

1. Read the exact sheet tab the user references.
2. Treat `位置描述（以mobile为主）` and screenshot columns as authoritative.
3. If table text and screenshots disagree, prefer the screenshot/annotation evidence and record the conflict explicitly.
4. For cross-device ad issues, verify desktop and mobile separately; never infer one from the other.
5. If a bug says “还有一个广告不对 / 标出来了”, do not guess from the row text alone; inspect the attachment and locate the exact slot/position mismatch first.
6. If a row defines different positions for mobile and desktop, implement them as truly separate placements. Do not assume one shared placement is acceptable.
7. If text says one thing but the screenshot clearly marks another target, prefer the screenshot and record that the sheet text and visual evidence differ.
8. If the sheet uses ordinal placement language such as:
   - `第4张卡片下方`
   - `第一行卡片下方`
   - `首个加粗标题上方`
   then verify the rendered DOM order explicitly instead of only checking slot id presence.
9. For card-grid placements, count the number of preceding `.article-card` siblings before the ad container.
   - this catches `slot correct but anchor wrong` regressions
10. For content placements, compare the ad container against semantic anchors such as:
   - `.article-hero-img`
   - first `h2`
   - first strong-heading block
   and confirm the ad is before/after the intended anchor, not merely somewhere nearby.

## Ad runtime lessons for static/SSR sites

When the task involves AdSense lazy-loading or “no iframe / blank ad area” bugs:

1. Do not treat `iframe exists` as equivalent to `filled`.
   - Correct final-state logic is:
     - `data-ad-status="filled"` -> show
     - `data-ad-status="unfilled"` -> hide
     - `data-ad-status="error"` -> hide
2. `adsbygoogle-status="done"` is not enough to conclude success.
   - `done` without `filled` may still require hiding or retry.
3. If the same ad slot is rendered twice in the same page for desktop/mobile variants, it can create ambiguous or suppressed load behavior.
   - Prefer one active instance per slot in the returned HTML.
   - For server-rendered pages, request-time UA-specific rendering is often safer than outputting both variants and hiding one with CSS.
4. For “广告不出来时候没有隐藏区域” bugs, check both:
   - state machine logic
   - container collapse behavior after the slot becomes hidden
5. For “没有iframe” bugs, do not automatically interpret them as a hide/show issue.
   - Sometimes the requirement is that the ad should actually render, not merely avoid blank space.
6. If the ad runtime hides too aggressively after first failure, add bounded retry logic before concluding hidden/failed.
7. For homepage/hero ads, pure scroll-trigger loading can be too conservative.
   - Near-above-the-fold slots may require more aggressive initial loading than deep content slots.
8. When a homepage slot should load immediately, do not rely only on scroll intersection.
   - Either trigger load eagerly for homepage shells or use a different preload strategy.
9. If mobile/desktop variants share the same slot id, never render both as active candidates in the same returned HTML when the runtime can avoid it.
10. If a hidden ad still occupies space, collapse not only the outer shell but also inspect:
   - `ins.adsbygoogle`
   - injected `iframe`
   - injected `aswift_*` hosts
11. For static category/home/article templates, duplicated desktop/mobile slot instances can push the visible instance into `failed`.
   - prefer pruning the inactive responsive variant before lazy-load initialization
   - do not rely on CSS hiding alone when both variants share the same `data-ad-slot`
12. A useful state split is:
   - `failed` -> investigate load flow, duplicated instances, or script timing
   - `loaded + unfilled + hidden` -> usually correct collapse, not a rendering bug by itself
   - `loaded + visible + empty` -> likely a visibility/collapse bug

## Homepage ad-specific rules

For homepage ad systems:

1. Validate desktop homepage and mobile homepage separately.
2. Use a real mobile `user-agent`, not only a narrow viewport, when the server output depends on device detection.
3. If the server renders by `UA`, capture both desktop and mobile returned HTML before debugging runtime behavior.
4. For homepage slots, verify:
   - expected slot exists in returned HTML
   - expected slot receives a final state
   - expected slot either has creative or is correctly hidden

## "No iframe" investigation rule

When a bug says "没有 iframe":

1. First determine whether the slot should be visible at all.
2. Check:
   - final `data-ad-status`
   - `adsbygoogle-status`
   - shell visibility
   - iframe presence
3. Only treat "no iframe" as a rendering bug if the slot is expected to render and is not in a hidden final state.
4. If the slot ends in `unfilled` and the shell is fully collapsed, the absence of `iframe` is not itself a bug.
5. If a slot repeatedly lands in `failed`, inspect whether the same slot id appears in both hidden and visible responsive variants before changing retry logic.

## Old ad residue policy

When the repo still contains legacy GPT/DoubleClick snippets:

1. Distinguish runtime safety from source cleanliness.
2. If runtime already strips old ads, legacy residue is technical debt, not necessarily an urgent production bug.
3. Prefer a separate cleanup commit for bulk source cleanup so it does not mix with state-machine/placement hotfixes.

## Batch HTML editing policy

When bulk-editing many static HTML files:

1. Define a narrowly scoped match pattern first.
2. Test on 3-5 representative pages before the full sweep.
3. After replacement, count residual matches and confirm the expected count reaches zero.
4. Spot-check representative pages after the sweep to ensure no layout blocks were accidentally removed.

## Deployment verification policy

After deploy, verify in layers:

1. returned HTML/source
2. runtime DOM behavior
3. business-visible outcome

For ad bugs, "verified" should usually include:
- slot presence or absence is correct
- final visibility is correct
- iframe/state outcome matches the intended business rule

## Device verification policy

For any cross-device fix:

1. verify desktop separately
2. verify mobile separately
3. if server-side rendering differs by device, use mobile UA in addition to mobile viewport
4. never close the bug based on only one device side unless the requirement explicitly says single-device

## Runtime evidence checklist

For browser-based ad debugging, capture at least:

- slot id
- slot instance count in the returned DOM
- `data-ad-status`
- `adsbygoogle-status`
- shell/container class
- computed `display`
- computed height
- whether an iframe exists

This evidence avoids misclassifying:
- hidden-but-correct
- visible-but-empty
- no-iframe-but-expected-hidden
- slot not inserted at all
