import os from "node:os"
import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

function tomlValue(value) {
  return JSON.stringify(String(value))
}

function pickDefined(primary, fallback = "") {
  return primary === undefined ? fallback : primary
}

function defaultConfigPath() {
  const home = os.userInfo().homedir || os.homedir()
  return path.join(home, ".config", "mms", "config.toml")
}

export function buildPersistentBrokerProfile(config, overrides = {}) {
  const profileId = overrides.profileId || `official-broker-${config.workspaceId}`
  const profileName =
    overrides.profileName ||
    `Official Broker ${config.workspaceId.charAt(0).toUpperCase()}${config.workspaceId.slice(1)}`
  const brokerBaseUrl = overrides.brokerBaseUrl || config.brokerBaseUrl || "http://127.0.0.1:8787"
  const deviceKeyEnv = overrides.deviceKeyEnv || "MMS_BROKER_DEVICE_KEY_PERSONAL"
  const remoteBearerEnv = overrides.remoteServiceBearerTokenEnv || "MMS_REMOTE_SERVICE_TOKEN_PERSONAL"
  const remoteClaudeSshTargetEnv =
    overrides.remoteClaudeSshTargetEnv || "CC_BROKER_REMOTE_CLAUDE_SSH_TARGET"
  const remoteClaudeContainerNameEnv =
    overrides.remoteClaudeContainerNameEnv || "CC_BROKER_REMOTE_CLAUDE_CONTAINER_NAME"
  const remoteClaudeCredentialsPathEnv =
    overrides.remoteClaudeCredentialsPathEnv || "CC_BROKER_REMOTE_CLAUDE_CREDENTIALS_PATH"
  const remoteClaudeGlobalConfigPathEnv =
    overrides.remoteClaudeGlobalConfigPathEnv || "CC_BROKER_REMOTE_CLAUDE_GLOBAL_CONFIG_PATH"
  const entryMode = overrides.entryMode || "official_proxy"
  const fallbackEntryMode = overrides.fallbackEntryMode || ""
  const runnerTools = overrides.runnerTools || config.runnerTools || ["pwd", "git_status", "read_file", "search"]

  return {
    id: profileId,
    name: profileName,
    enabled: overrides.enabled ?? true,
    broker_base_url: brokerBaseUrl,
    entry_mode: entryMode,
    fallback_entry_mode: fallbackEntryMode,
    device_key_env: deviceKeyEnv,
    owner_user_id: overrides.ownerUserId || config.ownerUserId,
    device_id: overrides.deviceId || config.deviceId,
    workspace_id: overrides.workspaceId || config.workspaceId,
    remote_runtime: "official-claude-code",
    remote_service_label: overrides.remoteServiceLabel || config.remoteServiceLabel || "server-live-runtime",
    remote_service_base_url: overrides.remoteServiceBaseUrl || config.remoteServiceBaseUrl || "http://23.95.30.199:28082",
    remote_service_endpoint: overrides.remoteServiceEndpoint || config.remoteServiceEndpoint || "responses",
    remote_service_model: overrides.remoteServiceModel || config.remoteServiceModel || "claude-opus-4-6",
    remote_claude_ssh_target: pickDefined(overrides.remoteClaudeSshTarget, config.remoteClaudeSshTarget || ""),
    remote_claude_container_name: pickDefined(overrides.remoteClaudeContainerName, config.remoteClaudeContainerName || ""),
    remote_claude_ssh_target_env: remoteClaudeSshTargetEnv,
    remote_claude_container_name_env: remoteClaudeContainerNameEnv,
    remote_claude_credentials_path_env: remoteClaudeCredentialsPathEnv,
    remote_claude_global_config_path_env: remoteClaudeGlobalConfigPathEnv,
    remote_service_bearer_token_env: remoteBearerEnv,
    broker_repo_path: overrides.brokerRepoPath || process.cwd(),
    runner_tools: runnerTools,
    runner_writable_scope: overrides.runnerWritableScope || config.runnerWritableScope || "none",
    claude_bypass_permissions: overrides.claudeBypassPermissions ?? config.claudeBypassPermissions ?? false
  }
}

