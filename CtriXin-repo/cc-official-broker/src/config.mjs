function readBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase())
}

function readListFlag(value, fallback = []) {
  if (value === undefined || value === null || value === "") return [...fallback]

  return Array.from(
    new Set(
      String(value)
        .split(",")
        .map(item => item.trim())
        .filter(Boolean)
    )
  )
}

function redactSecret(secret = "") {
  if (!secret) return ""
  if (secret.length <= 8) return "***"
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`
}

export function loadConfig(env = process.env) {
  const runnerHeartbeatIntervalMs = Number.parseInt(env.CC_BROKER_RUNNER_HEARTBEAT_MS || "10000", 10)
  const remoteServiceTimeoutMs = Number.parseInt(env.CC_BROKER_REMOTE_SERVICE_TIMEOUT_MS || "90000", 10)

  return {
    ownerUserId: env.CC_BROKER_OWNER_USER_ID || "xin",
    deviceId: env.CC_BROKER_DEVICE_ID || "mac",
    workspaceId: env.CC_BROKER_WORKSPACE_ID || "personal",
    clientName: env.CC_BROKER_CLIENT_NAME || "mms",
    clientVersion: env.CC_BROKER_CLIENT_VERSION || "0.1.0",
    brokerBaseUrl: env.CC_BROKER_BASE_URL || "",
    deviceKey: env.CC_BROKER_DEVICE_KEY || "",
    bearerToken: env.CC_BROKER_BEARER_TOKEN || "",
    compatApiKey: env.CC_BROKER_X_API_KEY || "",
    requestLogEnabled: readBooleanFlag(env.CC_BROKER_REQUEST_LOG_ENABLED, true),
    requestLogPath: env.CC_BROKER_REQUEST_LOG_PATH || ".ai/logs/broker-requests.jsonl",
    requestSource: env.CC_BROKER_REQUEST_SOURCE || "cc-official-broker",
    remoteModel: env.CC_BROKER_REMOTE_MODEL || "claude-opus-4-6",
    remoteServiceLabel: env.CC_BROKER_REMOTE_SERVICE_LABEL || "",
    remoteServiceBaseUrl: (env.CC_BROKER_REMOTE_SERVICE_BASE_URL || "").replace(/\/+$/, ""),
    remoteServiceBearerToken: env.CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN || "",
    remoteServiceApiKey: env.CC_BROKER_REMOTE_SERVICE_X_API_KEY || "",
    remoteServiceEndpoint: env.CC_BROKER_REMOTE_SERVICE_ENDPOINT || "responses",
    remoteServiceModel: env.CC_BROKER_REMOTE_SERVICE_MODEL || env.CC_BROKER_REMOTE_MODEL || "claude-opus-4-6",
    remoteServiceTimeoutMs:
      Number.isInteger(remoteServiceTimeoutMs) && remoteServiceTimeoutMs > 0 ? remoteServiceTimeoutMs : 90000,
    logLevel: env.CC_BROKER_LOG_LEVEL || "info",
    localStatePath: env.CC_BROKER_LOCAL_STATE_PATH || "",
    workspaceRoot: env.CC_BROKER_WORKSPACE_ROOT || process.cwd(),
    runnerTools: readListFlag(
      env.CC_BROKER_RUNNER_TOOLS,
      ["pwd", "git_status", "read_file", "search"]
    ),
    runnerWritableScope: env.CC_BROKER_RUNNER_WRITABLE_SCOPE || "none",
    runnerHeartbeatIntervalMs:
      Number.isInteger(runnerHeartbeatIntervalMs) && runnerHeartbeatIntervalMs > 0
        ? runnerHeartbeatIntervalMs
        : 10000
  }
}

export function getConfiguredAuthModes(config) {
  const modes = []
  if (config.bearerToken) modes.push("bearer")
  if (config.compatApiKey) modes.push("x-api-key")
  if (config.deviceKey) modes.push("device-key")
  return modes
}

export function getPreferredAuthMode(config) {
  if (config.bearerToken) return "bearer"
  if (config.compatApiKey) return "x-api-key"
  if (config.deviceKey) return "device-key"
  return "missing"
}

export function getMissingRequiredConfig(config) {
  const missing = []
  if (!config.brokerBaseUrl) missing.push("CC_BROKER_BASE_URL")
  if (getConfiguredAuthModes(config).length === 0) {
    missing.push("one of CC_BROKER_BEARER_TOKEN / CC_BROKER_X_API_KEY / CC_BROKER_DEVICE_KEY")
  }
  return missing
}

export function getSafeConfigView(config) {
  return {
    ...config,
    deviceKey: redactSecret(config.deviceKey),
    bearerToken: redactSecret(config.bearerToken),
    compatApiKey: redactSecret(config.compatApiKey),
    remoteServiceBearerToken: redactSecret(config.remoteServiceBearerToken),
    remoteServiceApiKey: redactSecret(config.remoteServiceApiKey)
  }
}
