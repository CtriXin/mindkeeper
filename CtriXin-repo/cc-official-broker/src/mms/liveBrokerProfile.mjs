import os from "node:os"
import path from "node:path"
import { readFile } from "node:fs/promises"

function defaultMmsConfigPath() {
  const home = os.userInfo().homedir || os.homedir()
  return path.join(home, ".config", "mms", "config.toml")
}

function defaultMmsCredentialsPath() {
  const home = os.userInfo().homedir || os.homedir()
  return path.join(home, ".config", "mms", "credentials.sh")
}

function parseTomlScalar(raw = "") {
  const text = String(raw || "").trim()
  if (!text) return ""

  if (text === "true") return true
  if (text === "false") return false
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10)

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1)
    }
    return text
  }
}

function parseBrokerProfileBlock(blockLines = []) {
  const profile = {}

  for (const line of blockLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed === "[[broker_profiles]]") {
      continue
    }
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/)
    if (!match) continue
    profile[match[1]] = parseTomlScalar(match[2])
  }

  return profile
}

function listBrokerProfilesFromToml(content = "") {
  const lines = String(content || "").split(/\r?\n/)
  const profiles = []
  let current = []

  for (const line of lines) {
    if (line.trim() === "[[broker_profiles]]") {
      if (current.length > 0) {
        profiles.push(parseBrokerProfileBlock(current))
      }
      current = [line]
      continue
    }

    if (current.length > 0) {
      if (line.trim().startsWith("[[") && line.trim() !== "[[broker_profiles]]") {
        profiles.push(parseBrokerProfileBlock(current))
        current = []
      }
    }

    if (current.length > 0) {
      current.push(line)
    }
  }

  if (current.length > 0) {
    profiles.push(parseBrokerProfileBlock(current))
  }

  return profiles.filter(item => item && typeof item === "object" && item.id)
}

function parseShellValue(raw = "") {
  const text = String(raw || "").trim()
  if (!text) return ""

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }

  return text
}

function parseExportedEnv(content = "") {
  const values = {}

  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.+?)\s*$/)
    if (!match) continue
    values[match[1]] = parseShellValue(match[2])
  }

  return values
}

function resolveSecret(profile, exportedEnv, directKey, envKey, fallback = "") {
  const envName = String(profile?.[envKey] || "").trim()
  if (envName) {
    const envValue = process.env[envName] || exportedEnv[envName]
    if (envValue) return String(envValue).trim()
  }

  const inlineValue = String(profile?.[directKey] || "").trim()
  if (inlineValue) return inlineValue
  return String(fallback || "").trim()
}

export async function resolveLiveBrokerProfile(baseConfig, overrides = {}) {
  const profileId = String(overrides.profileId || "official-broker-personal").trim() || "official-broker-personal"
  const configPath = path.resolve(overrides.configPath || defaultMmsConfigPath())
  const credentialsPath = path.resolve(overrides.credentialsPath || defaultMmsCredentialsPath())

  let configToml = ""
  try {
    configToml = await readFile(configPath, "utf8")
  } catch (error) {
    throw new Error(`failed to read MMS config: ${configPath}`)
  }

  const profile = listBrokerProfilesFromToml(configToml).find(item => String(item.id || "").trim() === profileId)
  if (!profile) {
    throw new Error(`broker profile not found in MMS config: ${profileId}`)
  }
  if (profile.enabled === false) {
    throw new Error(`broker profile is disabled: ${profileId}`)
  }

  let exportedEnv = {}
  try {
    exportedEnv = parseExportedEnv(await readFile(credentialsPath, "utf8"))
  } catch {
    exportedEnv = {}
  }

  const resolved = {
    ...baseConfig,
    brokerBaseUrl: String(profile.broker_base_url || baseConfig.brokerBaseUrl || "http://127.0.0.1:8787").replace(/\/+$/, ""),
    deviceKey: resolveSecret(profile, exportedEnv, "device_key", "device_key_env", baseConfig.deviceKey),
    ownerUserId: String(profile.owner_user_id || baseConfig.ownerUserId || "xin"),
    deviceId: String(profile.device_id || baseConfig.deviceId || "mac"),
    workspaceId: String(profile.workspace_id || baseConfig.workspaceId || "personal"),
    clientName: String(profile.client_name || baseConfig.clientName || "mms"),
    clientVersion: String(profile.client_version || baseConfig.clientVersion || "0.1.0"),
    requestSource: String(profile.request_source || baseConfig.requestSource || "multi-model-switch"),
    runnerTools: Array.isArray(profile.runner_tools) ? profile.runner_tools : baseConfig.runnerTools,
    runnerWritableScope: String(profile.runner_writable_scope || baseConfig.runnerWritableScope || "none"),
    remoteServiceLabel: String(profile.remote_service_label || baseConfig.remoteServiceLabel || ""),
    remoteServiceBaseUrl: String(profile.remote_service_base_url || baseConfig.remoteServiceBaseUrl || "").replace(/\/+$/, ""),
    remoteServiceEndpoint: String(profile.remote_service_endpoint || baseConfig.remoteServiceEndpoint || "responses"),
    remoteServiceModel: String(profile.remote_service_model || baseConfig.remoteServiceModel || baseConfig.remoteModel || "claude-opus-4-6"),
    remoteServiceBearerToken: resolveSecret(
      profile,
      exportedEnv,
      "remote_service_bearer_token",
      "remote_service_bearer_token_env",
      baseConfig.remoteServiceBearerToken
    ),
    remoteServiceApiKey: resolveSecret(
      profile,
      exportedEnv,
      "remote_service_api_key",
      "remote_service_api_key_env",
      baseConfig.remoteServiceApiKey
    )
  }

  if (!resolved.brokerBaseUrl) {
    throw new Error(`broker_base_url is missing in profile: ${profileId}`)
  }
  if (!resolved.deviceKey) {
    throw new Error(`device key is missing for profile: ${profileId}`)
  }
  if (!resolved.remoteServiceBaseUrl) {
    throw new Error(`remote service base url is missing for profile: ${profileId}`)
  }
  if (!resolved.remoteServiceBearerToken && !resolved.remoteServiceApiKey) {
    throw new Error(`remote service auth is missing for profile: ${profileId}`)
  }

  return {
    ok: true,
    profileId,
    profile,
    configPath,
    credentialsPath,
    config: resolved
  }
}
