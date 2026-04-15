# Promotion Log

Short audit trail of what was promoted into the SCMP skill system.

Use this to avoid:
- re-promoting the same lesson
- forgetting why something became a rule
- losing the evidence trail behind a stable behavior

## Entry format

```markdown
## YYYY-MM-DD short-title

- **Promoted from**: inbox | recipe | direct task lesson
- **Promoted to**: SKILL.md | ops-notes.md | ad-bug-notes.md
- **Reason**: repeated / cross-project / expensive to forget / validation strength
- **Evidence**: commands, runtime result, page, record id, screenshots
```

## Entries

## 2026-04-02 cos-shared-asset-cache-verification

- **Promoted from**: inbox
- **Promoted to**: `scmp-ops/SKILL.md`
- **Reason**: shared static assets on COS can appear updated with cache-busting while still stale on the normal production URL; this is high-cost to forget and easy to verify
- **Evidence**: `curl` with and without query params, differing `etag` / `content-length`, and post-purge convergence on `lifestyle.gogameskill.com`

## 2026-04-02 duplicated-responsive-slot-load-failure

- **Promoted from**: inbox
- **Promoted to**: `scmp-ops/references/ad-bug-notes.md`
- **Reason**: repeated runtime pattern inside the same bug family, reusable for future static/SSR ad debugging, but still too detailed for the main SOP
- **Evidence**: duplicated `data-ad-slot` DOM instances, `failed` load state, and recovery after pruning inactive responsive variants

## 2026-04-02 ordinal-placement-dom-verification

- **Promoted from**: inbox
- **Promoted to**: `scmp-ops/references/ad-bug-notes.md`
- **Reason**: sheet-driven placement language such as `第4张卡片下方` requires DOM order checks, not only slot-id checks; broadly useful in ad-placement work
- **Evidence**: Feishu sheet `8INqsy`, screenshot annotation, and Playwright count of preceding `.article-card` siblings