export function renderBrokerProfileToml(profile) {
  const lines = [
    "[[broker_profiles]]",
    `id = ${tomlValue(profile.id)}`,
    `name = ${tomlValue(profile.name)}`,
    `enabled = ${profile.enabled ? "true" : "false"}`,
    `broker_base_url = ${tomlValue(profile.broker_base_url)}`,
    `entry_mode = ${tomlValue(profile.entry_mode || "shell")}`,
    `fallback_entry_mode = ${tomlValue(profile.fallback_entry_mode || "")}`,
    `device_key_env = ${tomlValue(profile.device_key_env)}`,
    `owner_user_id = ${tomlValue(profile.owner_user_id)}`,
    `device_id = ${tomlValue(profile.device_id)}`,
    `workspace_id = ${tomlValue(profile.workspace_id)}`,
    `remote_runtime = ${tomlValue(profile.remote_runtime || "official-claude-code")}`,
    `remote_service_label = ${tomlValue(profile.remote_service_label || "")}`,
    `remote_service_base_url = ${tomlValue(profile.remote_service_base_url || "")}`,
    `remote_service_endpoint = ${tomlValue(profile.remote_service_endpoint || "responses")}`,
    `remote_service_model = ${tomlValue(profile.remote_service_model || "")}`,
    `remote_claude_ssh_target = ${tomlValue(profile.remote_claude_ssh_target || "")}`,
    `remote_claude_container_name = ${tomlValue(profile.remote_claude_container_name || "")}`,
    `remote_claude_ssh_target_env = ${tomlValue(profile.remote_claude_ssh_target_env || "")}`,
    `remote_claude_container_name_env = ${tomlValue(profile.remote_claude_container_name_env || "")}`,
    `remote_claude_credentials_path_env = ${tomlValue(profile.remote_claude_credentials_path_env || "")}`,
    `remote_claude_global_config_path_env = ${tomlValue(profile.remote_claude_global_config_path_env || "")}`,
    `remote_service_bearer_token_env = ${tomlValue(profile.remote_service_bearer_token_env)}`,
    `broker_repo_path = ${tomlValue(profile.broker_repo_path)}`,
    `runner_tools = [${(profile.runner_tools || []).map(tomlValue).join(", ")}]`,
    `runner_writable_scope = ${tomlValue(profile.runner_writable_scope || "none")}`,
    `claude_bypass_permissions = ${profile.claude_bypass_permissions ? "true" : "false"}`
  ]

  return `${lines.join("\n")}\n`
}

function parseTomlStringLiteral(raw = "") {
  const text = String(raw || "").trim()
  if (!text) return ""
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

function findBrokerProfileBlocks(content = "") {
  const lines = String(content || "").split(/\r?\n/)
  const blocks = []
  let index = 0

  while (index < lines.length) {
    if (lines[index].trim() !== "[[broker_profiles]]") {
      index += 1
      continue
    }

    const start = index
    index += 1
    while (index < lines.length && !lines[index].trim().startsWith("[[")) {
      index += 1
    }
    const end = index
    const body = lines.slice(start, end)
    const idLine = body.find(line => line.trim().startsWith("id"))
    const match = idLine ? idLine.match(/^\s*id\s*=\s*(.+?)\s*$/) : null

    blocks.push({
      start,
      end,
      id: parseTomlStringLiteral(match ? match[1] : "")
    })
  }

  return {
    lines,
    blocks
  }
}

function upsertBrokerProfileToml(content, profileToml, profileId) {
  const { lines, blocks } = findBrokerProfileBlocks(content)
  const matching = blocks.find(block => block.id === profileId)
  const profileLines = profileToml.trimEnd().split("\n")

  if (matching) {
    const next = [...lines.slice(0, matching.start), ...profileLines, ...lines.slice(matching.end)]
    return `${next.join("\n").replace(/\n{3,}/g, "\n\n")}\n`
  }

  const base = String(content || "").trimEnd()
  if (!base) {
    return `${profileToml.trimEnd()}\n`
  }

  return `${base}\n\n${profileToml.trimEnd()}\n`
}

export async function installBrokerProfile(config, overrides = {}) {
  const configPath = path.resolve(overrides.configPath || defaultConfigPath())
  const profile = buildPersistentBrokerProfile(config, overrides)
  const profileToml = renderBrokerProfileToml(profile)

  let existing = ""
  try {
    existing = await readFile(configPath, "utf8")
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error
    }
  }

  const next = upsertBrokerProfileToml(existing, profileToml, profile.id)
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, next, "utf8")

  return {
    ok: true,
    config_path: configPath,
    profile,
    installed: true,
    note: "profile written to MMS config; secrets still come from *_env"
  }
}

export function buildProfileInstallGuide(config, overrides = {}) {
  const profile = buildPersistentBrokerProfile(config, overrides)
  return {
    ok: true,
    config_path: path.resolve(overrides.configPath || defaultConfigPath()),
    profile,
    profile_toml: renderBrokerProfileToml(profile),
    env_examples: [
      `${profile.device_key_env}=demo-device-key`,
      `${profile.remote_service_bearer_token_env}=sk_live_xxxxx`,
      `${profile.remote_claude_ssh_target_env}=root@23.95.30.199`,
      `${profile.remote_claude_container_name_env}=`,
      `${profile.remote_claude_credentials_path_env}=/var/lib/cc-mcp-bridge/claude-home-1/.credentials.json`,
      `${profile.remote_claude_global_config_path_env}=/var/lib/cc-mcp-bridge/claude-home-1/.claude.json`
    ],
    run_steps: [
      `现在推荐把 profile 默认入口固定为 official_proxy，MMS 会直接拉起本机真实 Claude Code CLI，再通过本地 proxy 接到远端 official runtime`,
      `当前 live auth source 已收口为 host-path 读取；如容器名留空，remote auth sync 会直接按 credentials/global-config 路径读取`,
      `如需让 official CLI 默认跳过本地权限确认，可把 claude_bypass_permissions 改成 true`,
      `在项目目录执行: npm run broker:live`,
      `然后在任意工作目录执行: mms broker run ${profile.id}`,
      `如果要续上最近一次本地会话: mms broker run ${profile.id} --resume-last`
    ]
  }
}
