# Ops Notes

A consolidated notes file distilled from current recipes that are relevant to SCMP release flow and Feishu-driven bug fixing.

## Deploy Notes

### COS static-site policy

COS-hosted static sites need stricter safety than normal SCMP services because rollback is not as automatic.

Default rule:
- **do not treat COS upload like normal SCMP deploy**

Safer order:
1. inspect bucket contents first
2. identify the exact local folder
3. if the change is uncertain, do a temporary-file smoke test first
4. back up the remote file before overwrite
5. upload the smallest possible real change
6. verify online
7. only use directory-level `sync` when truly necessary

Preferred commands:

```bash
/opt/homebrew/bin/coscli -c /Users/xin/.cos.yaml -e cos.ap-singapore.myqcloud.com ls cos://<bucket>/ --recursive --limit 20
/opt/homebrew/bin/coscli -c /Users/xin/.cos.yaml -e cos.ap-singapore.myqcloud.com cat cos://<bucket>/<file>
/opt/homebrew/bin/coscli -c /Users/xin/.cos.yaml -e cos.ap-singapore.myqcloud.com cp <local-file> cos://<bucket>/<file>
```

### COS backup / rollback discipline

Before overwriting an existing production file in COS:

1. download the current remote file to a timestamped backup path, for example:

```bash
/opt/homebrew/bin/coscli -c /Users/xin/.cos.yaml -e cos.ap-singapore.myqcloud.com \
  cp cos://<bucket>/<file> ./output/cos-backup/<timestamp>/<file>
```

2. only then upload the new file
3. if verification fails and the issue is confirmed to be the new upload, restore by uploading the backup file back to the same COS key

Policy:
- prefer **single-file backup + single-file restore**
- do not use bulk `sync --delete` unless the user explicitly wants full-site replacement
- for tests, prefer uploading a new temporary file instead of overwriting a real production file
- for real fixes, record which exact COS keys were changed so rollback remains deterministic

### COS smoke-test rule

Safety-first default:
- before overwriting a real production key, first prove the path by uploading a temporary test file

Example:

```bash
TEST_NAME="codex-cos-upload-test-$(date +%Y%m%d-%H%M%S).txt"
/opt/homebrew/bin/coscli -c /Users/xin/.cos.yaml -e cos.ap-singapore.myqcloud.com \
  cp "./${TEST_NAME}" "cos://<bucket>/${TEST_NAME}"
```

Then verify:
- `coscli ls` can see the object
- the public website URL can fetch it if the bucket is website-hosted

Only after that should the agent overwrite a real production file.

This rule exists because:
- COS uploads do not have the same automatic rollback semantics as normal SCMP release pipelines
- smoke-testing the upload path greatly reduces the chance of damaging the live site with a wrong bucket/key/path assumption

### Branch and release discipline

- Prefer the currently deployed branch as the source of truth, not memory.
- If the project uses numbered release branches, default to incrementing the branch before editing.
- Avoid editing the live deployed branch in place unless the user explicitly wants a hot patch on the same branch.
- If the user asks to enter the existing branch first, switch there, inspect it, then bump when preparing release.

### Service name resolution

- **Never assume service name from repo directory name.**
- Always check `.deploy-service` or `.deploy-name` file before deploying.
- Wrong service deployment cannot be detected until verification fails.
- Example: deployed to `ptc-copy-calculator` instead of actual target `ptc-copy-names`, requiring re-deploy.

### Token expiry handling

- When SCMP token expires, inform user explicitly and wait for re-login.
- Do not retry with the same expired token.
- User response pattern: "已登录" (already logged in) -> retry with refreshed token.
- Use explicit `--token-file /Users/xin/.scmp_token.json` with direct `scmp_cli.py` calls to avoid session-local token issues.

