import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

function redactSecret(secret = "") {
  if (!secret) return ""
  if (secret.length <= 8) return "***"
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`
}

function parseDotenvFile(filePath) {
  if (!existsSync(filePath)) {
    return {}
  }

  const parsed = {}
  const text = readFileSync(filePath, "utf8")

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const equalsIndex = line.indexOf("=")
    if (equalsIndex === -1) {
      continue
    }

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key) {
      parsed[key] = value
    }
  }

  return parsed
}

function loadFallbackEnv() {
  const cwd = process.cwd()
  const candidatePaths = [
    path.resolve(cwd, ".env.local"),
    path.resolve(cwd, "../cc-mcp-bridge/.env.local")
  ]

  const merged = {}
  const sources = []

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue
    }
    Object.assign(merged, parseDotenvFile(candidatePath))
    sources.push(candidatePath)
  }

  return {
    values: merged,
    sources
  }
}

function normalizeEndpoint(value = "chat.completions") {
  const raw = String(value || "").trim().toLowerCase()
  if (["responses", "response"].includes(raw)) {
    return "responses"
  }
  return "chat.completions"
}

function normalizeBaseUrl(value = "") {
  const trimmed = String(value || "").trim().replace(/\/+$/, "")
  if (!trimmed) {
    return ""
  }

  const suffixes = [
    "/consult_opus",
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/session_state",
    "/v1/agent/session_state"
  ]

  for (const suffix of suffixes) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length)
    }
  }

  return trimmed
}

export function loadConfig(env = process.env, options = {}) {
  const fallbackEnv = options.disableFallback ? { values: {}, sources: [] } : loadFallbackEnv()
  const layeredEnv = {
    ...fallbackEnv.values,
    ...env
  }
  const timeoutMs = Number.parseInt(layeredEnv.CC_CONSULT_TIMEOUT_MS || "90000", 10)

  return {
    baseUrl: normalizeBaseUrl(layeredEnv.CC_CONSULT_BASE_URL || layeredEnv.CC_MCP_REMOTE_BASE_URL || ""),
    bearerToken: layeredEnv.CC_CONSULT_BEARER_TOKEN || layeredEnv.CC_MCP_REMOTE_BEARER_TOKEN || "",
    model: layeredEnv.CC_CONSULT_MODEL || "claude-opus-4-6",
    endpoint: normalizeEndpoint(layeredEnv.CC_CONSULT_ENDPOINT || "chat.completions"),
    ownerUserId: layeredEnv.CC_CONSULT_OWNER_USER_ID || "xin",
    deviceId: layeredEnv.CC_CONSULT_DEVICE_ID || "mac",
    workspaceId: layeredEnv.CC_CONSULT_WORKSPACE_ID || "personal",
    sessionId: layeredEnv.CC_CONSULT_SESSION_ID || "consult-demo",
    source: layeredEnv.CC_CONSULT_SOURCE || "cc-consult-first",
    systemPrompt: layeredEnv.CC_CONSULT_SYSTEM_PROMPT || "",
    timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90000,
    envSources: fallbackEnv.sources
  }
}

export function getMissingRequiredConfig(config) {
  const missing = []
  if (!config.baseUrl) missing.push("CC_CONSULT_BASE_URL")
  if (!config.bearerToken) missing.push("CC_CONSULT_BEARER_TOKEN")
  return missing
}

export function getSafeConfigView(config) {
  return {
    ...config,
    bearerToken: redactSecret(config.bearerToken)
  }
}
