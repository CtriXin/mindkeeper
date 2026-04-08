import { spawn } from "node:child_process"

import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import {
  detectDirectConnectSupport,
  getClaudeAuthStatus,
  getClaudeVersion,
  resolveClaudeBinary
} from "./claudeBinary.mjs"
import { syncRemoteAuthBundle } from "./remoteAuthSync.mjs"

function normalizeBaseUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/$/, "")
  url.hash = ""
  return url
}

export function buildDirectConnectUrl({ baseUrl, authToken }) {
  const normalized = normalizeBaseUrl(baseUrl)
  const query = new URLSearchParams()
  query.set("serverUrl", normalized.toString())
  query.set("authToken", authToken)
  query.set("token", authToken)

  const path = normalized.pathname && normalized.pathname !== "/" ? normalized.pathname : ""
  return `cc://${normalized.host}${path}?${query.toString()}`
}

async function authenticateDevice(config) {
  const response = await fetch(`${config.brokerBaseUrl}/auth/device`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(buildDeviceAuthPayload(config))
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok || !payload?.access_token) {
    const message =
      payload?.error ||
      payload?.message ||
      `broker device auth failed: ${response.status} ${response.statusText}`
    throw new Error(message)
  }

  return payload
}

export async function runOfficialConnect(config, overrides = {}) {
  if (!config.brokerBaseUrl) {
    throw new Error("CC_BROKER_BASE_URL is required")
  }
  if (!config.deviceKey) {
    throw new Error("CC_BROKER_DEVICE_KEY is required")
  }

  const binary = resolveClaudeBinary()
  if (!binary.ok) {
    throw new Error(binary.error || "official claude binary not found")
  }

  const version = getClaudeVersion(binary.path)
  if (!version.ok) {
    throw new Error(version.error || "failed to read official claude version")
  }
  const localAuth = getClaudeAuthStatus(binary.path)
  const support = detectDirectConnectSupport(binary.path)
  if (!support.ok) {
    throw new Error(
      `local official claude ${version.version} does not include DIRECT_CONNECT in this build; this machine cannot enter broker via normal cc TUI yet`
    )
  }

  const deviceAuth = await authenticateDevice(config)
  const ccUrl = buildDirectConnectUrl({
    baseUrl: config.brokerBaseUrl,
    authToken: deviceAuth.access_token
  })

  const argv = [ccUrl]
  const printPrompt = String(overrides.printPrompt || "").trim()
  if (printPrompt) {
    argv.push("-p", printPrompt)
  }

  let remoteAuth = null
  try {
    remoteAuth = await syncRemoteAuthBundle(config)
  } catch (error) {
    if (localAuth.ok && localAuth.loggedIn) {
      remoteAuth = null
    } else {
      throw new Error(
        `unable to sync remote claude auth bundle for official_connect: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(binary.path, argv, {
      cwd: overrides.projectRoot || config.workspaceRoot || process.cwd(),
      env: {
        ...process.env,
        ...(remoteAuth?.auth_dir
          ? {
              CLAUDE_CONFIG_DIR: remoteAuth.auth_dir
            }
          : {}),
        DISABLE_TELEMETRY: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
      },
      stdio: "inherit"
    })

    child.on("error", reject)
    child.on("exit", (code, signal) => {
      resolve({
        ok: code === 0,
        code: code ?? 1,
        signal,
        official: {
          path: binary.path,
          version: version.version
        },
        remote_auth: remoteAuth,
        broker_auth: {
          token_type: deviceAuth.token_type || "Bearer",
          expires_in: deviceAuth.expires_in || 0
        },
        connect_url: ccUrl
      })
    })
  })
}
