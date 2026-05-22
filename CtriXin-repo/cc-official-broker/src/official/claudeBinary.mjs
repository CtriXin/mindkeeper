import os from "node:os"
import path from "node:path"
import { accessSync, existsSync, readdirSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"

import { probeRemoteAuthBundle } from "./remoteAuthSync.mjs"

function runCommand(cmd, args) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    env: process.env
  })
}

function normalizeOutput(text = "") {
  return String(text || "").trim()
}

function resolveUserHome() {
  const envHome = normalizeOutput(process.env.HOME)
  const match = envHome.match(/^(.*)\/\.config\/mms\/[^/]+-gateway\/s\/[^/]+$/)
  if (match?.[1]) {
    return match[1]
  }
  return envHome || os.homedir()
}

function parseClaudeVersionText(raw = "") {
  const match = String(raw || "").match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null

  return {
    major: Number.parseInt(match[1], 10) || 0,
    minor: Number.parseInt(match[2], 10) || 0,
    patch: Number.parseInt(match[3], 10) || 0,
    text: match[0]
  }
}

function compareVersions(left, right) {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

function isExecutableFile(filePath = "") {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size <= 0) return false
    accessSync(filePath)
    return true
  } catch {
    return false
  }
}

function listVersionBinaries(versionsDir = "", source = "versions") {
  if (!versionsDir || !existsSync(versionsDir)) return []

  return readdirSync(versionsDir)
    .map(name => {
      const fullPath = path.join(versionsDir, name)
      const parsed = parseClaudeVersionText(name)
      if (!parsed || !isExecutableFile(fullPath)) return null
      return {
        path: fullPath,
        source,
        version: parsed
      }
    })
    .filter(Boolean)
}

function collectCandidateBinaries() {
  const candidates = []
  const seen = new Set()
  const home = resolveUserHome()
  const mmsConfigDir = process.env.MMS_CONFIG_DIR || path.join(home, ".config", "mms")
  const userVersionsDir = path.join(home, ".local", "share", "claude", "versions")
  const sessionRoots = [
    path.join(mmsConfigDir, "claude-gateway", "s"),
    path.join(mmsConfigDir, "codex-gateway", "s")
  ]

  const pushCandidate = candidate => {
    if (!candidate?.path || seen.has(candidate.path)) return
    seen.add(candidate.path)
    candidates.push(candidate)
  }

  for (const sessionRoot of sessionRoots) {
    if (existsSync(sessionRoot)) {
      for (const entry of readdirSync(sessionRoot)) {
        const versionsDir = path.join(sessionRoot, entry, ".local", "share", "claude", "versions")
        for (const candidate of listVersionBinaries(versionsDir, "mms-session")) {
          pushCandidate(candidate)
        }
      }
    }
  }

  for (const candidate of listVersionBinaries(userVersionsDir, "user-versions")) {
    pushCandidate(candidate)
  }

  const lookup = runCommand("zsh", ["-lc", "command -v claude"])
  const lookedUpPath = normalizeOutput(lookup.stdout)
  if (lookup.status === 0 && lookedUpPath && isExecutableFile(lookedUpPath)) {
    pushCandidate({
      path: lookedUpPath,
      source: "path",
      version: parseClaudeVersionText(normalizeOutput(runCommand(lookedUpPath, ["-v"]).stdout))
    })
  }

  return candidates
}

export function resolveClaudeBinary(env = process.env) {
  const override = normalizeOutput(env.CC_OFFICIAL_CLAUDE_BIN || env.CLAUDE_BIN)
  if (override) {
    return {
      ok: existsSync(override),
      path: override,
      source: "env",
      error: existsSync(override) ? null : "override path does not exist"
    }
  }

  const supportCache = new Map()
  const candidates = collectCandidateBinaries().sort((left, right) => {
    if (!supportCache.has(left.path)) {
      supportCache.set(left.path, detectDirectConnectSupport(left.path))
    }
    if (!supportCache.has(right.path)) {
      supportCache.set(right.path, detectDirectConnectSupport(right.path))
    }

    const leftSupport = supportCache.get(left.path)
    const rightSupport = supportCache.get(right.path)
    const leftScore = leftSupport?.ok ? 1 : 0
    const rightScore = rightSupport?.ok ? 1 : 0
    if (leftScore !== rightScore) {
      return rightScore - leftScore
    }

    return compareVersions(right.version, left.version)
  })
  const picked = candidates[0]

  if (!picked?.path) {
    return {
      ok: false,
      path: "",
      source: "path",
      error: "claude binary not found in PATH or known install locations"
    }
  }

  return {
    ok: true,
    path: picked.path,
    source: picked.source,
    error: null
  }
}

