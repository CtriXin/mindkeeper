import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import { startBrokerStub } from "../broker/stubServer.mjs"
import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import { buildCreateSessionRequest } from "../mms/entryRequests.mjs"
import {
  buildOfficialHeadlessLaunchPlan,
  getClaudeVersion,
  resolveClaudeBinary
} from "./claudeBinary.mjs"

function defaultPrompt() {
  return "Reply with exactly BROKER_OFFICIAL_OK and nothing else. Do not use tools."
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

async function ensureWorkspace(baseRoot) {
  const workspaceRoot = path.join(baseRoot, "tmp", "official-broker-workspace")
  await mkdir(workspaceRoot, { recursive: true })
  return workspaceRoot
}

async function waitForOfficialResult(state, sessionId, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const session = state.sessions.get(sessionId)
    if (session?.officialChild?.lastResult) {
      return session
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  throw new Error(`official broker demo timed out after ${timeoutMs}ms`)
}

export async function runOfficialBrokerDemo(config, overrides = {}) {
  const prompt = overrides.prompt || defaultPrompt()
  const binary = resolveClaudeBinary()
  if (!binary.ok) {
    throw new Error(binary.error || "official claude binary not found")
  }

  const version = getClaudeVersion(binary.path)
  if (!version.ok) {
    throw new Error(version.error || "failed to read official claude version")
  }

  const workspaceRoot = overrides.workspaceRoot || (await ensureWorkspace(config.workspaceRoot || process.cwd()))
  const broker = await startBrokerStub({
    host: overrides.host || "127.0.0.1",
    port: 0,
    config: {
      ...config,
      workspaceRoot
    }
  })

  const demoConfig = {
    ...config,
    brokerBaseUrl: broker.baseUrl,
    deviceKey: overrides.deviceKey || config.deviceKey || "demo-device-key",
    workspaceRoot
  }

  const sessionId = overrides.sessionId || `session_local_${Date.now().toString(36)}`
  const authResponse = await fetch(`${broker.baseUrl}/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDeviceAuthPayload(demoConfig, overrides))
  }).then(response => response.json())

  if (!authResponse.ok) {
    await broker.close().catch(() => {})
    throw new Error(authResponse.error || "device auth failed")
  }

  const sessionRequest = buildCreateSessionRequest(demoConfig, {
    ...overrides,
    clientSessionId: sessionId,
    projectRoot: workspaceRoot,
    initialGoal: overrides.initialGoal || "official broker smoke test",
    initialPrompt: prompt
  })

  const sessionResponse = await fetch(`${broker.baseUrl}/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authResponse.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(sessionRequest)
  }).then(response => response.json())

  if (!sessionResponse.ok) {
    await broker.close().catch(() => {})
    throw new Error(sessionResponse.error || "session create failed")
  }

  const officialChild = sessionResponse.official_child
  if (!officialChild?.sdk_url || !officialChild?.access_token) {
    await broker.close().catch(() => {})
    throw new Error("broker did not return an official child launch contract")
  }

  const launch = buildOfficialHeadlessLaunchPlan({
    binaryPath: binary.path,
    sessionId,
    sdkUrl: officialChild.sdk_url,
    accessToken: officialChild.access_token,
    workingDir: workspaceRoot,
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

  let finalSession = null
  try {
    finalSession = await waitForOfficialResult(broker.state, sessionId, overrides.timeoutMs || 90000)
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
    await broker.close().catch(() => {})
  }

  const protocolOk = Boolean(
    finalSession?.officialChild?.initializeAck &&
      finalSession?.officialChild?.replayedUserMessage &&
      finalSession?.officialChild?.lastResult
  )
  const authRequired =
    finalSession?.officialChild?.lastResult?.is_error === true &&
    /not logged in/i.test(String(finalSession?.officialChild?.lastResult?.result || ""))
  const modelTurnOk = Boolean(finalSession?.officialChild?.lastResult && !finalSession.officialChild.lastResult.is_error)

  return {
    ok: protocolOk,
    status: authRequired
      ? "protocol_ok_auth_missing"
      : modelTurnOk
        ? "protocol_and_model_ok"
        : "protocol_ok_model_error",
    broker: {
      base_url: broker.baseUrl,
      ws_base_url: broker.wsBaseUrl,
      device_access_token: authResponse.access_token
    },
    official: {
      path: binary.path,
      version: version.version
    },
    session: {
      session_id: sessionId,
      stream_url: sessionResponse.session?.stream_url || "",
      official_child: officialChild
    },
    interpretation: {
      protocol_ok: protocolOk,
      model_turn_ok: modelTurnOk,
      auth_required: authRequired,
      note: authRequired
        ? "Broker 已经能把真实 official child 接到自己的 session-ingress stub 上，但这台机器的 local Claude CLI 还没登录。"
        : modelTurnOk
          ? "Broker 的 session create -> official child launch -> session-ingress result 这条链路已经跑通。"
          : "Broker 和 official child 的最小链路已通，但模型回合仍然失败。"
    },
    transcript: {
      replayed_user_message: finalSession?.officialChild?.replayedUserMessage?.message?.content || "",
      assistant_texts: finalSession?.officialChild?.assistantTexts || [],
      result: finalSession?.officialChild?.lastResult || null,
      denied_tools: finalSession?.officialChild?.deniedTools || []
    },
    child: {
      pid: child.pid,
      exit_code: exitCode,
      exit_signal: exitSignal,
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail
    },
    prompt,
    request_id: randomUUID()
  }
}