## 2026-04-03 explicit-real-token-file-for-scmp

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/SKILL.md`
- **Reason**: in isolated Codex sessions, spending turns on wrapper-default token paths or session-local keychain/token copies is expensive and unnecessary once `/Users/xin/.scmp_token.json` is known good; this is cross-project and costly to forget
- **Evidence**: `copy_calculator` deploy session wasted context on wrapper/default token probing before switching to `HOME=/Users/xin` plus explicit `--token-file /Users/xin/.scmp_token.json`, after which SCMP deploy succeeded

## 2026-04-03 runtime-first-residual-scan

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: transformed-page projects can leave upstream strings in source while serving corrected runtime HTML; scanning source first creates false positives and context waste
- **Evidence**: `copy_calculator` kept old strings in `public/*.html`, but `static-server.js` rewrote runtime responses; runtime `curl` checks correctly identified what was actually exposed on `oaktreetrio.com`

## 2026-04-03 scmp-fast-path

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/SKILL.md`
- **Reason**: a short default command skeleton reduces context waste in common SCMP bug-fix / release tasks while preserving the stable workflow order
- **Evidence**: `copy_calculator` session spent too much context re-deriving the same `lookup -> repo -> deploy -> current -> verify` sequence before finishing the release

## 2026-04-09 scmp-service-name-resolution

- **Promoted from**: inbox (wrong-service-deployment-assumption)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: service name assumption from repo directory is a repeated failure mode; checking `.deploy-service` is cheap insurance
- **Evidence**: deployed to `ptc-copy-calculator` instead of `ptc-copy-names`, succeeded only after correcting service metadata

## 2026-04-09 scmp-token-expiry-handling

- **Promoted from**: inbox (scmp-token-expiry-blocks-deploy)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: token expiry mid-deploy requires explicit user communication; retry loop wastes context
- **Evidence**: deploy failed with auth error, explicit "已登录" confirmation from user, retry succeeded with refreshed session

## 2026-04-09 static-site-recursive-html-cache

- **Promoted from**: inbox (static-site-recursive-html-cache)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: Next.js static export with nested routes requires recursive HTML caching; root-only caching misses generator pages
- **Evidence**: generator page titles showed default instead of domain-specific content until `cacheHtmlFiles` was made recursive with prefix parameter

## 2026-04-09 scmp-deploy-version-bump-for-content-changes

- **Promoted from**: inbox (deploy-version-bump-required)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: SCMP image caching by version tag caused deploy failures when content changed but version stayed same; 2nd occurrence validates this as reusable pattern
- **Evidence**: `copy_names` deploy to 1.0.0.7 failed with cache error, user explained "你的内容根本没有变化 才会报这个", succeeded after bumping to 1.0.0.8 with new version suffix 04091700-1.0.0.8

## 2026-04-09 reference-original-site-for-clone-bugs

- **Promoted from**: inbox (reference-original-site-for-bugs)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: for clone/copy sites, original site is the source of truth for expected behavior; valuable cross-project pattern for website cloning work
- **Evidence**: `copy_names` header navigation bug fixed by checking randomlists.com original to confirm FAQ/Privacy/Contact belong in footer not header

## 2026-04-09 feishu-base-token-resolution

- **Promoted from**: inbox (feishu-base-token-from-wiki-doc)
- **Promoted to**: `scmp-ops/SKILL.md`
- **Reason**: wiki doc token ≠ Bitable base token; common mistake when working with Feishu wiki-embedded tables, expensive to debug repeatedly
- **Evidence**: record-get failed with wiki token LAxNw1U9yiOvqMkxMjccLUCtnRe (error 800010608), discovered correct base token I7m2bnPDgaYnwksqp1jcmmW9nOd via bitable apps API

## 2026-04-09 feishu-batch-status-update

- **Promoted from**: inbox (feishu-batch-status-update-workflow)
- **Promoted to**: `scmp-ops/SKILL.md`
- **Reason**: batch status updates are common in Feishu-driven bug workflows; having explicit workflow reduces error rate and context waste
- **Evidence**: successfully updated 6 AI名字生成器 bug records from "AI FIXING" to "AI DONE" using list-filter-extract-upsert-verify pattern

## 2026-04-09 language-context-discipline

- **Promoted from**: inbox (chinese-text-literal-misunderstanding + english-site-chinese-content-mistake)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: English clone sites (like randomlists.com) require all content in English; Chinese instructions do NOT mean translate to Chinese. High-cost repeated mistake.
- **Evidence**: Multiple user corrections: "我都是英文的网站 来一个 ai 生成 作为 title???" and "永远不要在我的页面出现中文!!!!!!!!! 全站是英文网页"

## 2026-04-10 mixed-old-new-instance-detection

- **Promoted from**: inbox (`succeeded-but-mixed-instance-responses`)
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: this is now a repeated rollout failure mode; post-`Succeeded` alternating old/new responses are expensive to misread as code failure and require a stable verification rule
- **Evidence**: `ptc-intention-information` needed rerun `1.0.3.1` after `1.0.3`, and later rerun `1.0.5.1` after `1.0.5`; both cases showed repeated cache-busted requests alternating between stale and updated HTML until the second deploy converged

## 2026-04-13 genmixer-mixed-instance-evidence-refresh

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/references/ops-notes.md`
- **Reason**: existing mixed-instance rule gained another cross-project production confirmation, so the stable note should keep the latest concrete evidence without expanding `SKILL.md`
- **Evidence**: `ptc-copy-names` / `genmixer.com` deploy branch `1.0.0.11` first shipped as version `1.0.0.11` on pipeline `102531` and still alternated between `200/404` on `/contact/` and `/faq/`, while `robots.txt` also flipped old/new; re-deploying the same branch as version `1.0.0.12` on pipeline `102535` made `/contact/`, `/faq/`, `/privacy/`, and `robots.txt` stabilize

## 2026-04-13 playwright-artifact-archive-policy

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/SKILL.md`
- **Reason**: repo-local `playwright-report/` is useful but too easy to overwrite; a central `project / branch / issue` archive path is a stable cross-project default for verification evidence
- **Evidence**: `copy_names/playwright-report` preserved a valuable UI verification snapshot, and the user explicitly asked to standardize this pattern across SCMP tasks with project, issue, branch, and screenshot separation

## 2026-04-13 playwright-archive-moved-to-git-repo

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/references/playwright-artifacts.md`
- **Reason**: once the archive became useful, local-only storage under `auto-skills/tracking` was not enough; a dedicated git repo keeps structure, docs, and evidence versioned
- **Evidence**: user explicitly asked to "放git" and approved moving the canonical archive into `git@github.com:CtriXin/issue-tracking.git`, with project / branch / issue structure and screenshot separation

## 2026-04-14 ad-lazy-load-and-visible-boundary-default

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/references/ad-bug-notes.md`
- **Reason**: user confirmed this is a repeated cross-project ad standard, not a one-off layout preference: all ad implementations must keep lazy-loading, and visible ads need explicit `Advertisement` boundaries while unfilled/error states must collapse the full shell
- **Evidence**: prior implementation reference in `/Users/xin/ptc_v5_named/src/pages/components/AdComponent.vue`, `/Users/xin/ptc_v5_named/src/mixin/adMixin.js`, `/Users/xin/ptc_v5_named/src/mixin/adTrackingMixin.js`; current repo validation flow in `docs/ads/thenexuslife-verification-2026-04-14.md`

## 2026-04-14 playwright-isolated-home-browser-cache

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/references/playwright-artifacts.md`
- **Reason**: Playwright screenshot verification in Codex/gateway sessions can silently lose access to previously installed browsers because `HOME` shifts to a session-scoped path; this is cross-project runtime friction and also clarifies that final evidence should be archived to `issue-tracking`, not left only in repo-local `output/playwright`
- **Evidence**: `ptc-intention-information` screenshot run failed with missing executable under `/Users/xin/.config/mms/codex-gateway/s/49772/Library/Caches/ms-playwright/...`; recovery succeeded after `npx playwright install chromium` and `npx playwright install webkit`, and artifacts were archived to `/Users/xin/issue-tracking/playwright/ptc-intention-information/1.0.6.1/thenexuslife-blog-additions-5-articles/`

## 2026-04-14 feishu-record-list-tabular-shape

- **Promoted from**: inbox (`feishu-record-list-tabular-shape`)
- **Promoted to**: `scmp-ops/references/feishu-workflows.md`
- **Reason**: this payload shape has now repeated across Feishu bug-table sessions; treating `+record-list` as tabular-by-default avoids silent false negatives when rescanning open bugs
- **Evidence**: `copy_names` AI名字生成器 batch on `2026-04-14` again returned `data.data` + `fields` + `record_id_list` instead of `data.items`; parsing the raw JSON from `/tmp/copy_names_feishu.json` surfaced the still-open `AI FIXING` records correctly

## 2026-04-15 scmp-ops-issue-recorder-start-close-gate

- **Promoted from**: direct user request
- **Promoted to**: `scmp-ops/SKILL.md`, `scmp-ops/references/issue-recorder.md`, `issue-tracking/scripts/record_cli.py`
- **Reason**: the user wants SCMP-related development / exploration / debug work to land in one canonical cross-project backup, not only final Playwright artifacts; this is now important enough to become a default start/close gate instead of an optional afterthought
- **Evidence**: user explicitly asked whether we can force any `scmp-ops`-using llm to land related work in `issue-tracking`; implementation now adds a recorder contract plus a callable CLI that can initialize records early, append timeline/process items during debug, and write final status/fix/verification before task completion

## 2026-04-15 opaque-issue-id-needs-human-summary

- **Promoted from**: direct user correction
- **Promoted to**: `scmp-ops/SKILL.md`, `scmp-ops/references/issue-recorder.md`
- **Reason**: a recorder entry that only shows an opaque Feishu `record_id` and blank placeholder sections is not reviewable; this is cheap to prevent and expensive to leave ambiguous
- **Evidence**: `copy_names` record `recvgJ5ze5byf3` showed `暂无记录` in summary/problem/cause/verification panels until the user pointed out that the task name and context were unreadable without manual reconstruction

## 2026-04-15 recorder-pm2-restart-instead-of-duplicate-server

- **Promoted from**: direct task lesson
- **Promoted to**: `scmp-ops/SKILL.md`, `scmp-ops/references/issue-recorder.md`, `issue-tracking/README.md`, `issue-tracking/AGENTS.md`
- **Reason**: the recorder is now a long-lived shared tool across projects; duplicate local servers cause port conflicts and wasted debug time, while PM2 restart is the stable default on this machine
- **Evidence**: `issue-tracking` PM2 app entered `errored` with `OSError: [Errno 48] Address already in use` because port `8047` was already occupied by a separately started daemon; recovery succeeded after stopping the duplicate process and restarting the PM2 app

## 2026-04-15 issue-recorder-skill-extraction

- **Promoted from**: direct user request
- **Promoted to**: `/Users/xin/auto-skills/shared-skills/issue-recorder`, `scmp-ops/SKILL.md`
- **Reason**: the recorder flow is now needed outside SCMP projects, so it should no longer depend on `scmp-ops` alone; a dedicated shared skill plus thin per-repo `AGENTS.md` is the stable cross-project shape
- **Evidence**: user explicitly clarified that some projects do not execute `scmp-ops` but should still record into `/Users/xin/issue-tracking`, and requested a shared skill under `auto-skills` with symlinks into both Codex and Claude
