# Playwright Artifacts

Use this when Playwright is part of bug verification, release validation, or UI regression capture.

## Default policy

- keep Playwright artifacts in one central place outside the repo
- separate by `project / branch / issue`
- keep HTML report and screenshots together under the same issue folder
- prefer archiving the full HTML report, because it already keeps attachments and trace links together

## Canonical root

```bash
/Users/xin/issue-tracking/playwright
```

## Folder shape

```text
/Users/xin/issue-tracking/playwright/
  <project>/
    <branch>/
      <issue>/
        html-report/
        screenshots/
        notes.md
```

Examples:

```text
/Users/xin/issue-tracking/playwright/copy_names/1.0.0.11/recvgmDfwNiRpO/
/Users/xin/issue-tracking/playwright/copy_names/1.0.0.11/genmixer-contact-layout/
```

Issue metadata should live separately in the same git repo:

```text
/Users/xin/issue-tracking/issues/<project>/<issue>/issue.md
```

## Default archive behavior for SCMP bug work

When the task is bug-driven, do both:

1. archive runtime artifacts under `playwright/<project>/<branch>/<issue>/`
2. update the durable issue record at `issues/<project>/<issue>/issue.md`

The issue record should capture, when known:

- problem / symptom
- likely cause
- fix summary
- verification result
- source bug id or Feishu `record_id`
- main domain / route

If Playwright or screenshots were used, reference them from the same issue slug.

## Naming rules

### project

- use repo directory name by default
- examples: `copy_names`, `copy_calculator`

### branch

- use the real git branch name
- if branch contains `/`, replace it with `_`
- examples: `1.0.0.11`, `feature_fix-contact-layout`

### issue

Prefer, in order:

1. Feishu `record_id`
2. ticket / bug id from the user
3. short manual slug: `<domain>-<route>-<brief>`

Examples:

- `recvgmDfwNiRpO`
- `BUG-142`
- `genmixer-contact-layout`

## Preferred command pattern

```bash
PROJECT_SLUG="$(basename "$PWD")"
BRANCH_SLUG="$(git rev-parse --abbrev-ref HEAD | tr '/:' '__')"
ISSUE_SLUG="genmixer-contact-layout"
ARTIFACT_ROOT="/Users/xin/issue-tracking/playwright/${PROJECT_SLUG}/${BRANCH_SLUG}/${ISSUE_SLUG}"

mkdir -p "${ARTIFACT_ROOT}/screenshots"

PLAYWRIGHT_HTML_OUTPUT_DIR="${ARTIFACT_ROOT}/html-report" \
PLAYWRIGHT_HTML_OPEN=never \
npx playwright test
```

## If the repo already writes to `playwright-report/`

If the project config still writes to local `playwright-report/`, either:

1. override with `PLAYWRIGHT_HTML_OUTPUT_DIR`, or
2. run the test first, then copy the generated folder into the canonical archive path

Preferred order:
- first try env override
- use copy/move fallback only when the project command is fixed and hard to override

## Screenshot policy

- manual screenshots also belong under the same `project / branch / issue` folder
- store them in `screenshots/`
- keep filenames descriptive and sortable

Examples:

```text
screenshots/01-homepage-desktop.png
screenshots/02-contact-mobile.png
screenshots/03-robots-txt-response.png
```

## Minimal `notes.md`

Keep a short note when the archive matters for future debugging:

```markdown
- Domain: genmixer.com
- Issue: contact / faq / privacy 404
- Branch: 1.0.0.11
- Verify command: npx playwright test tests/bugs.spec.ts
- Result: pass after second deploy
```

## Why this is the default

- repo-local `playwright-report/` is easy to lose, overwrite, or forget to clean
- git-backed archiving makes cross-project evidence reusable and reviewable
- project / branch / issue separation keeps screenshots understandable months later
- pairing artifacts with an issue record keeps bug context and evidence connected