- The `deploy` wrapper is convenient but not complete.
- Real token file: `/Users/xin/.scmp_token.json`
- In non-interactive Codex sessions, default to direct `scmp_cli.py` for `current` and `deploy` when SCMP state matters.
- Use direct `scmp_cli.py` when you need:
  - `--token-file`
  - explicit `--version`
  - payload inspection
  - deterministic non-interactive deploy behavior
- Skip wrapper-default token discovery, session-local token files, and temporary keychain paths if the real token file is already known good.
- Why:
  - the wrapper can still hit daily-login checks against the wrong token path
  - this wastes context without improving deployment safety

Recommended pattern:

```bash
HOME=/Users/xin python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py \
  --token-file /Users/xin/.scmp_token.json \
  current <service> <pipeline>

HOME=/Users/xin python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py \
  --token-file /Users/xin/.scmp_token.json \
  deploy <service> --env prod --branch <branch> --version <version> --no-interactive --print-payload
```

### Version bump for content changes

SCMP pipelines cache Docker images by version tag. When content changes but version stays same, deployment may fail or serve cached content.

Rule:
- Always increment branch version (e.g., `1.0.0.7` → `1.0.0.8`) for new deploys
- Use new version suffix (e.g., `04091700-1.0.0.8`)

Signal of version cache issue:
- Deploy reports "Succeeded" but content doesn't update
- Pipeline fails with image cache error

### Path inference and deploy params

Useful current behavior observed from deployment recipes and scripts:
- parameter priority should be understood as:
  - explicit CLI param
  - repo file such as `.deploy-path`
  - `currentPipelineRun` history
  - pipeline default
- `currentPipelineRun` often contains the previous deployment `path`
- pipeline `start_params` can also provide useful defaults
- when no path is needed, prefer leaving it empty rather than inventing one

### Wait and rollout timing

- `SCMP triggered` is not `release done`
- only `Succeeded` counts as successful release completion
- even after `Succeeded`, allow time for:
  - pod replacement
  - traffic switching
  - edge cache refresh
- verification-sensitive changes should use delayed recheck before concluding failure

### Cache handling

- First rely on the pipeline's own refresh step if present.
- Then verify with cache-busting query params.
- If stale data persists, use domain-level purge:

```bash
/Users/xin/refreshHost.sh
```

Equivalent request:

```bash
curl "http://cms-platform.localities.site/thousandone/domain/purgeCache?domain=<domain>"
```

Use this especially when:
- many domains share one service
- only some domains remain stale
- service-level refresh succeeded but one domain still returns old HTML/assets

### Mixed old/new instance detection

If a deploy already shows `Succeeded` but verification still flips between pass and fail, suspect mixed old/new instances before assuming the code change is wrong.

Fast check:
1. hit the same production URL 5-6 times with unique `?check=` values
2. compare the exact runtime signal each time (`title`, `meta description`, marker text, DOM count, etc.)
3. if consecutive requests alternate between old and new output, treat it as rollout convergence failure
4. re-deploy with a new version suffix before closing the bug

Why this matters:
- one lucky successful request can hide the issue
- one failed request right after `Succeeded` does not always mean the fix is wrong
- alternating responses are a stronger signal than a single stale hit

Useful pattern:

```bash
for i in 1 2 3 4 5 6; do
  curl -L -s "https://domain/path?check=$(date +%s)-$i" | rg "expected-string"
done
```

Recent evidence:
- `ptc-intention-information` release `1.0.3` needed rerun `1.0.3.1`
- `ptc-intention-information` release `1.0.5` needed rerun `1.0.5.1`
- `ptc-copy-names` releases `1.0.0.9` and `1.0.0.10` on `genmixer.com` needed repeated sampling plus purge before HTML/css verification stabilized
- `ptc-copy-names` release `1.0.0.11` on `genmixer.com` showed mixed `200/404` and old/new `robots.txt` responses after pipeline `102531` reported `Succeeded`; re-deploying the same branch as version `1.0.0.12` via pipeline `102535` made `/contact/`, `/faq/`, `/privacy/`, and `robots.txt` converge
- both cases alternated between stale and updated HTML until the second deploy converged

