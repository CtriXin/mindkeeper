function tomlValue(value) {
  return JSON.stringify(String(value))
}

export function buildBrokerProfileSample(config, overrides = {}) {
  const profileId = overrides.profileId || `official-broker-${config.workspaceId}`
  const profileName =
    overrides.profileName ||
    `Official Broker ${config.workspaceId.charAt(0).toUpperCase()}${config.workspaceId.slice(1)}`

  const fields = {
    id: profileId,
    name: profileName,
    enabled: true,
    broker_base_url: config.brokerBaseUrl || "https://broker.example.com",
    entry_mode: "official_connect",
    fallback_entry_mode: "",
    device_key_env: "MMS_BROKER_DEVICE_KEY_PERSONAL",
    owner_user_id: config.ownerUserId,
    device_id: config.deviceId,
    workspace_id: config.workspaceId,
    remote_runtime: "official-claude-code",
    remote_service_label: "server-mms-personal",
    remote_service_base_url: config.remoteServiceBaseUrl || "https://cc-service.example.com",
    remote_service_endpoint: config.remoteServiceEndpoint || "responses",
    remote_service_model: config.remoteServiceModel || "claude-opus-4-6",
    remote_service_bearer_token_env: "MMS_REMOTE_SERVICE_TOKEN_PERSONAL"
  }

  const toml = [
    "[[broker_profiles]]",
    `id = ${tomlValue(fields.id)}`,
    `name = ${tomlValue(fields.name)}`,
    "enabled = true",
    "",
    `broker_base_url = ${tomlValue(fields.broker_base_url)}`,
    `entry_mode = ${tomlValue(fields.entry_mode)}`,
    `fallback_entry_mode = ${tomlValue(fields.fallback_entry_mode)}`,
    `device_key_env = ${tomlValue(fields.device_key_env)}`,
    "",
    `owner_user_id = ${tomlValue(fields.owner_user_id)}`,
    `device_id = ${tomlValue(fields.device_id)}`,
    `workspace_id = ${tomlValue(fields.workspace_id)}`,
    "",
    `remote_runtime = ${tomlValue(fields.remote_runtime)}`,
    `remote_service_label = ${tomlValue(fields.remote_service_label)}`,
    `remote_service_base_url = ${tomlValue(fields.remote_service_base_url)}`,
    `remote_service_endpoint = ${tomlValue(fields.remote_service_endpoint)}`,
    `remote_service_model = ${tomlValue(fields.remote_service_model)}`,
    `remote_service_bearer_token_env = ${tomlValue(fields.remote_service_bearer_token_env)}`
  ].join("\n")

  return {
    profile_type: "broker_profile",
    fields,
    toml,
    notes: [
      "This profile now prefers official_connect so MMS can enter the real local Claude Code UI directly",
      "official_connect auto-syncs the remote claude auth bundle over SSH into a local CLAUDE_CONFIG_DIR before launch",
      "device_key and remote service secrets can come from *_env fields instead of inline literals",
      "The selected profile should trigger broker auth/session flow, not normal provider relay",
      "One broker profile can now pin one remote runtime target, which helps early multi-OAuth testing"
    ]
  }
}
