# Learnings Inbox

A lightweight inbox for new lessons discovered during SCMP-driven work.

Purpose:
- capture fresh mistakes, corrections, and better methods quickly
- avoid bloating `SKILL.md` with unproven rules
- give future sessions a staging area before promoting lessons to stable SOP

## Promotion rule

Use this decision ladder:

1. **single occurrence**
   - write here first
2. **repeated or cross-project**
   - move to:
     - `references/ops-notes.md`
     - or `references/ad-bug-notes.md`
3. **stable default behavior**
   - promote to `SKILL.md`

Promote only when the lesson is:
- repeated `2-3` times or more
- validated by concrete evidence
- useful across projects
- costly to forget

Do not promote when the lesson is:
- a one-time incident
- still ambiguous
- only relevant to one temporary page structure
- mostly personal preference rather than operational safety

## Capture template

Use this compact format:

```markdown
## YYYY-MM-DD short-title

- **Type**: bug | correction | deploy | verify | feishu | ads | cache | cos
- **Scope**: single-project | cross-project
- **Signal**: what happened
- **Lesson**: what should be remembered
- **Evidence**: command / screenshot / runtime state / page / record id
- **Promote-if**: what would justify moving this into stable notes
```

## 2026-04-09 feishu-module-extraction-trigger [META-RULE]

- **Type**: feishu | architecture
- **Scope**: cross-project
- **Signal**: Feishu module (`references/feishu-workflows.md`) accumulates new independent features
- **Lesson**: When Feishu/lark-cli operations grow beyond SCMP-coupled workflows, extract to standalone `feishu-ops` skill
- **Trigger conditions** (any one justifies extraction):
  1. 3+ non-SCMP Feishu operations added (pure data tasks without deploy)
  2. User explicitly requests standalone Feishu skill again
  3. Cross-project Feishu workflows emerge (e.g., Feishu-only automation, multi-platform integrations)
  4. `feishu-workflows.md` exceeds ~400 lines with reusable content
  5. OpenClaw/Hermes Agent integration requires independent Feishu tool layer
- **Extraction target**: `feishu-ops/SKILL.md` with `references/feishu-workflows.md` as base
- **LLM reminder**: At start of any session involving Feishu operations, check if trigger conditions are met. If yes, prompt user: "Feishu module has grown — ready to extract to feishu-ops skill?"

## 2026-04-09 feishu-base-token-from-wiki-doc [PROMOTED to SKILL.md]

- **Type**: feishu
- **Scope**: cross-project
- **Signal**: wiki doc token "LAxNw1U9yiOvqMkxMjccLUCtnRe" returned error 800010608 "invalid recordId format" when used as base token
- **Lesson**: wiki URL embeds Bitable table, but wiki doc token ≠ Bitable base token. Must query `/open-apis/bitable/v1/apps/{wiki_doc_token}` to get actual base token (e.g., "I7m2bnPDgaYnwksqp1jcmmW9nOd")
- **Evidence**: record-get failed with wiki token, discovered correct base token via bitable apps API, then successfully updated 6 records with `lark-cli base +record-upsert --base-token I7m2bnPDgaYnwksqp1jcmmW9nOd`
- **Promoted**: 2026-04-09 to SKILL.md "Feishu base token resolution" section

## 2026-04-09 feishu-batch-status-update-workflow [PROMOTED to SKILL.md]

- **Type**: feishu
- **Scope**: cross-project
- **Signal**: needed to update 6 AI 名字生成器 bug records from "AI FIXING" to "AI DONE"
- **Lesson**: batch status update workflow: (1) list records with filter, (2) extract record_ids, (3) upsert each with `--json '{"项目状态":["AI DONE"]}'`, (4) read-back verify each record
- **Evidence**: successfully updated recvgbNXge0Tzw, recvgbOhICPKIu, recvgbI7LyN6o8, recvgbIE6gtWXG, recvgbiPrjlMJw, recvgbcgSNschF
- **Promoted**: 2026-04-09 to SKILL.md "Feishu batch status update" section

## 2026-04-09 wrong-service-deployment-assumption [PROMOTED to ops-notes.md]

- **Type**: deploy
- **Scope**: cross-project
- **Signal**: deployed to `ptc-copy-calculator` instead of actual target service `ptc-copy-names`
- **Lesson**: always check `.deploy-service` or `.deploy-name` file before deploying, never assume service name from repo directory name
- **Evidence**: deploy succeeded but to wrong service, requiring re-deploy after fixing `.deploy-service` metadata
- **Promoted**: 2026-04-09 to ops-notes.md "Service name resolution" section

