import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { startBrokerStub } from "../broker/stubServer.mjs"
import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import { buildCreateSessionRequest } from "../mms/entryRequests.mjs"

function tomlString(value) {
  return JSON.stringify(String(value))
}

function buildDemoConfigToml({
  brokerBaseUrl,
  brokerRepoPath,
  remoteServiceBaseUrl,
  workspaceRoot,
  remoteServiceLabel
}) {
  return [
    '[ui]',
    'language = "zh"',
    '',
    '[provider]',
    'default = "default"',
    '',
    '[[providers]]',
    'id = "default"',
    'name = "Default Gateway"',
    'protocols = ["anthropic_messages", "openai_chat_completions"]',
    'supported_clis = ["claude", "codex", "qwen", "kimi"]',
    'enabled = true',
    '',
    '[user]',
    'role = "全部模型"',
    '',
    '[recommend]',
    'models = ["claude-sonnet-4-6", "qwen3-coder-plus", "gpt-4o-mini"]',
    '',
    '[[broker_profiles]]',
    'id = "official-broker-live"',
    'name = "Official Broker Live"',
    'enabled = true',
    `broker_base_url = ${tomlString(brokerBaseUrl)}`,
    'device_key_env = "MMS_BROKER_DEVICE_KEY_LIVE"',
    'owner_user_id = "xin"',
    'device_id = "mac"',
    'workspace_id = "personal"',
    'remote_runtime = "official-claude-code"',
    `remote_service_label = ${tomlString(remoteServiceLabel || "live-remote-runtime")}`,
    `remote_service_base_url = ${tomlString(remoteServiceBaseUrl)}`,
    'remote_service_endpoint = "responses"',
    'remote_service_model = "claude-opus-4-6"',
    `broker_repo_path = ${tomlString(brokerRepoPath)}`,
    `note = ${tomlString(`workspace=${workspaceRoot}`)}`,
    ''
  ].join("\n")
}

function buildInlinePythonBootstrap({ configPath, mmsRoot, resumeLast = false }) {
  return [
    "import sys",
    "from pathlib import Path",
    "import tomllib",
    `repo = Path(${JSON.stringify(mmsRoot)})`,
    "sys.path.insert(0, str(repo))",
    "import mms_broker",
    `cfg = tomllib.loads(Path(${JSON.stringify(configPath)}).read_text(encoding='utf-8'))`,
    `argv = ['run', 'official-broker-live'${resumeLast ? ", '--resume-last'" : ""}]`,
    "raise SystemExit(mms_broker.handle_broker_command(cfg, argv, command_name='mms-live-demo'))"
  ].join("\n")
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
}

async function loadRememberedSessionId(localStatePath) {
  try {
    const raw = await readFile(localStatePath, "utf8")
    const parsed = JSON.parse(raw)
    const items = Object.values(parsed?.sessions || {})
    const latest = items
      .filter(item => item && typeof item === "object" && item.session_id)
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0]
    return latest?.session_id || ""
  } catch {
    return ""
  }
}

async function seedRememberedSession({ config, brokerBaseUrl, workspaceRoot, sessionId }) {
  if (!sessionId) {
    return false
  }

  const seedConfig = {
    ...config,
    brokerBaseUrl,
    deviceKey: config.deviceKey || "demo-device-key"
  }
  const authPayload = buildDeviceAuthPayload(seedConfig)
  const authResponse = await fetch(`${brokerBaseUrl}/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(authPayload)
  }).then(response => response.json())

  if (!authResponse.ok) {
    throw new Error(authResponse.error || "failed to seed remembered session auth")
  }

  const createPayload = buildCreateSessionRequest(seedConfig, {
    clientSessionId: sessionId,
    projectRoot: workspaceRoot,
    initialGoal: "seed remembered session for live demo",
    initialPrompt: "seed remembered session"
  })
  const createResponse = await fetch(`${brokerBaseUrl}/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authResponse.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(createPayload)
  }).then(response => response.json())

  if (!createResponse.ok) {
    throw new Error(createResponse.error || "failed to seed remembered session")
  }

  return true
}