export function getClaudeVersion(binaryPath) {
  if (!binaryPath) {
    return {
      ok: false,
      version: "",
      error: "claude binary path is empty"
    }
  }

  const variants = [
    runCommand(binaryPath, ["-v"]),
    runCommand(binaryPath, ["--version"])
  ]
  const picked = variants.find(result => result.status === 0 && normalizeOutput(result.stdout || result.stderr)) ||
    variants[0]
  const version = normalizeOutput(picked.stdout || picked.stderr)

  return {
    ok: picked.status === 0 && Boolean(version),
    version,
    error: picked.status === 0 ? null : version || "failed to read claude version"
  }
}

export function getClaudeAuthStatus(binaryPath) {
  if (!binaryPath) {
    return {
      ok: false,
      loggedIn: false,
      authMethod: "unknown",
      apiProvider: "unknown",
      error: "claude binary path is empty"
    }
  }

  const result = spawnSync(binaryPath, ["auth", "status", "--json"], {
    encoding: "utf8",
    env: process.env
  })
  const raw = normalizeOutput(result.stdout || result.stderr)

  try {
    const payload = JSON.parse(raw)
    return {
      ok: result.status === 0 || typeof payload.loggedIn === "boolean",
      loggedIn: Boolean(payload.loggedIn),
      authMethod: String(payload.authMethod || "unknown"),
      apiProvider: String(payload.apiProvider || "unknown"),
      error: null
    }
  } catch {
    return {
      ok: false,
      loggedIn: false,
      authMethod: "unknown",
      apiProvider: "unknown",
      error: raw || "failed to read claude auth status"
    }
  }
}

export function detectDirectConnectSupport(binaryPath) {
  if (!binaryPath) {
    return {
      ok: false,
      markers: [],
      reason: "claude binary path is empty"
    }
  }

  const probe = spawnSync("strings", [binaryPath], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  })
  const haystack = `${probe.stdout || ""}\n${probe.stderr || ""}`
  const markers = [
    "createDirectConnectSession",
    "Connected to server at",
    "Connect to a Claude Code server",
    "cc://",
    "open <cc-url>",
    "claude-cli://",
    "--handle-uri"
  ]
  const matched = markers.filter(marker => haystack.includes(marker))
  const reliable = matched.filter(marker => !["cc://", "claude-cli://", "--handle-uri"].includes(marker))
  const deepLinkCapable =
    matched.includes("cc://") && (matched.includes("claude-cli://") || matched.includes("--handle-uri"))
  const supported = reliable.length > 0 || deepLinkCapable

  return {
    ok: supported,
    markers: matched,
    reason:
      supported
        ? ""
        : "local official claude build does not expose reliable direct-connect markers"
  }
}

export function buildOfficialEntryPointSummary() {
  return [
    {
      name: "headless-sdk-url",
      cli_shape: "claude --print --sdk-url <session-ingress-url>",
      current_fit: "best-reuse-now",
      user_visible_shape: "real official claude core, but headless stream-json child instead of the normal TUI",
      source_refs: [
        "/Users/xin/Downloads/src/bridge/sessionRunner.ts",
        "/Users/xin/Downloads/src/main.tsx",
        "/Users/xin/Downloads/src/cli/remoteIO.ts"
      ]
    },
    {
      name: "assistant-viewer",
      cli_shape: "claude assistant [sessionId]",
      current_fit: "blocked-for-now",
      user_visible_shape: "real official REPL viewer, but it expects an official bridge session to already exist",
      source_refs: [
        "/Users/xin/Downloads/src/main.tsx",
        "/Users/xin/Downloads/src/assistant/sessionDiscovery.js"
      ]
    },
    {
      name: "remote-teleport",
      cli_shape: "claude --remote / --teleport",
      current_fit: "not-our-path",
      user_visible_shape: "official remote session path against Anthropic backend, not our broker",
      source_refs: [
        "/Users/xin/Downloads/src/main.tsx",
        "/Users/xin/Downloads/src/utils/teleport.tsx"
      ]
    }
  ]
}

