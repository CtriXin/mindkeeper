import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"

function normalizeText(value = "") {
  return String(value || "").trim()
}

function runCommand(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    env: process.env,
    ...options
  })
}

function buildRemoteHost(config) {
  const explicit = normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_SSH_TARGET)
  if (explicit) return explicit

  const baseUrl = normalizeText(config?.remoteServiceBaseUrl || config?.brokerBaseUrl)
  if (!baseUrl) return ""

  try {
    const parsed = new URL(baseUrl)
    const hostname = normalizeText(parsed.hostname)
    if (!hostname || ["127.0.0.1", "localhost", "::1"].includes(hostname)) {
      return ""
    }
    return `root@${hostname}`
  } catch {
    return ""
  }
}

function resolveUserHome() {
  const envHome = normalizeText(process.env.HOME)
  const match = envHome.match(/^(.*)\/\.config\/mms\/[^/]+-gateway\/s\/[^/]+$/)
  if (match?.[1]) {
    return match[1]
  }
  return envHome || os.homedir()
}

function buildAuthDir(config) {
  const explicit = normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_AUTH_DIR)
  if (explicit) return explicit

  const target = buildRemoteHost(config)
  const safeTarget = (target || "remote")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return path.join(
    resolveUserHome(),
    ".config",
    "cc-official-broker",
    "remote-auth",
    `${config?.deviceId || "device"}-${config?.workspaceId || "workspace"}-${safeTarget || "remote"}`
  )
}

function parseRemoteAuthBundle(raw = "") {
  const parsed = JSON.parse(String(raw || "").trim() || "{}")
  const credentials = parsed.credentials && typeof parsed.credentials === "object" ? parsed.credentials : {}
  const globalConfig = parsed.global_config && typeof parsed.global_config === "object" ? parsed.global_config : {}
  const oauth = credentials.claudeAiOauth && typeof credentials.claudeAiOauth === "object"
    ? credentials.claudeAiOauth
    : {}
  const scopes = Array.isArray(oauth.scopes)
    ? oauth.scopes.map(item => normalizeText(item)).filter(Boolean)
    : []

  return {
    credentials,
    globalConfig,
    oauth: {
      accessToken: normalizeText(oauth.accessToken),
      refreshToken: normalizeText(oauth.refreshToken),
      expiresAt: Number.parseInt(String(oauth.expiresAt || "0"), 10) || 0,
      scopes
    }
  }
}

function hasUsableOauth(bundle) {
  return Boolean(bundle?.oauth?.accessToken) &&
    Number(bundle?.oauth?.expiresAt || 0) > Date.now() + 60_000 &&
    bundle.oauth.scopes.includes("user:profile") &&
    bundle.oauth.scopes.includes("user:inference")
}

function describeOauthReadiness(bundle) {
  if (!bundle?.oauth?.accessToken) {
    return "remote auth bundle is missing oauth access token"
  }
  if (Number(bundle?.oauth?.expiresAt || 0) <= Date.now() + 60_000) {
    return "remote auth bundle exists but oauth access token is expired"
  }
  if (!bundle.oauth.scopes.includes("user:profile") || !bundle.oauth.scopes.includes("user:inference")) {
    return "remote auth bundle is missing required oauth scopes"
  }
  return ""
}

function getCacheTtlMs() {
  const parsed = Number.parseInt(String(process.env.CC_BROKER_REMOTE_AUTH_CACHE_TTL_MS || "300000"), 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 300000
}

async function loadCachedBundle(authDir) {
  if (!authDir) return null

  const credentialsFile = path.join(authDir, ".credentials.json")
  const globalConfigFile = path.join(authDir, ".claude.json")
  const metaFile = path.join(authDir, ".sync-meta.json")

  if (!existsSync(credentialsFile) || !existsSync(globalConfigFile)) {
    return null
  }

  try {
    const [credentialsText, globalConfigText, metaText] = await Promise.all([
      readFile(credentialsFile, "utf8"),
      readFile(globalConfigFile, "utf8"),
      readFile(metaFile, "utf8").catch(() => "{}")
    ])
    const bundle = parseRemoteAuthBundle(
      JSON.stringify({
        credentials: JSON.parse(credentialsText),
        global_config: JSON.parse(globalConfigText)
      })
    )
    const meta = JSON.parse(metaText || "{}")

    return {
      bundle,
      meta: {
        synced_at: Number.parseInt(String(meta.synced_at || "0"), 10) || 0,
        ssh_target: normalizeText(meta.ssh_target)
      }
    }
  } catch {
    return null
  }
}

function isCacheFresh(cached) {
  if (!cached?.meta?.synced_at) return false
  return Date.now() - cached.meta.synced_at <= getCacheTtlMs()
}

function fetchRemoteFile({ sshTarget, containerName, remotePath }) {
  const result = runCommand(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      sshTarget,
      "docker",
      "exec",
      containerName,
      "cat",
      remotePath
    ],
    {
      timeout: 12000
    }
  )

  if (result.status !== 0) {
    throw new Error(normalizeText(result.stderr || result.stdout) || `failed to fetch ${remotePath}`)
  }

  return String(result.stdout || "")
}