export async function runMmsLiveDemo(config, overrides = {}) {
  if (!config.remoteServiceBaseUrl) {
    throw new Error("CC_BROKER_REMOTE_SERVICE_BASE_URL is required")
  }
  if (!config.remoteServiceBearerToken && !config.remoteServiceApiKey) {
    throw new Error(
      "one of CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN / CC_BROKER_REMOTE_SERVICE_X_API_KEY is required"
    )
  }

  const workspaceRoot = path.resolve(overrides.projectRoot || config.workspaceRoot || process.cwd())
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(moduleDir, "..", "..")
  const mmsRoot = path.resolve(repoRoot, "..", "multi-model-switch")
  const python = process.env.PYTHON || "python3"

  const tempRoot = path.resolve(repoRoot, "tmp", "mms-live-demo")
  const mmsConfigDir = path.join(tempRoot, "mms-config")
  const localStatePath = path.join(tempRoot, "cc-broker-session-registry.json")
  await mkdir(mmsConfigDir, { recursive: true })

  const broker = await startBrokerStub({
    config: {
      ...config,
      deviceKey: config.deviceKey || "demo-device-key",
      requestSource: "cc-official-broker:mms-live-demo"
    }
  })

  const configPath = path.join(mmsConfigDir, "config.toml")
  const configToml = buildDemoConfigToml({
    brokerBaseUrl: broker.baseUrl,
    brokerRepoPath: repoRoot,
    remoteServiceBaseUrl: config.remoteServiceBaseUrl,
    remoteServiceLabel: config.remoteServiceLabel || "live-remote-runtime",
    workspaceRoot
  })
  await writeFile(configPath, `${configToml}\n`, "utf8")

  const rememberedSessionId = overrides.resumeLast ? await loadRememberedSessionId(localStatePath) : ""
  if (overrides.resumeLast && rememberedSessionId) {
    await seedRememberedSession({
      config,
      brokerBaseUrl: broker.baseUrl,
      workspaceRoot,
      sessionId: rememberedSessionId
    })
  }

  const launcherPath = path.join(tempRoot, "run-mms-broker-live.py")
  await writeFile(
    launcherPath,
    `${buildInlinePythonBootstrap({
      configPath,
      mmsRoot,
      resumeLast: Boolean(overrides.resumeLast)
    })}\n`,
    "utf8"
  )

  process.stdout.write("\n")
  process.stdout.write("MMS live demo is ready.\n")
  process.stdout.write(`- mms_config_dir: ${mmsConfigDir}\n`)
  process.stdout.write(`- broker: ${broker.baseUrl}\n`)
  process.stdout.write(`- remote_service: ${config.remoteServiceBaseUrl}\n`)
  process.stdout.write(`- local_state: ${localStatePath}\n`)
  process.stdout.write("Try inside the shell:\n")
  process.stdout.write("  你好，回复一句你是谁\n")
  process.stdout.write("  /tool pwd\n")
  process.stdout.write("  /status\n")
  process.stdout.write("  /exit\n\n")

  const child = spawn(python, [launcherPath], {
    cwd: workspaceRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      MMS_BROKER_DEVICE_KEY_LIVE: config.deviceKey || "demo-device-key",
      CC_BROKER_LOCAL_STATE_PATH: localStatePath
    }
  })

  const result = await waitForExit(child)

  await broker.close().catch(() => {})

  return {
    ok: (result.code || 0) === 0,
    answer: "mms live demo finished",
    exit_code: result.code,
    signal: result.signal,
    mms_config_dir: mmsConfigDir,
    local_state_path: localStatePath,
    broker_base_url: broker.baseUrl,
    remote_service_base_url: config.remoteServiceBaseUrl
  }
}