### Validation ladder by blast radius

Prefer the smallest validation that can still falsify the risky part of the change.

Recommended escalation order:
1. **file-level / target-level**
   - use this for narrow fixes where risk is concentrated in one file or one route
   - examples:
     - single-file checker
     - source inspection
     - one-page Playwright regression
2. **project-level**
   - use this when the change may affect multiple routes, shared templates, or build output
   - examples:
     - project-wide check script
     - build
     - representative browser pass
3. **CI-level**
   - use this when the release risk is broad enough that skipping the full gate would hide regressions
   - examples:
     - lint + checks + build

Default policy:
- do not jump straight to the heaviest validation for every tiny fix
- do not stop at the lightest validation when the blast radius is obviously wider
- for release-sensitive changes, always add at least one runtime-facing verification

### Homepage and route-ownership verification

For homepage, landing-page, or static-entry releases:
- do not assume the edited file is what actually serves the live URL
- first identify the runtime owner of the route:
  - server route
  - SSR catch-all
  - static file hosting
  - CDN / object storage

Useful checks:
- inspect server routing before editing
- `curl -I` the live URL after deploy
- verify the final body matches the intended source, not just the intended filename

This matters because:
- many projects have both static files and server-side route handlers
- `/` is often overridden by server logic even when an `index.html` exists
- editing the wrong layer can look correct in git diff but have no production effect

### Legacy URL migration verification

When a release moves or renames public URLs, treat backward-compatibility as a first-class verification target.

Minimum checklist:
1. old page URL redirects to the new page URL
2. old asset URL redirects or resolves to the new asset URL
3. query strings are preserved unless the requirement explicitly says otherwise
4. root-entry routes and old deep links both work after rollout

Helpful checks:

```bash
curl -I "https://domain/old-path"
curl -I "https://domain/old-path?from=legacy"
curl -I "https://domain/old-asset.css"
```

Do not rely on:
- front-end links being updated
- one HTML page looking correct
- build success alone

If old links may still exist in SEO, bookmarks, ads, or third-party embeds, redirect verification is part of release completion.

## Bug-Fix Notes

### Language context discipline

**Rule**: For clone/copy sites of English originals (like randomlists.com), all content must remain in English.

**Applies to**:
- h1 titles
- seoTitle, seoDescription  
- Popup messages
- UI text
- Navigation labels

**Common failure mode**: User says "AI 生成" or provides Chinese instructions for an English site. This means "generate appropriate English content with AI", NOT "translate to Chinese".

**Evidence**: 
- User corrected: "我都是英文的网站 来一个 ai 生成 作为 title???"
- User corrected: "永远不要在我的页面出现中文!!!!!!!!! 全站是英文网页"

**How to apply**:
1. Check the target site's language first
2. When user says "AI generate" for an English site, generate English content
3. Never translate English site content to Chinese unless explicitly instructed

### Feishu-driven bug workflow

- Treat Feishu bug rows as the operating source when the task is explicitly Feishu-driven.
- Use exact `base / table / view` when provided.
- If the task is AI-handled bug flow:
  - before coding -> `AI FIXING`
  - after deploy + verification -> `AI DONE`
- Never mark `AI DONE` before real online verification is complete.

### Owner and scope discipline

- Apply strict ownership filters when the workflow requires it.
- If the user's convention is to only process bugs owned by a specific person, re-apply that filter every rescan.
- Do not update neighboring or similarly named records just because they look related.

### Safe Feishu writes

- Prefer the real user environment:

```bash
HOME=/Users/xin /Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli ...
```

- If `lark-cli` says `not configured`, first suspect bad `HOME`, not missing auth.
- For select fields such as `项目状态`, prefer array payloads.
- After `record-upsert`, always follow with `record-get` to confirm the actual persisted value.

### How to validate bugs before batch updates

