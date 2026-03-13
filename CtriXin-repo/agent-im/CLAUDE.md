# agent-im

Multi-CLI session bridge to IM platforms. Each Claude Code CLI instance auto-maps to a Discord thread.

## Architecture

- `src/main.ts` — daemon entry point
- `src/ipc-server.ts` — Unix socket IPC (hooks → daemon)
- `src/session-registry.ts` — CLI session lifecycle
- `src/content-router.ts` — bidirectional event routing with filter levels
- `src/discord/adapter.ts` — Discord bot + thread management
- `hooks/` — Claude Code hook scripts (installed to `~/.claude/settings.json`)

## Data

- Config: `~/.agent-im/config.env`
- Data: `~/.agent-im/data/`
- Logs: `~/.agent-im/logs/`
- IPC socket: `~/.agent-im/agent-im.sock`

## Dev

```bash
npm install
npm run build    # tsc
npm run dev      # tsx src/main.ts (dev mode)
```

## Hook installation

```bash
bash scripts/install-hooks.sh                  # basic hooks
bash scripts/install-hooks.sh --with-permissions  # + permission forwarding
```