export function probeRemoteAuthBundle(config) {
  const sshTarget = buildRemoteHost(config)
  const containerName =
    normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME) || "claude-code-official"
  const credentialsPath =
    normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH) || "/root/.claude/.credentials.json"
  const globalConfigPath =
    normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH) || "/root/.claude.json"

  if (!sshTarget) {
    return {
      configured: false,
      available: false,
      ssh_target: "",
      auth_dir: buildAuthDir(config),
      reason: "remote_service_base_url did not resolve to a reachable ssh target"
    }
  }

  try {
    const bundle = parseRemoteAuthBundle(
      JSON.stringify({
        credentials: JSON.parse(
          fetchRemoteFile({
            sshTarget,
            containerName,
            remotePath: credentialsPath
          })
        ),
        global_config: JSON.parse(
          fetchRemoteFile({
            sshTarget,
            containerName,
            remotePath: globalConfigPath
          })
        )
      })
    )
    const hasProfileScope = bundle.oauth.scopes.includes("user:profile")
    const hasInferenceScope = bundle.oauth.scopes.includes("user:inference")
    const available = Boolean(bundle.oauth.accessToken) && hasProfileScope && hasInferenceScope
    const expired = Number(bundle.oauth.expiresAt || 0) <= Date.now() + 60_000

    return {
      configured: true,
      available: available && !expired,
      ssh_target: sshTarget,
      auth_dir: buildAuthDir(config),
      reason: available
        ? expired
          ? "remote auth bundle exists but oauth access token is expired"
          : ""
        : "remote auth bundle is missing required oauth scopes",
      oauth: {
        has_access_token: Boolean(bundle.oauth.accessToken),
        has_refresh_token: Boolean(bundle.oauth.refreshToken),
        expires_at: bundle.oauth.expiresAt || 0,
        scopes: bundle.oauth.scopes
      }
    }
  } catch (error) {
    return {
      configured: true,
      available: false,
      ssh_target: sshTarget,
      auth_dir: buildAuthDir(config),
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function syncRemoteAuthBundle(config) {
  const sshTarget = buildRemoteHost(config)
  if (!sshTarget) {
    throw new Error("remote_service_base_url did not resolve to a reachable ssh target")
  }

  const containerName =
    normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME) || "claude-code-official"
  const credentialsPath =
    normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH) || "/root/.claude/.credentials.json"
  const globalConfigPath =
    normalizeText(process.env.CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH) || "/root/.claude.json"
  const authDir = buildAuthDir(config)

  const cached = await loadCachedBundle(authDir)
  if (cached && cached.meta.ssh_target === sshTarget && isCacheFresh(cached) && hasUsableOauth(cached.bundle)) {
    return {
      ok: true,
      auth_dir: authDir,
      ssh_target: sshTarget,
      oauth: {
        scopes: cached.bundle.oauth.scopes,
        expires_at: cached.bundle.oauth.expiresAt || 0
      },
      cache: {
        hit: true,
        synced_at: cached.meta.synced_at
      }
    }
  }

  const bundle = parseRemoteAuthBundle(
    JSON.stringify({
      credentials: JSON.parse(
        fetchRemoteFile({
          sshTarget,
          containerName,
          remotePath: credentialsPath
        })
      ),
      global_config: JSON.parse(
        fetchRemoteFile({
          sshTarget,
          containerName,
          remotePath: globalConfigPath
        })
      )
    })
  )
  if (!hasUsableOauth(bundle)) {
    throw new Error(describeOauthReadiness(bundle) || "remote auth bundle does not contain a usable full-scope claude.ai login")
  }

  await mkdir(authDir, { recursive: true })
  const syncedAt = Date.now()
  await Promise.all([
    writeFile(path.join(authDir, ".credentials.json"), JSON.stringify(bundle.credentials, null, 2), "utf8"),
    writeFile(path.join(authDir, ".claude.json"), JSON.stringify(bundle.globalConfig, null, 2), "utf8"),
    writeFile(
      path.join(authDir, ".sync-meta.json"),
      JSON.stringify(
        {
          synced_at: syncedAt,
          ssh_target: sshTarget,
          scopes: bundle.oauth.scopes,
          expires_at: bundle.oauth.expiresAt || 0
        },
        null,
        2
      ),
      "utf8"
    )
  ])

  return {
    ok: true,
    auth_dir: authDir,
    ssh_target: sshTarget,
    oauth: {
      scopes: bundle.oauth.scopes,
      expires_at: bundle.oauth.expiresAt || 0
    },
    cache: {
      hit: false,
      synced_at: syncedAt
    }
  }
}
