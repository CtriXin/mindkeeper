# Runtime Chain Plain Notes

## One-line takeaway

server is the only `OAuth / runtime / egress` truth source; local is the only `file / shell / write` truth source; broker sits in the middle and routes between them.

## 1. Why the local tool layer cannot really disappear

Because anything that needs to:

- read local files
- write local files
- run local `bash`
- search the local workspace

must still execute on the local machine.

So the "local tool layer" can be made thinner, but it cannot truly vanish.
It can hide inside:

- a tiny shim
- a local runner
- a CLI bridge
- an MCP adapter

But one local executor still has to exist.

## 2. Four roles in the current mainline

### A. server official runtime

Responsible for:

- holding first-party `claude.ai` auth
- talking to Anthropic
- keeping fixed egress IP
- being the real runtime truth

Not responsible for:

- touching the user's local filesystem
- running the user's local shell commands

### B. gateway / broker

Responsible for:

- auth / audit
- sticky routing
- runtime selection
- session mapping
- sending requests to the selected runtime

Think of it as the switchboard.

### C. local `Claude Code CLI` / `MMS`

Responsible for:

- the entry experience
- the UI / CLI shell the user sees

Think of it as the cockpit.

### D. local thin tool layer

Responsible for:

- local file read/write
- local search
- local shell execution
- returning tool results back to the remote brain

Think of it as the hands and feet.

## 3. The auth / evidence chain in plain language

1. server docker runs official `claude` and logs in to `claude.ai`
2. that server-side runtime holds the real auth state
3. local client does **not** consume that OAuth directly
4. local client only knows `gateway base_url + gateway key`
5. local prompt goes to gateway
6. gateway chooses a sticky runtime like `cc-static-1`
7. that selected server runtime sends the real upstream request to Anthropic
8. answer comes back to gateway, then back to local client

So the local machine is **not** the machine Claude sees as the runtime origin.
Claude still sees the server-side machine / container.

## 4. What actually goes upstream to Claude

Not the local CLI.
Not the broker itself.

The actual upstream request is sent by the server-side official runtime process.
That is why the source identity is still:

- server auth
- server container
- server egress IP

## 5. Why not `-p`

`-p` means:

- start one process
- send one prompt
- get one answer
- exit

That is not the target experience.

The target is:

- keep an official runtime process alive
- feed it the next turn through a structured channel
- let that same runtime continue the session

Possible channels between broker and the official runtime:

- `stdin/stdout`
- `stream-json`
- `sdk-url / session-ingress`
- internal `WebSocket` bridge

## 6. Does all broker traffic hit one live CLI session

No.

The correct model is:

- broker routes traffic into a runtime pool
- one session is sticky to one runtime
- different sessions must stay isolated
- broker must not dump all sessions into one shared conversation

Think of it like this:

- broker = switchboard
- runtime pool = multiple lines / workers
- session = one call on one line

Not one global call for everyone.

## 7. Practical meaning for the current project

Current mainline is:

```text
local official Claude Code CLI
  -> self-hosted gateway / broker
  -> server official runtime pool
  -> Anthropic Claude
```

Local tools remain local.
Server auth remains server-side.
Sticky / runtime / audit remain in the broker + control plane.

## 8. Current accepted remote baseline

- host: `23.95.30.199`
- accepted remote service endpoint: `http://23.95.30.199:28082`
- acceptance: `remote:doctor` real interop PASS
- current primary runtime seen in acceptance: `cc-static-1`