## 2026-04-09 chinese-text-literal-misunderstanding [PROMOTED to ops-notes.md]

- **Type**: correction
- **Scope**: cross-project
- **Signal**: user asked for "ai 生成" in English website context, interpreted as literal Chinese text instead of "AI-generated appropriate English content"
- **Lesson**: when user says "AI generate" in context of an English site with Chinese instructions, clarify whether they want literal translation or AI-generated English content matching the site's language
- **Evidence**: user corrected "我都是英文的网站 来一个 ai 生成 作为 title???" indicating mismatch between instruction interpretation and actual intent
- **Promoted**: 2026-04-09 to ops-notes.md "Language context discipline" section

## 2026-04-09 static-site-recursive-html-cache [PROMOTED to ops-notes.md]

- **Type**: cache
- **Scope**: cross-project
- **Signal**: Next.js static export puts generator pages in subdirectories (`/[slug]/index.html`), but `static-server.js` only cached root HTML files
- **Lesson**: for static-export sites with nested routes, ensure HTML caching recursively traverses all subdirectories, not just root level
- **Evidence**: generator page titles showed default instead of domain-specific content until `cacheHtmlFiles` was made recursive with prefix parameter
- **Promoted**: 2026-04-09 to ops-notes.md "Cache handling" section

## 2026-04-09 scmp-token-expiry-blocks-deploy [PROMOTED to ops-notes.md]

- **Type**: deploy
- **Scope**: cross-project
- **Signal**: `scmp_cli.py` returned token expired error mid-deployment flow
- **Lesson**: when SCMP token expires, inform user explicitly and wait for re-login rather than retrying with same token
- **Evidence**: deploy failed with auth error, user responded "已登录" (already logged in), then retry succeeded
- **Promoted**: 2026-04-09 to ops-notes.md "Token expiry handling" section

## 2026-04-09 english-site-chinese-content-mistake [PROMOTED to ops-notes.md]

- **Type**: correction
- **Scope**: cross-project
- **Signal**: user correction "永远不要在我的页面出现中文!!!!!!!!! 全站是英文网页" after adding Chinese popup message and translating h1/seo to Chinese
- **Lesson**: for copy/clone sites of English originals (like randomlists.com), all content must remain in English: h1 titles, seoTitle, seoDescription, popup messages, UI text. Never translate to Chinese unless explicitly instructed for a Chinese-language site.
- **Evidence**: User explicitly corrected after I changed thank you popup to Chinese "谢谢——很快就会有人审核这个页面" and translated generator h1 titles; had to revert all changes to English
- **Promoted**: 2026-04-09 to ops-notes.md "Language context discipline" section

## 2026-04-09 deploy-version-bump-required [PROMOTED to ops-notes.md]

- **Type**: deploy
- **Scope**: cross-project
- **Signal**: deploy reported "Succeeded" but content didn't update, pipeline failed with image cache issue
- **Lesson**: SCMP pipelines cache Docker images by version tag. When content changes but version stays same, deployment may fail or serve cached content. Always increment branch version (e.g., 1.0.0.7 → 1.0.0.8) and version suffix for new deploys.
- **Evidence**: Deploy to 1.0.0.7 failed with "Failed" reason on deploy task, user explained "你的内容根本没有变化 才会报这个"; succeeded after creating branch 1.0.0.8 with new version suffix 04091700-1.0.0.8
- **Promoted**: 2026-04-09 to ops-notes.md "Version bump for content changes" section

## 2026-04-09 reference-original-site-for-bugs [PROMOTED to ops-notes.md]

- **Type**: verify
- **Scope**: cross-project
- **Signal**: User instructed "你去参考原网站 我们当前站是复制站 https://randomlists.com 这个是原站 我们的问题 都要看原来怎么做到"
- **Lesson**: For clone/copy sites, always reference the original site when fixing bugs: check header structure, navigation links, UI behavior, content format. The original site defines the expected behavior, not assumptions.
- **Evidence**: Bug "导航栏多了几个超链接" was fixed by checking randomlists.com header shows only generator links, FAQ/Privacy/Contact are in footer not header; confirmed our filter approach was correct
- **Promoted**: 2026-04-09 to ops-notes.md "Reference original site for clone/copy sites" section


## 2026-04-02 duplicated-responsive-slot-fails-load