export function buildOfficialHeadlessLaunchPlan({
  binaryPath = "claude",
  sessionId = "session_local_demo",
  sdkUrl = `ws://127.0.0.1:8789/v2/session_ingress/ws/${sessionId}`,
  accessToken = "<session-ingress-access-token>",
  workingDir = process.cwd(),
  useCcrV2 = false,
  workerEpoch = 1,
  disableTelemetry = true,
  disableNonessentialTraffic = true
} = {}) {
  const argv = [
    "--print",
    "--sdk-url",
    sdkUrl,
    "--session-id",
    sessionId,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--replay-user-messages"
  ]

  const env = {
    CLAUDE_CODE_ENVIRONMENT_KIND: "bridge",
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: accessToken,
    ...(useCcrV2
      ? {
          CLAUDE_CODE_USE_CCR_V2: "1",
          CLAUDE_CODE_WORKER_EPOCH: String(workerEpoch)
        }
      : {
          CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2: "1"
        }),
    ...(disableTelemetry ? { DISABLE_TELEMETRY: "1" } : {}),
    ...(disableNonessentialTraffic
      ? { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }
      : {})
  }

  return {
    binary_path: binaryPath,
    cwd: workingDir,
    argv,
    env,
    notes: [
      "This is the same official child-launch family used by bridge/sessionRunner, not our custom shell.",
      "It reuses the official claude core, but it is still a headless stream-json child instead of the everyday interactive TUI.",
      "To reach this path for real, broker/server side must expose a compatible session-ingress or CCR worker surface."
    ]
  }
}

export function buildOfficialDoctorReport(config, overrides = {}) {
  const binary = resolveClaudeBinary()
  const version = binary.ok ? getClaudeVersion(binary.path) : null
  const auth = binary.ok ? getClaudeAuthStatus(binary.path) : null
  const directConnect = binary.ok ? detectDirectConnectSupport(binary.path) : null
  const remoteAuth = probeRemoteAuthBundle(config)
  const sessionId = overrides.sessionId || "session_local_demo"
  const useCcrV2 = overrides.mode === "v2"
  const sdkUrl =
    overrides.sdkUrl ||
    (useCcrV2
      ? `https://127.0.0.1:8789/v1/code/sessions/${sessionId}`
      : `ws://127.0.0.1:8789/v2/session_ingress/ws/${sessionId}`)

  return {
    ok: binary.ok && Boolean(version?.ok),
    local_claude: {
      found: binary.ok,
      path: binary.path || "<not-found>",
      source: binary.source,
      version: version?.version || "<unknown>",
      error: binary.error || version?.error || null
    },
    local_auth: {
      logged_in: Boolean(auth?.loggedIn),
      auth_method: auth?.authMethod || "unknown",
      api_provider: auth?.apiProvider || "unknown",
      error: auth?.error || null
    },
    remote_auth: remoteAuth,
    direct_connect: {
      supported: Boolean(directConnect?.ok),
      markers: directConnect?.markers || [],
      reason: directConnect?.reason || ""
    },
    current_direction: {
      broker_role: "session truth + routing + local runner",
      official_reuse_now: directConnect?.ok ? "direct-connect TUI + headless sdk-url child launch contract" : "headless sdk-url child launch contract",
      recommended_entry: directConnect?.ok && (auth?.loggedIn || remoteAuth.available) ? "official:connect" : "mms:run",
      current_blocker: directConnect?.ok
        ? auth?.loggedIn || remoteAuth.available
          ? ""
          : remoteAuth.configured
            ? `remote claude auth bundle is not ready yet: ${remoteAuth.reason || "unknown"}`
            : "local Claude Code is not logged in yet and no remote auth bundle is configured"
        : "this local Claude Code build still cannot open broker via direct-connect, so MMS should stay on broker shell fallback for now"
    },
    entrypoints: buildOfficialEntryPointSummary(),
    sample_headless_launch: buildOfficialHeadlessLaunchPlan({
      binaryPath: binary.path || "claude",
      sessionId,
      sdkUrl,
      useCcrV2,
      workerEpoch: overrides.workerEpoch || 1,
      workingDir: config.workspaceRoot || process.cwd()
    }),
    telemetry_notes: {
      local_knobs: [
        "DISABLE_TELEMETRY=1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
      ],
      note:
        "These knobs must be applied on the side that actually runs official claude; broker field names themselves do not suppress official telemetry."
    },
    source_reference_root: "/Users/xin/Downloads/src"
  }
}
