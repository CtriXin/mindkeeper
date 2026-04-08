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
      return JSON.parse(text.replace(/,\s*]/g, "]"))
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

  for (let index = 0; index < blockLines.length; index += 1) {
    const line = blockLines[index]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed === "[[broker_profiles]]") {
      continue
    }
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/)
    if (!match) continue

    let value = match[2]
    if (value.trim().startsWith("[") && !value.trim().endsWith("]")) {
      const chunks = [value]
      while (index + 1 < blockLines.length) {
        index += 1
        const nextLine = blockLines[index]
        chunks.push(nextLine)
        if (String(nextLine).trim().endsWith("]")) {
          break
        }
      }
      value = chunks.join("\n")
    }

    profile[match[1]] = parseTomlScalar(value)
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

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)
}

function resolveSecret(profile, exportedEnv, directKey, envKey, fallback = "") {
  const envName = String(profile?.[envKey] || "").trim()
  if (envName) {
    if (hasOwn(process.env, envName)) {
      return String(process.env[envName] || "").trim()
    }
    if (hasOwn(exportedEnv, envName)) {
      return String(exportedEnv[envName] || "").trim()
    }
  }

  if (hasOwn(profile, directKey)) {
    return String(profile?.[directKey] || "").trim()
  }
  return String(fallback || "").trim()
}

function resolveProfileValue(profile, exportedEnv, directKey, envKey, fallback = "") {
  const envName = String(profile?.[envKey] || "").trim()
  if (envName) {
    if (hasOwn(process.env, envName)) {
      return String(process.env[envName] || "").trim()
    }
    if (hasOwn(exportedEnv, envName)) {
      return String(exportedEnv[envName] || "").trim()
    }
  }

  if (hasOwn(profile, directKey)) {
    return String(profile?.[directKey] || "").trim()
  }
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
    claudeBypassPermissions:
      (typeof profile.claude_bypass_permissions === "boolean"
        ? profile.claude_bypass_permissions
        : false) || Boolean(baseConfig.claudeBypassPermissions),
    remoteServiceLabel: String(profile.remote_service_label || baseConfig.remoteServiceLabel || ""),
    remoteServiceBaseUrl: String(profile.remote_service_base_url || baseConfig.remoteServiceBaseUrl || "").replace(/\/+$/, ""),
    remoteServiceEndpoint: String(profile.remote_service_endpoint || baseConfig.remoteServiceEndpoint || "responses"),
    remoteServiceModel: String(profile.remote_service_model || baseConfig.remoteServiceModel || baseConfig.remoteModel || "claude-opus-4-6"),
    remoteClaudeSshTarget: resolveProfileValue(
      profile,
      exportedEnv,
      "remote_claude_ssh_target",
      "remote_claude_ssh_target_env",
      baseConfig.remoteClaudeSshTarget || exportedEnv.CC_BROKER_REMOTE_CLAUDE_SSH_TARGET || ""
    ),
    remoteClaudeContainerName: resolveProfileValue(
      profile,
      exportedEnv,
      "remote_claude_container_name",
      "remote_claude_container_name_env",
      baseConfig.remoteClaudeContainerName || exportedEnv.CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME || ""
    ),
    remoteClaudeCredentialsPath: resolveProfileValue(
      profile,
      exportedEnv,
      "remote_claude_credentials_path",
      "remote_claude_credentials_path_env",
      baseConfig.remoteClaudeCredentialsPath || exportedEnv.CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH || ""
    ),
    remoteClaudeGlobalConfigPath: resolveProfileValue(
      profile,
      exportedEnv,
      "remote_claude_global_config_path",
      "remote_claude_global_config_path_env",
      baseConfig.remoteClaudeGlobalConfigPath || exportedEnv.CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH || ""
    ),
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