- **Type**: ads
- **Scope**: cross-project candidate
- **Signal**: same `data-ad-slot` rendered in both hidden and visible responsive variants caused the visible instance to land in `failed`
- **Lesson**: for shared mobile/desktop slot ids, prune the inactive responsive variant before lazy-load initialization instead of relying on CSS hiding alone
- **Evidence**: live runtime showed duplicated slot instances, `failed` load state, and recovery after keeping only one DOM instance per device
- **Promote-if**: seen again in another static/SSR site or confirmed as the default safe pattern for shared-slot responsive ads

## 2026-04-02 cache-busted-asset-new-but-normal-asset-old

- **Type**: cache
- **Scope**: cross-project candidate
- **Signal**: `asset.js?check=<ts>` showed the new file, but the normal production asset URL still returned the stale version due to edge cache
- **Lesson**: for shared static assets on `COS website`, verify both cache-busted and normal asset URLs and treat domain purge as part of rollout
- **Evidence**: `curl` output, differing `content-length` / `etag`, and post-purge convergence
- **Promote-if**: repeated in another `COS website` release or accepted as the standard verification rule for shared assets

## 2026-04-02 ordinal-placement-needs-dom-check

- **Type**: ads
- **Scope**: cross-project candidate
- **Signal**: slot id was correct, but the live mobile placement was one card too late compared with the Feishu sheet
- **Lesson**: if the placement description uses ordinal language such as `第 4 张卡片下方`, verify sibling order in the rendered DOM rather than only checking slot id presence
- **Evidence**: Feishu sheet `8INqsy`, screenshot annotation, and Playwright count of preceding `.article-card` siblings
- **Promote-if**: the same mismatch pattern appears again in another sheet-driven static page workflow

## 2026-04-10 succeeded-but-mixed-instance-responses [PROMOTED to ops-notes.md]

- **Type**: deploy | cache
- **Scope**: cross-project
- **Signal**: SCMP pipeline `Succeeded`, but the same production URL alternated between old HTML and new HTML across consecutive cache-busted requests
- **Lesson**: after deploy success, if one URL flips between old/new content across repeated requests, suspect mixed old/new instances rather than unfinished code push; verify by hitting the same URL 5-6 times with unique query params, then re-deploy before closing
- **Evidence**: first observed in `ptc-intention-information` release `1.0.3` / rerun `1.0.3.1`; repeated again in `ptc-intention-information` release `1.0.5` / rerun `1.0.5.1`, where category/about/contact/legal pages alternated between stale and updated HTML until the second deploy converged
- **Promoted**: 2026-04-10 to `ops-notes.md` "Mixed old/new instance detection"

## 2026-04-10 feishu-title-needs-attachment-context

- **Type**: correction | feishu
- **Scope**: cross-project candidate
- **Signal**: bug title was too vague, and the real issue details were only clear from Feishu attachment / screenshot content
- **Lesson**: when a Feishu bug title is generic or mismatched to the symptom, inspect the record's attachments/screenshots first and treat them as part of the bug statement before asking the user for clarification
- **Evidence**: user correction on `ptc-intention-information`: “这种标题不对 后面会有附件 或者 图 你自己读好了 然后修复”; current record `recvgmDfwNiRpO` included attachment `image.png`
- **Promote-if**: this attachment-first interpretation saves time again in another Feishu-driven bug-fix session or becomes the default expectation for the bug table

## 2026-04-10 feishu-sheet-yellow-highlight-targets

- **Type**: feishu | verify
- **Scope**: cross-project candidate
- **Signal**: user said “标黄的不对”, and the actionable bug scope lived in highlighted spreadsheet cells rather than in a conventional record title
- **Lesson**: for Feishu wiki pages that resolve to `sheet`, export the spreadsheet and inspect highlighted cells first; yellow fill can define which metadata/content fields are wrong, so do not infer the target only from page title or sheet name
- **Evidence**: wiki `Rzg1whvmziOLPZkqBrXctUiQnwf` resolved to sheet `YiVOs1Z3HhxkiUtqHWLcj7nFnzf`; exporting xlsx and reading yellow-filled cells identified `thenexuslife.com` homepage/category/legal-page metadata, `Firebase`, `verify code`, and `ads.txt` as the actual fix scope
- **Promote-if**: another Feishu-driven site-fix uses highlighted spreadsheet cells as the source of truth, or this becomes a frequent workflow in website cloning tasks

## 2026-04-10 feishu-record-list-tabular-shape

