import { spawn } from "node:child_process"

import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import { buildCreateSessionRequest, buildResumeSessionRequest } from "../mms/entryRequests.mjs"
import {
  buildOfficialHeadlessLaunchPlan,
  getClaudeVersion,
  resolveClaudeBinary
} from "./claudeBinary.mjs"

function defaultPrompt() {
  return "Reply with exactly OFFICIAL_ATTACH_OK and nothing else. Do not use tools."
}

function tailPush(lines, line, limit = 20) {
  if (!line) {
    return
  }
  lines.push(String(line))
  if (lines.length > limit) {
    lines.shift()
  }
}

async function authenticateDevice(config, overrides = {}) {
  const authRequest = buildDeviceAuthPayload(config, overrides)
  const authResponse = await fetch(`${config.brokerBaseUrl}/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(authRequest)
  }).then(response => response.json())

  if (!authResponse.ok) {
    throw new Error(authResponse.error || "device auth failed")
  }

  return authResponse
}

async function createOrResumeSession(config, authResponse, overrides = {}) {
  const sessionId = overrides.sessionId || `session_local_${Date.now().toString(36)}`
  const mode = overrides.mode || "create"
  const projectRoot = overrides.projectRoot || config.workspaceRoot || process.cwd()

  const sessionRequest =
    mode === "resume"
      ? buildResumeSessionRequest(config, { ...overrides, sessionId })
      : buildCreateSessionRequest(config, {
          ...overrides,
          clientSessionId: sessionId,
          projectRoot,
          initialGoal: overrides.initialGoal || "official attach smoke test",
          initialPrompt: overrides.initialPrompt || overrides.prompt || defaultPrompt()
        })

  const sessionResponse = await fetch(`${config.brokerBaseUrl}/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authResponse.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(sessionRequest)
  }).then(response => response.json())

  if (!sessionResponse.ok) {
    throw new Error(sessionResponse.error || "session request failed")
  }

  return sessionResponse
}

async function fetchSessionSnapshot(config, accessToken, sessionId) {
  const response = await fetch(`${config.brokerBaseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  }).then(raw => raw.json())

  if (!response.ok) {
    throw new Error(response.error || "session inspect failed")
  }

  return response
}

async function waitForOfficialResult(config, accessToken, sessionId, timeoutMs) {
  const startedAt = Date.now()
  let lastSnapshot = null

  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await fetchSessionSnapshot(config, accessToken, sessionId)
    if (lastSnapshot?.session?.official_child?.last_result) {
      return lastSnapshot
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  return lastSnapshot
}

export async function runOfficialAttach(config, overrides = {}) {
  if (!config.brokerBaseUrl) {
    throw new Error("CC_BROKER_BASE_URL is required")
  }

  if (!config.deviceKey) {
    throw new Error("CC_BROKER_DEVICE_KEY is required")
  }

  const prompt = overrides.prompt || defaultPrompt()
  const binary = resolveClaudeBinary()
  if (!binary.ok) {
    throw new Error(binary.error || "official claude binary not found")
  }

  const version = getClaudeVersion(binary.path)
  if (!version.ok) {
    throw new Error(version.error || "failed to read official claude version")
  }

  const authResponse = await authenticateDevice(config, overrides)
  const sessionResponse = await createOrResumeSession(config, authResponse, {
    ...overrides,
    prompt
  })
  const sessionId = sessionResponse.session?.session_id || overrides.sessionId || ""
  const officialChild = sessionResponse.official_child

  if (!officialChild?.sdk_url || !officialChild?.access_token) {
    throw new Error(
      `broker ${config.brokerBaseUrl} did not return official_child.sdk_url + access_token; this backend is likely still on the older session contract`
    )
  }

  const launch = buildOfficialHeadlessLaunchPlan({
    binaryPath: binary.path,
    sessionId,
    sdkUrl: officialChild.sdk_url,
    accessToken: officialChild.access_token,
    workingDir: overrides.projectRoot || config.workspaceRoot || process.cwd(),
    useCcrV2: false,
    disableTelemetry: true,
    disableNonessentialTraffic: true
  })

  const stderrTail = []
  const stdoutTail = []
  const child = spawn(launch.binary_path, launch.argv, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...launch.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  })

  child.stdout.on("data", chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) {
        tailPush(stdoutTail, line)
      }
    }
  })

  child.stderr.on("data", chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) {
        tailPush(stderrTail, line)
      }
    }
  })

  let exitCode = null
  let exitSignal = null
  child.on("exit", (code, signal) => {
    exitCode = code
    exitSignal = signal
  })

  let finalSnapshot = null
  try {
    finalSnapshot = await waitForOfficialResult(
      config,
      authResponse.access_token,
      sessionId,
      overrides.timeoutMs || 90000
    )
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await new Promise(resolve => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL")
          }
        }, 1500)
        child.once("exit", () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  const sessionSnapshot = finalSnapshot?.session || null
  const lastResult = sessionSnapshot?.official_child?.last_result || null
  const assistantTexts = sessionSnapshot?.official_child?.assistant_texts || []
  const protocolOk = Boolean(
    sessionSnapshot?.official_child?.initialized &&
      lastResult &&
      sessionSnapshot?.official_child?.auth_header_present
  )
  const authRequired =
    lastResult?.is_error === true && /not logged in/i.test(String(lastResult?.result || ""))
  const modelTurnOk = Boolean(lastResult && !lastResult.is_error)

  return {
    ok: protocolOk,
    status: !lastResult
      ? "launched_waiting_result"
      : authRequired
        ? "protocol_ok_auth_missing"
        : modelTurnOk
          ? "protocol_and_model_ok"
          : "protocol_ok_model_error",
    broker: {
      base_url: config.brokerBaseUrl,
      device_access_token: authResponse.access_token
    },
    official: {
      path: binary.path,
      version: version.version
    },
    session: {
      session_id: sessionId,
      stream_url: sessionResponse.session?.stream_url || "",
      official_child: officialChild,
      snapshot: sessionSnapshot
    },
    interpretation: {
      protocol_ok: protocolOk,
      model_turn_ok: modelTurnOk,
      auth_required: authRequired,
      note: !lastResult
        ? "Official child 已经启动，但 broker 侧还没有暴露最终 result。"
        : authRequired
          ? "Official child 已经通过 broker contract 连上了，但当前 Claude CLI 还没登录。"
          : modelTurnOk
            ? "Official child 已经通过 broker contract 完成了一次真实回合。"
            : "Official child 已通过 broker contract 连上，但当前回合仍失败。"
    },
    transcript: {
      assistant_texts: assistantTexts,
      result: lastResult,
      denied_tools: sessionSnapshot?.official_child?.denied_tools || []
    },
    child: {
      pid: child.pid,
      exit_code: exitCode,
      exit_signal: exitSignal,
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail
    },
    prompt
  }
}