- Prefer representative-page verification before batch changes.
- Do not bulk-update Feishu statuses before representative validation passes.
- Before batch status changes, recompute or re-fetch fresh record ids to avoid writing stale targets.
- For high-volume bug lists, scan and shrink the problem set first; do not assume a full green pass from one sample page.

### Runtime truth beats source truth

- For UI, ad, SEO, and SSR bugs, runtime output is the decisive truth.
- Do not rely only on:
  - repo source
  - template files
  - generated static fragments
- Validate the actual rendered page or actual network behavior.

### Runtime-first residual scan for transformed pages

- If a project rewrites HTML at request time through Express middleware, SSR handlers, template injection, or similar server transforms, start clone-trace / legal / SEO residual scans from the HTTP response, not from raw `public/` or template source.
- Use representative runtime checks first, for example:
  - `curl -s https://domain/robots.txt`
  - `curl -s https://domain/about-us.html | rg 'calculator\\.net|Maple Tech'`
  - `curl -s https://domain/sitemap.xml | sed -n '1,20p'`
- Only after a runtime hit is confirmed should source grep be used to find the generator/root cause.
- This avoids false positives when upstream strings still exist in source files but are rewritten before production response is sent.

### Screenshot-first debugging

If a bug includes screenshots or annotated attachments:
- do not infer only from text
- inspect the attachment first
- use the image to determine the exact wrong slot/position/visual mismatch

### Ad and runtime debugging lessons

- `iframe exists` is not equal to `ad filled`
- `adsbygoogle-status="done"` is not enough to conclude success
- duplicated slots across desktop/mobile variants can create misleading runtime outcomes
- for blank-ad bugs, verify both:
  - runtime state machine
  - container collapse/hide behavior
- if hide logic is too aggressive, consider bounded retry before deciding the slot is permanently failed

### Display-ad layout verification on mobile

For pages that contain display ads above real content:
- do not trust the placeholder size alone
- verify the container can grow with the real creative height
- verify the content below the ad does not get overlapped or visually pushed into the ad area

Recommended creative matrix:
- `300x250`
- `336x280`
- `336x320`

Recommended viewport matrix:
- one small iPhone-sized viewport
- one common modern iPhone viewport
- one wider phone viewport
- one small Android viewport

Recommended assertions:
1. ad container height is at least the rendered creative height
2. no overlap between ad bottom and the next content block
3. homepage / save-card / CTA spacing remains readable after ad fill

Preferred verification style:
- inject a mock creative with the target dimensions
- measure actual spacing or overlap in the browser
- use screenshots only as supporting evidence, not the only check

## Verification Lessons

### Reference original site for clone/copy sites

For clone/copy sites (like randomlists.com copies), always reference the original site when fixing bugs.

Check original site for:
- Header structure and navigation links
- UI behavior and interactions
- Content format and styling
- Footer vs header link placement

The original site defines expected behavior, not assumptions.

Example: Bug "导航栏多了几个超链接" was fixed by checking randomlists.com header shows only generator links, FAQ/Privacy/Contact are in footer not header.

### Three-stage verification

Use this as the default for release-sensitive or bug-sensitive changes:
1. 首验
2. 延迟复验
3. 清缓存后复验

Interpretation:
- first fail + delayed pass => rollout/cache timing issue
- delayed fail + post-purge pass => cache issue
- still failing after recheck and purge => likely code/config issue

### Tracking-specific validation

For tracking or analytics tasks, successful verification should include all of:
1. expected base code in returned HTML
2. real browser/network event observed
3. domain-specific event label or id confirmed
4. wait matched to business trigger, with a small buffer

## Distilled Source Themes

These notes were consolidated from current deployment and bug-fix recipes, especially around:
- SCMP deploy behavior and wrapper limitations
- Feishu and `lark-cli` write safety
- representative validation before batch bug state changes
- runtime-first verification for SSR, SEO, ad, and tracking issues