- **Type**: feishu
- **Scope**: cross-project candidate
- **Signal**: `lark-cli base +record-list` returned tabular payload fields `data.data` + `fields` + `record_id_list` instead of an `items` array
- **Lesson**: when rescanning Feishu Bitable records, inspect the payload shape first and be ready to reconstruct records by zipping `fields`, row arrays, and `record_id_list`; assuming `data.items` can silently miss open bugs
- **Evidence**: AI名字生成器 rescan initially showed `MATCHED_TOTAL 0` because the parser expected `data.items`; raw payload showed `131` rows in `data.data`, and reconstructing rows surfaced the remaining three `已创建` bugs `recvgnf47pp6V9`, `recvgngaJxOU0C`, `recvgngxjFqfly`
- **Promote-if**: seen again in another Feishu table or confirmed as the stable default response shape of this `lark-cli` command

## 2026-04-10 static-layout-fix-needs-live-css-verification

- **Type**: verify | cache
- **Scope**: cross-project candidate
- **Signal**: HTML markers already looked correct, but the remaining risk was a pure layout/style bug, so HTML-only verification was insufficient
- **Lesson**: for static-site style/layout fixes, verify the live CSS bundle referenced by production HTML and grep for the exact selector/rule that was changed; this catches cases where HTML is fresh but the stylesheet is still stale or not the expected bundle
- **Evidence**: `genmixer.com/canadian-addresses` fix lived in `.addressItem`; production HTML referenced `/_next/static/chunks/14ztb~7e9tofv.css`, and fetching that asset confirmed `.addressItem{word-break:break-word;overflow-wrap:anywhere;min-width:0;max-width:100%}` after deploy `1.0.0.10`
- **Promote-if**: another SCMP static-site release needs CSS-bundle verification to close a layout-only bug, or this becomes a regular false-pass pattern

## 2026-04-12 ssr-dynamic-route-should-fallback-to-static-middleware

- **Type**: deploy | routing
- **Scope**: cross-project candidate
- **Signal**: `ptc-intention-information` dynamic article route `/articles/:category/:slug` returned 404 for old static `.html` articles after adding `.html` suffix support; old articles still existed as `public/articles/**/*.html`
- **Lesson**: when an Express SSR service adds dynamic routes that overlap with legacy static file paths, a missing dynamic payload (JSON/template) should `return next()` instead of `res.status(404).sendFile('404.html')`. This lets downstream `express.static` middleware serve matching legacy static files, and only returns a hard 404 if no static file exists either.
- **Evidence**: `server.js` originally did `if (!htmlRaw) return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'))` inside `/articles/:category/:slug`, causing `https://lifestyle.gogameskill.com/articles/business/best-business-credit-cards-...html` to 404 even though `public/articles/business/best-business-credit-cards-...html` existed. Changing to `if (!htmlRaw) return next()` fixed it.
- **Promote-if**: another SSR migration project needs to support both new dynamic articles and old static HTML articles on overlapping paths

## 2026-04-13 session-only-runtime-state-must-not-persist

- **Type**: correction | verify
- **Scope**: cross-project candidate
- **Signal**: startup snapshot guard blocked launch because an account-level `settings.json` changed after one runtime session
- **Lesson**: when a tool writes per-session runtime env (proxy, fake mode, CA path, timezone, session HOME hints), never copy that payload back into account-level or user-level config verbatim; strip session-only keys before persistence, and strip the same keys from config drift snapshots to avoid false-positive guard blocks
- **Evidence**: MMS copied session `.claude/settings.json` back to account home, persisting `HTTP_PROXY`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `MMS_FAKE_UPSTREAM_*`, then `startup pending.json` reported `file changed: .../.claude/settings.json`
- **Promote-if**: the same persistent-vs-session config contamination appears again in another launcher, deploy helper, or CLI wrapper

## 2026-04-13 mixed-installation-signature-compatibility

- **Type**: bug | deploy
- **Scope**: cross-project candidate
- **Signal**: one machine worked locally, but a colleague hit a runtime `TypeError` because launcher code passed a new keyword argument to an older installed module
- **Lesson**: if the distribution model allows partial updates or mixed install states, caller-side compatibility guards are safer than assuming every callee has the newest signature; filter unsupported kwargs or version-gate the call before execution
- **Evidence**: `gateway_claude_bridge(..., strip_upstream_user_agent=...)` worked in repo but failed in installed `~/.mms` with `unexpected keyword argument 'strip_upstream_user_agent'`; resolved by checking the callable signature and dropping unknown kwargs with a visible downgrade hint
- **Promote-if**: repeated in another installed-tool workflow where users frequently run mixed launcher/module versions
