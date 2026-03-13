# agent-im

CLI session bridge to Discord. Every Claude Code / Codex CLI session auto-maps to a Discord thread, with tool output, permission forwarding, and agent branding.

## Quick Start

```bash
# 1. Install dependencies & build
cd agent-im
npm install && npm run build

# 2. Create config
mkdir -p ~/.agent-im
cp config.env.example ~/.agent-im/config.env
# Edit config.env, fill in Discord bot token + channel ID

# 3. Install hooks into Claude Code
bash scripts/install-hooks.sh                    # basic hooks
bash scripts/install-hooks.sh --with-permissions  # + permission forwarding

# 4. Start daemon (pick one)
bash scripts/daemon.sh start          # manual foreground-ish (nohup)
bash scripts/install-launchd.sh       # auto-start on login (recommended)
```

## Daemon Management

```bash
# Manual control
bash scripts/daemon.sh start          # start
bash scripts/daemon.sh stop           # stop
bash scripts/daemon.sh restart        # restart
bash scripts/daemon.sh status         # check if running
bash scripts/daemon.sh logs           # last 50 lines
bash scripts/daemon.sh logs 200       # last 200 lines

# Auto-start on login (macOS launchd)
bash scripts/install-launchd.sh       # install + start immediately
# After this, daemon auto-starts on every login and restarts on crash.
# To remove:
launchctl bootout gui/$(id -u)/com.agent-im.daemon
```

## Config (`~/.agent-im/config.env`)

| Key | Required | Description |
|-----|----------|-------------|
| `AGENT_IM_DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `AGENT_IM_DISCORD_HUB_CHANNEL_ID` | Yes | Channel for hub cards (session overview) |
| `AGENT_IM_DISCORD_ALLOWED_USERS` | No | Comma-separated Discord user IDs (empty = all) |
| `AGENT_IM_DEFAULT_FILTER` | No | `full` / `summary` / `silent` (default: `summary`) |
| `AGENT_IM_AUTO_ARCHIVE_HOURS` | No | Thread auto-archive after session ends (default: 24) |
| `AGENT_IM_CLAUDE_ICON_URL` | No | Custom icon URL for Claude hub cards |
| `AGENT_IM_CODEX_ICON_URL` | No | Custom icon URL for Codex hub cards |

## Discord Commands

**In hub channel:**
- `/status` — list all active sessions

**In session thread:**
- `/filter full|summary|silent` — change event filter level
- `/info` — show session details (project, branch, PID, etc.)
- `1` or `2` — approve latest pending permission
- `3` — deny latest pending permission

## What Shows Up in Discord

Each CLI session gets:
1. **Hub card** — overview embed in the hub channel (project, branch, status, agent icon)
2. **Thread** — auto-created, all events streamed here

Events forwarded (depends on filter level):

| Event | `full` | `summary` | `silent` |
|-------|--------|-----------|----------|
| Tool results (Read, Bash, Edit, ...) | Yes | Yes | No |
| User prompts | Yes | Yes | No |
| Errors | Yes | Yes | No |
| Done (cost/tokens) | Yes | Yes | No |
| Notifications | Yes | Yes | No |
| Permission requests | Yes | Yes | Yes |

**Not captured:** Claude's direct text responses (the analysis, tables, recommendations you see in CLI). Claude Code hooks only fire on tool calls, user prompts, and session events. Claude's "thinking" output has no hook. What you DO get: every tool call + result, which covers the majority of observable work.

## Thread Title Auto-Update

Thread names update automatically with context:
- Base: `project / branch [session-id]`
- With prompt context: `project / branch -- fix empty output bug [abc123]`
- Cross-folder: `project-a <-> project-b / branch -- task context [abc123]`

Rate-limited to 1 update per 5 minutes (Discord API limit).

## Agent Branding

| Agent | Emoji | Color | Default |
|-------|-------|-------|---------|
| Claude | octopus | Purple (#7C3AED) | Yes |
| Codex | brain | Green (#10A37F) | Yes |
| Unknown | robot | Blurple (#5865F2) | Fallback |

Custom icons: set `AGENT_IM_CLAUDE_ICON_URL` / `AGENT_IM_CODEX_ICON_URL` in config.env.

## Permission Forwarding

With `--with-permissions` hooks installed, dangerous tool calls (Bash, Write, Edit) are forwarded to Discord with Allow/Deny buttons. The CLI blocks until you click.

Flow: CLI tool call -> hook -> daemon -> Discord buttons -> you click -> daemon -> hook -> CLI continues

## Hooks Installed

| Hook | Script | Trigger |
|------|--------|---------|
| `SessionStart` | `session-start.sh` | CLI session begins |
| `Stop` | `session-end.sh` | CLI session ends |
| `PostToolUse` | `post-tool-use.sh` | After each tool call |
| `UserPromptSubmit` | `user-prompt.sh` | User sends a prompt |
| `Notification` | `notification.sh` | Claude sends notification |
| `PreToolUse` | `pre-tool-use.sh` | Before tool call (permissions, optional) |

## Smoke Test

```bash
# Daemon must be running. Sends IPC messages, creates a real Discord thread.
bash scripts/smoke-test.sh
```

Covers: register -> cross-folder -> prompt -> tools -> permission -> done -> archive.

## File Layout

```
src/
  main.ts              # daemon entry
  config.ts            # config loader + agent brands
  store.ts             # JSON file persistence (sessions, permissions)
  ipc-server.ts        # Unix socket IPC server
  session-registry.ts  # session lifecycle + heartbeat
  content-router.ts    # event filtering, rendering, title updates
  discord/
    adapter.ts         # Discord bot + thread/embed sending
    thread-ops.ts      # thread create/archive/rename, hub cards
hooks/                 # bash scripts installed into ~/.claude/settings.json
scripts/
  daemon.sh            # start/stop/status/logs
  install-hooks.sh     # hook installer
  install-launchd.sh   # macOS auto-start
  smoke-test.sh        # E2E test
data/                  # ~/.agent-im/data/ (sessions.json, permissions.json)
```

## Troubleshooting

**Daemon not starting:**
```bash
cat ~/.agent-im/config.env    # check token + channel ID
ls -la ~/.agent-im/agent-im.sock  # stale socket? delete and restart
```

**Hooks not firing:**
```bash
cat ~/.claude/settings.json | jq '.hooks'  # verify hooks registered
tail -f ~/.agent-im/logs/hooks.log         # hook debug output
```

**Session marked dead too early:**
- Heartbeat threshold is 10 minutes + PID check
- Check `~/.agent-im/data/sessions.json` for `lastActivityAt`

**Empty tool output in Discord:**
- Hook extracts `stdout` (Bash), `content` (Read), or text from response
- Large outputs truncated to 2000 chars
- Check `~/.agent-im/logs/hooks.log` for errors
