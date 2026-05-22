import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"

import {
  getClaudeAuthStatus,
  getClaudeVersion,
  resolveClaudeBinary
} from "./claudeBinary.mjs"
import { syncRemoteAuthBundle } from "./remoteAuthSync.mjs"
import { startOfficialUpstreamProxy } from "./upstreamProxy.mjs"
import {
  findOfficialProxySessionRecord,
  loadLastSessionRecord,
  saveLastSessionRecord
} from "../session/localSessionRegistry.mjs"

const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_REASONING_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_AUTH_TOKEN",
  "CLAUDE_CONFIG_DIR"
]

function hasPermissionBypassArg(argv = []) {
  return argv.some(item => String(item || "").trim() === "--dangerously-skip-permissions")
}

function extractExplicitResumeSessionId(argv = []) {
  const resumeIndex = Array.isArray(argv) ? argv.indexOf("--resume") : -1
  if (resumeIndex < 0) {
    return ""
  }
  return String(argv[resumeIndex + 1] || "").trim()
}

function buildChildEnv(baseEnv, proxy) {
  const nextEnv = { ...baseEnv }
  for (const key of PROVIDER_ENV_KEYS) {
    delete nextEnv[key]
  }

  nextEnv.ANTHROPIC_BASE_URL = proxy.baseUrl
  nextEnv.ANTHROPIC_AUTH_TOKEN = proxy.bridgeToken
  nextEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
  nextEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = "1"
  nextEnv.DISABLE_TELEMETRY = "1"
  nextEnv.HOME = normalizeConfigBasePath(baseEnv.HOME) || os.userInfo().homedir || os.homedir()
  return nextEnv
}

function normalizeConfigBasePath(value = "") {
  const raw = String(value || "").trim()
  if (!raw) {
    return ""
  }

  const gatewayMatch = raw.match(/^(.*)\/\.config\/mms\/(?:claude|codex)-gateway\/s\/[^/]+$/)
  if (gatewayMatch?.[1]) {
    return gatewayMatch[1]
  }

  return raw
}

function resolveSourceClaudeConfigDir(baseEnv = process.env) {
  const configured = normalizeConfigBasePath(baseEnv.CLAUDE_CONFIG_DIR)
  if (configured) {
    return configured
  }

  const envHome = normalizeConfigBasePath(baseEnv.HOME)
  if (envHome) {
    return envHome
  }

  return os.userInfo().homedir || os.homedir()
}

async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function mergePlainObjects(...items) {
  const next = {}
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(next, item)
    }
  }
  return next
}

function stripPersistedAuthState(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const next = { ...value }
  for (const key of [
    "oauthAccount",
    "cachedExtraUsageDisabledReason",
    "penguinModeOrgEnabled"
  ]) {
    delete next[key]
  }
  return next
}

async function firstExistingJson(paths = []) {
  for (const candidate of paths) {
    const value = await readJsonFile(candidate, null)
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value
    }
  }
  return {}
}

