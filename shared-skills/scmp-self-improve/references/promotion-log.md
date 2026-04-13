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
