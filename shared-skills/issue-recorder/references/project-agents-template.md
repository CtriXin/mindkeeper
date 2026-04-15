# Project AGENTS Template

Use this when the user wants one repo to default to `/Users/xin/issue-tracking` without depending on `scmp-ops`.

Keep the local `AGENTS.md` thin. Only keep repo-specific behavior there.

## Minimal template

```md
Always respond in Chinese-simplified.
Keep technical terms in English; keep surrounding explanation in Chinese.

- Treat `/Users/xin/issue-tracking` as the canonical cross-project recorder and verification sink for this repo.
- Before long dev / debug / verification work, initialize or reuse an `issue-tracking` record.
- If requirements come from Feishu or external docs, copy the raw source into this repo first, then write your understanding and implementation frame.
- If this repo already has a PM2 app, prefer `PM2_HOME=/Users/xin/.pm2 pm2 restart <app-name>` over starting a new background process.
- For the recorder UI, prefer `PM2_HOME=/Users/xin/.pm2 pm2 restart issue-tracking`; do not launch another port-8047 process.
- `issue-tracking` normal record/template/build changes do not need restart because pages rebuild on access.
```

## Optional repo-specific additions

Add only what future LLMs cannot infer safely:

- current PM2 app name
- domain mapping
- local doc folder such as `docs/ads/source/`
- validation quirks such as `?ads_debug=1`
- mandatory screenshot or Playwright paths

Avoid copying the full recorder contract into every repo. The canonical workflow already lives in:

```text
/Users/xin/issue-tracking
```