async function hasAnyProjectTranscript(configDir) {
  const projectsDir = path.join(configDir, "projects")
  try {
    const projectEntries = await readdir(projectsDir, { withFileTypes: true })
    for (const entry of projectEntries) {
      if (!entry.isDirectory()) {
        continue
      }
      const projectDir = path.join(projectsDir, entry.name)
      const files = await readdir(projectDir, { withFileTypes: true })
      if (files.some(file => file.isFile() && file.name.endsWith(".jsonl"))) {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

function sanitizeProjectPath(projectRoot = process.cwd()) {
  return String(projectRoot || process.cwd()).replace(/[^a-zA-Z0-9]/g, "-")
}

async function resolveLatestProjectTranscript(configDir, projectRoot) {
  const projectDir = path.join(configDir, "projects", sanitizeProjectPath(path.resolve(projectRoot || process.cwd())))
  try {
    const entries = await readdir(projectDir, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map(async entry => {
          const filePath = path.join(projectDir, entry.name)
          const info = await stat(filePath)
          return {
            filePath,
            mtimeMs: info.mtimeMs,
            sessionId: entry.name.replace(/\.jsonl$/i, "")
          }
        })
    )
    files.sort((left, right) => right.mtimeMs - left.mtimeMs)
    return files[0] || null
  } catch {
    return null
  }
}

function buildPersistentProxyConfigRoot(options = {}) {
  const baseHome = resolveSourceClaudeConfigDir(options.baseEnv)
  const projectRoot = path.resolve(options.projectRoot || options.config?.workspaceRoot || process.cwd())
  const scopeHash = createHash("sha1")
    .update(JSON.stringify({
      projectRoot,
      deviceId: String(options.config?.deviceId || ""),
      workspaceId: String(options.config?.workspaceId || "")
    }))
    .digest("hex")
    .slice(0, 12)

  return path.join(baseHome, ".config", "cc-official-broker", "official-proxy", scopeHash)
}

function sanitizeConfigEnv(envValue, proxy) {
  const nextEnv = envValue && typeof envValue === "object" ? { ...envValue } : {}
  for (const key of PROVIDER_ENV_KEYS) {
    delete nextEnv[key]
  }
  nextEnv.ANTHROPIC_BASE_URL = proxy.baseUrl
  nextEnv.ANTHROPIC_AUTH_TOKEN = proxy.bridgeToken
  return nextEnv
}

function buildRunnerMcpServerEntry(config) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  return {
    type: "stdio",
    command: process.execPath,
    args: [path.resolve(moduleDir, "../mcp/runnerServer.mjs")],
    env: {
      CC_BROKER_WORKSPACE_ROOT: config.workspaceRoot || process.cwd(),
      CC_BROKER_RUNNER_TOOLS: Array.isArray(config.runnerTools) ? config.runnerTools.join(",") : "",
      CC_BROKER_RUNNER_WRITABLE_SCOPE: config.runnerWritableScope || "none"
    }
  }
}

async function createIsolatedClaudeConfig(proxy, options = {}) {
  const rootDir = buildPersistentProxyConfigRoot(options)
  const configDir = path.join(rootDir, "claude-config")
  await mkdir(configDir, { recursive: true })

  const sourceConfigDir = resolveSourceClaudeConfigDir(options.baseEnv)
  const sourceClaudeJsonPath = path.join(sourceConfigDir, ".claude.json")
  const sourceSettingsCandidates = [
    path.join(sourceConfigDir, "settings.json"),
    path.join(sourceConfigDir, ".claude", "settings.json")
  ]

  const persistedClaudeJson = stripPersistedAuthState(
    await readJsonFile(path.join(configDir, ".claude.json"), {})
  )
  const sourceClaudeJson = await readJsonFile(sourceClaudeJsonPath, {})
  const nextClaudeJson = mergePlainObjects(persistedClaudeJson, sourceClaudeJson)
  const currentMcpServers =
    nextClaudeJson?.mcpServers && typeof nextClaudeJson.mcpServers === "object"
      ? { ...nextClaudeJson.mcpServers }
      : {}
  currentMcpServers["cc-official-broker-runner"] = buildRunnerMcpServerEntry(options.config || {})
  nextClaudeJson.mcpServers = currentMcpServers
  if (options.bypassPermissions) {
    nextClaudeJson.bypassPermissionsModeAccepted = true
  }

  await writeFile(
    path.join(configDir, ".claude.json"),
    `${JSON.stringify(nextClaudeJson, null, 2)}\n`,
    "utf8"
  )

  const persistedSettingsPath = path.join(configDir, "settings.json")
  const persistedSettings = await readJsonFile(persistedSettingsPath, {})
  const sourceSettings = await firstExistingJson(sourceSettingsCandidates)
  const nextSettings = mergePlainObjects(sourceSettings, persistedSettings)

  await writeFile(
    path.join(configDir, "settings.json"),
    `${JSON.stringify(
      {
        ...nextSettings,
        env: sanitizeConfigEnv(nextSettings?.env, proxy)
      },
      null,
      2
    )}\n`,
    "utf8"
  )

  return {
    rootDir,
    configDir,
    async cleanup() {
      return null
    }
  }
}

export async function runOfficialProxy(config, overrides = {}) {
  const binary = resolveClaudeBinary()
  if (!binary.ok) {
    throw new Error(binary.error || "official claude binary not found")
  }

  const version = getClaudeVersion(binary.path)
  if (!version.ok) {
    throw new Error(version.error || "failed to read official claude version")
  }
  const localAuth = getClaudeAuthStatus(binary.path)

  const projectRoot = path.resolve(overrides.projectRoot || config.workspaceRoot || process.cwd())
  const rememberedSession = await loadLastSessionRecord(config, { projectRoot })
  const officialProxyState =
    rememberedSession?.official_proxy && typeof rememberedSession.official_proxy === "object"
      ? rememberedSession.official_proxy
      : {}
  const argv = [...(Array.isArray(overrides.argv) ? overrides.argv : [])]
  const explicitResumeSessionId = extractExplicitResumeSessionId(argv)
  const usesContinue = argv.includes("--continue")
  const wantsResume = Boolean(overrides.resumeLast || usesContinue || explicitResumeSessionId)
  const explicitResumeState = explicitResumeSessionId
    ? await findOfficialProxySessionRecord(config, {
        projectRoot,
        query: explicitResumeSessionId
      })
    : null
  if (explicitResumeSessionId && !explicitResumeState) {
    throw new Error(`official proxy resume target not found in local history: ${explicitResumeSessionId}`)
  }
  const resumeState =
    explicitResumeState ||
    (wantsResume ? officialProxyState : null) ||
    {}

  const proxy = await startOfficialUpstreamProxy(config, {
    sessionId: wantsResume ? resumeState.proxy_session_id || overrides.sessionId : overrides.sessionId,
    previousResponseId: wantsResume ? resumeState.previous_response_id || "" : "",
    remoteSessionId: wantsResume ? resumeState.remote_session_id || "" : ""
  })
  const wantsBypass = Boolean(overrides.bypassPermissions || config.claudeBypassPermissions || overrides.printPrompt)
  let remoteAuth = null
  try {
    remoteAuth = await syncRemoteAuthBundle(config)
  } catch (error) {
    if (!localAuth.ok || !localAuth.loggedIn) {
      throw new Error(
        `unable to sync remote claude auth bundle for official_proxy: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  const isolatedConfig = await createIsolatedClaudeConfig(proxy, {
    baseEnv: remoteAuth?.auth_dir
      ? {
          ...process.env,
          CLAUDE_CONFIG_DIR: remoteAuth.auth_dir
        }
      : process.env,
    config,
    bypassPermissions: wantsBypass
  })

  if (!argv.length && overrides.printPrompt) {
    argv.push("-p", String(overrides.printPrompt))
  }
  if (argv.includes("--continue") && !(await hasAnyProjectTranscript(isolatedConfig.configDir))) {
    const continueIndex = argv.indexOf("--continue")
    argv.splice(continueIndex, 1)
  }
  if (wantsBypass && !hasPermissionBypassArg(argv)) {
    argv.unshift("--dangerously-skip-permissions")
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(binary.path, argv, {
      cwd: overrides.projectRoot || config.workspaceRoot || process.cwd(),
      env: {
        ...buildChildEnv(process.env, proxy),
        CLAUDE_CONFIG_DIR: isolatedConfig.configDir
      },
      stdio: "inherit"
    })

    const finish = async (result, rejectError = null) => {
      try {
        await proxy.close()
      } catch {
        // ignore shutdown noise so the launcher still exits cleanly
      }

      if (rejectError) {
        reject(rejectError)
        return
      }

      resolve(result)
    }

    child.on("error", error => {
      void finish(null, error)
    })

    child.on("exit", (code, signal) => {
      void (async () => {
        const latestTranscript = await resolveLatestProjectTranscript(isolatedConfig.configDir, projectRoot)
        await saveLastSessionRecord(config, {
          projectRoot,
          officialProxy: {
            session_id: latestTranscript?.sessionId || resumeState.session_id || officialProxyState.session_id || "",
            transcript_path:
              latestTranscript?.filePath || resumeState.transcript_path || officialProxyState.transcript_path || "",
            config_dir: isolatedConfig.configDir,
            proxy_session_id: proxy.state.sessionId || resumeState.proxy_session_id || officialProxyState.proxy_session_id || "",
            previous_response_id:
              proxy.state.previousResponseId || resumeState.previous_response_id || officialProxyState.previous_response_id || "",
            remote_session_id:
              proxy.state.remoteSessionId || resumeState.remote_session_id || officialProxyState.remote_session_id || "",
            updated_at: new Date().toISOString()
          }
        })

        await finish({
          ok: code === 0,
          code: code ?? 1,
          signal,
          official: {
            path: binary.path,
            version: version.version,
            argv,
            session_id: latestTranscript?.sessionId || ""
          },
          proxy: {
            base_url: proxy.baseUrl,
            session_id: proxy.state.sessionId,
            remote_session_id: proxy.state.remoteSessionId || "",
            previous_response_id: proxy.state.previousResponseId || ""
          }
        })
      })()
    })
  })
}
