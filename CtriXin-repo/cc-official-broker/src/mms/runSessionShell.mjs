import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import readline from "node:readline"
import readlinePromises from "node:readline/promises"

import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import { buildCreateSessionRequest, buildResumeSessionRequest } from "./entryRequests.mjs"
import { inspectSession } from "../session/inspectSession.mjs"
import { runOfficialAttach } from "../official/attachOfficialSession.mjs"
import {
  getLocalSessionRegistryPath,
  loadLastSessionRecord,
  saveLastSessionRecord
} from "../session/localSessionRegistry.mjs"
import { createSocketInbox, waitForOpen } from "../shared/socketClient.mjs"

function printLine(text = "") {
  process.stdout.write(`${text}\n`)
}

function createDefaultSessionId() {
  return `mms-${Date.now().toString(36)}`
}

function isExitCommand(input) {
  return ["/exit", ":q", "exit", "quit"].includes(String(input || "").trim().toLowerCase())
}

function printHelp() {
  printLine("Commands:")
  printLine("  /help       show this help")
  printLine("  /status     inspect current broker session state")
  printLine("  /session    show current session binding")
  printLine("  /official   experimental official attach")
  printLine("  /exit       close the local shell")
  printLine("  /tool ...   run local runner tools")
  printLine("             examples: /tool bash pwd")
  printLine("                       /tool write_file notes/todo.txt -- hello")
  printLine()
}

function normalizeRunMode(input = "create") {
  const value = String(input || "").trim().toLowerCase()
  if (["resume", "resume-last"].includes(value)) {
    return value
  }
  return "create"
}

function isSessionNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes("session not found")
}

function formatUsageSummary(usage = {}) {
  if (!usage || typeof usage !== "object" || usage.supported === false) {
    return ""
  }

  const parts = []
  for (const [label, key] of [
    ["in", "input_tokens"],
    ["out", "output_tokens"],
    ["total", "total_tokens"],
    ["cache_read", "cache_read_tokens"],
    ["cache_write", "cache_write_tokens"]
  ]) {
    const value = usage[key]
    if (value !== undefined && value !== null) {
      parts.push(`${label}=${value}`)
    }
  }

  if (usage.cache_hit === true) {
    parts.push("cache_hit=yes")
  } else if (usage.cache_hit === false) {
    parts.push("cache_hit=no")
  }

  return parts.join(" ")
}

function printRemoteMeta(remoteService) {
  if (!remoteService || typeof remoteService !== "object") {
    return
  }

  const label = remoteService.label || remoteService.base_url || "-"
  const endpoint = remoteService.endpoint || "-"
  const model = remoteService.model || "-"
  const remoteSessionId = remoteService.remote_session_id || "-"
  const responseId = remoteService.response_id || "-"

  printLine(`[remote] ${label} endpoint=${endpoint} model=${model}`)
  printLine(`[remote] session=${remoteSessionId} response=${responseId}`)

  const usage = formatUsageSummary(remoteService.usage || {})
  if (usage) {
    printLine(`[usage] ${usage}`)
  }

  if (remoteService.cost_usd !== undefined && remoteService.cost_usd !== null) {
    printLine(`[usage] cost_usd=${remoteService.cost_usd}`)
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
  const sessionId = overrides.sessionId || createDefaultSessionId()
  const mode = overrides.mode || "create"
  const projectRoot = overrides.projectRoot || config.workspaceRoot || process.cwd()

  const sessionRequest =
    mode === "resume"
      ? buildResumeSessionRequest(config, { ...overrides, sessionId })
      : buildCreateSessionRequest(config, {
          ...overrides,
          clientSessionId: sessionId,
          projectRoot,
          initialGoal: overrides.initialGoal || "start broker session from MMS",
          initialPrompt: overrides.initialPrompt || "start broker session"
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

  return {
    mode,
    sessionId: sessionResponse.session.session_id,
    sessionResponse
  }
}

async function startRunnerChild(config, sessionId, projectRoot) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const indexPath = path.resolve(moduleDir, "../index.mjs")
  const env = {
    ...process.env,
    CC_BROKER_WORKSPACE_ROOT: projectRoot
  }

  const child = spawn(process.execPath, [indexPath, "runner:serve", sessionId, projectRoot], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  })

  let exitCode = null
  let exitSignal = null
  let readyPayload = null
  let stderrTail = ""

  const stdoutReader = readline.createInterface({ input: child.stdout })
  const stderrReader = readline.createInterface({ input: child.stderr })

  const ready = new Promise((resolve, reject) => {
    const rejectWithExit = message => {
      reject(new Error(message))
    }

    stdoutReader.on("line", line => {
      let payload = null
      try {
        payload = JSON.parse(line)
      } catch {
        return
      }

      if (payload.type === "runner.service.ready") {
        readyPayload = payload
        resolve(payload)
        return
      }

      if (payload.type === "runner.tool.executed") {
        const status = payload.ok ? "ok" : "failed"
        printLine(`[runner] ${payload.tool_name} ${status}`)
      }
    })

    stderrReader.on("line", line => {
      stderrTail = line || stderrTail
    })

    child.once("error", error => {
      reject(error)
    })

    child.once("exit", (code, signal) => {
      exitCode = code
      exitSignal = signal
      if (!readyPayload) {
        const extra = stderrTail ? `: ${stderrTail}` : ""
        rejectWithExit(`runner child exited before ready (${code ?? signal ?? "unknown"})${extra}`)
      }
    })
  })

  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }

    child.kill("SIGTERM")
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL")
        }
      }, 1000)

      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  return {
    ready,
    stop,
    state() {
      return {
        exitCode,
        exitSignal,
        readyPayload
      }
    }
  }
}

function printBanner({ config, mode, sessionId, runnerKey, projectRoot }) {
  printLine()
  printLine("Claude Code Remote Ready")
  printLine(`- workspace: ${config.deviceId}/${config.workspaceId}`)
  printLine(`- session: ${sessionId}`)
  if (config.remoteServiceBaseUrl) {
    printLine(`- remote: ${config.remoteServiceLabel || config.remoteServiceBaseUrl}`)
  }
  printLine(`- local tools: ${config.runnerTools?.join(", ") || "none"}`)
  printLine(`- writable scope: ${config.runnerWritableScope || "none"}`)
  printLine(`- hint: /help`)
  printLine()
}

function printSessionBinding({ sessionId, runnerKey, projectRoot, rememberedSession, config }) {
  printLine("[session]")
  printLine(`  session_id: ${sessionId}`)
  printLine(`  runner_key: ${runnerKey}`)
  printLine(`  project_root: ${projectRoot}`)
  printLine(`  local_state: ${getLocalSessionRegistryPath(config)}`)
  printLine(`  remembered_session: ${rememberedSession?.session_id || "-"}`)
  printLine()
}

async function printStatus(config, sessionId, projectRoot) {
  const result = await inspectSession(config, { sessionId })
  if (!result.ok) {
    printLine("[status] failed")
    return
  }

  const session = result.session || {}
  const remote = result.remote_session_state?.session || {}
  const rememberedSession = await loadLastSessionRecord(config, { projectRoot })
  printLine("[status]")
  printLine(`  status: ${session.status || "-"}`)
  printLine(`  stream_connected: ${session.stream_connected ? "yes" : "no"}`)
  printLine(`  runner_attached: ${session.runner_attached ? "yes" : "no"}`)
  printLine(`  active_tool_call: ${session.active_tool_call?.name || "-"}`)
  printLine(`  remembered_session: ${rememberedSession?.session_id || "-"}`)
  printLine(`  remote_session_id: ${session.remote_service?.remote_session_id || remote.remote_session_id || "-"}`)
  printLine(`  remote_response_id: ${session.remote_service?.response_id || "-"}`)
  printLine(`  remote_summary_items: ${remote.session_summary_items ?? "-"}`)
  printLine(`  usage: ${formatUsageSummary(session.remote_service?.usage || {}) || "-"}`)
  printLine(`  cost_usd: ${session.remote_service?.cost_usd ?? "-"}`)
  printLine(`  official_contract_ready: ${session.official_child ? "yes" : "no"}`)
  printLine(`  official_connected: ${session.official_child?.connected ? "yes" : "no"}`)
  printLine(`  official_initialized: ${session.official_child?.initialized ? "yes" : "no"}`)
  printLine(`  official_last_text: ${session.official_child?.last_assistant_text || "-"}`)
  printLine(`  official_result: ${session.official_child?.last_result?.result || "-"}`)
  printLine(`  last_input: ${session.last_input_preview || "-"}`)
  printLine(`  last_output: ${session.last_output_preview || "-"}`)
  printLine()
}

export async function runSessionShell(config, overrides = {}) {
  if (!config.brokerBaseUrl) {
    throw new Error("CC_BROKER_BASE_URL is required")
  }
  if (!config.deviceKey) {
    throw new Error("CC_BROKER_DEVICE_KEY is required")
  }

  const projectRoot = overrides.projectRoot || config.workspaceRoot || process.cwd()
  const runMode = normalizeRunMode(overrides.mode || "create")
  const rememberedSession = await loadLastSessionRecord(config, { projectRoot })
  let sessionId = overrides.sessionId || ""
  let sessionMode = runMode === "resume-last" ? "resume" : runMode

  if (runMode === "resume-last") {
    if (sessionId) {
      throw new Error("resume-last does not accept an explicit sessionId")
    }
    if (rememberedSession?.session_id) {
      sessionId = rememberedSession.session_id
    } else {
      sessionMode = "create"
    }
  }

  if (sessionMode === "resume" && !sessionId && rememberedSession?.session_id) {
    sessionId = rememberedSession.session_id
  }
  if (!sessionId) {
    sessionId = createDefaultSessionId()
  }

  const authResponse = await authenticateDevice(config, overrides)
  let sessionStart
  let resumedFromRememberedSession =
    sessionMode === "resume" &&
    !overrides.sessionId &&
    sessionId &&
    sessionId === rememberedSession?.session_id

  try {
    sessionStart = await createOrResumeSession(config, authResponse, {
      ...overrides,
      projectRoot,
      mode: sessionMode,
      sessionId
    })
  } catch (error) {
    if (resumedFromRememberedSession && isSessionNotFoundError(error)) {
      printLine("[resume-last] remembered session was not found on broker; creating a new session instead.")
      printLine()
      sessionMode = "create"
      sessionId = createDefaultSessionId()
      resumedFromRememberedSession = false
      sessionStart = await createOrResumeSession(config, authResponse, {
        ...overrides,
        projectRoot,
        mode: sessionMode,
        sessionId
      })
    } else {
      throw error
    }
  }
  const runner = await startRunnerChild(config, sessionStart.sessionId, projectRoot)

  let streamSocket = null
  let shell = null

  try {
    await runner.ready

    streamSocket = new WebSocket(
      `${sessionStart.sessionResponse.session.stream_url}?access_token=${authResponse.access_token}`
    )
    const streamInbox = createSocketInbox(streamSocket)
    await waitForOpen(streamSocket)
    await streamInbox.next(message => message.type === "session.ready")

    await saveLastSessionRecord(config, {
      projectRoot,
      sessionId: sessionStart.sessionId,
      runnerKey: sessionStart.sessionResponse.session.attached_runner_key,
      brokerBaseUrl: config.brokerBaseUrl,
      remoteService: sessionStart.sessionResponse.session.remote_service || rememberedSession?.remote_service || null
    })
    const activeRememberedSession = await loadLastSessionRecord(config, { projectRoot })

    printBanner({
      config,
      mode: sessionStart.mode,
      sessionId: sessionStart.sessionId,
      runnerKey: sessionStart.sessionResponse.session.attached_runner_key,
      projectRoot
    })
    if (runMode === "resume-last" && !rememberedSession?.session_id) {
      printLine("[resume-last] no remembered session was found for this device/workspace/project yet; created a new one.")
      printLine()
    }

    shell = readlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })

    while (true) {
      let input = ""
      try {
        input = (await shell.question("> ")).trim()
      } catch (error) {
        if (error instanceof Error && error.message === "readline was closed") {
          break
        }
        throw error
      }
      if (!input) {
        continue
      }

      if (isExitCommand(input)) {
        break
      }

      if (input === "/help") {
        printHelp()
        continue
      }

      if (input === "/status") {
        await printStatus(config, sessionStart.sessionId, projectRoot)
        continue
      }

      if (input === "/official" || input.startsWith("/official ")) {
        const officialPrompt = input === "/official" ? "" : input.slice("/official".length).trim()
        printLine()
        printLine("[official] attaching real local Claude child...")
        try {
          const attachResult = await runOfficialAttach(config, {
            mode: "resume",
            sessionId: sessionStart.sessionId,
            projectRoot,
            prompt: officialPrompt || undefined
          })
          printLine(`[official] status: ${attachResult.status}`)
          if (attachResult.transcript?.assistant_texts?.length) {
            printLine(`[official] assistant: ${attachResult.transcript.assistant_texts.join(" | ")}`)
          }
          if (attachResult.transcript?.result?.result) {
            printLine(`[official] result: ${attachResult.transcript.result.result}`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          printLine(`[official] failed: ${message}`)
          if (message.includes("official_child.sdk_url + access_token")) {
            printLine("[official] hint: 当前这个 broker backend 还没升级到新的 official child contract。")
            printLine("[official] hint: 也就是说，本地 shell 已支持 /official，但你连到的 broker /sessions 仍然只返回旧 session shape。")
          }
        }
        printLine()
        continue
      }

      if (input === "/session") {
        const currentRememberedSession = await loadLastSessionRecord(config, { projectRoot })
        printSessionBinding({
          sessionId: sessionStart.sessionId,
          runnerKey: sessionStart.sessionResponse.session.attached_runner_key,
          projectRoot,
          rememberedSession: currentRememberedSession,
          config
        })
        continue
      }

      streamSocket.send(
        JSON.stringify({
          type: "session.input",
          payload: {
            text: input
          }
        })
      )

      await streamInbox.next(message => message.type === "session.input.ack")
      const streamOutput = await streamInbox.next(message => message.type === "session.output")
      const output = String(streamOutput.payload?.output || "").trim() || "(empty output)"
      const remembered = await loadLastSessionRecord(config, { projectRoot })
      const eventRemoteService = streamOutput.payload?.remote_service || null
      const remoteService = eventRemoteService || remembered?.remote_service || null

      await saveLastSessionRecord(config, {
        projectRoot,
        sessionId: sessionStart.sessionId,
        runnerKey: sessionStart.sessionResponse.session.attached_runner_key,
        brokerBaseUrl: config.brokerBaseUrl,
        remoteService
      })

      printLine()
      printLine(output)
      if (eventRemoteService) {
        printLine()
        printRemoteMeta(eventRemoteService)
      }
      printLine()
    }

    printLine("Closing broker session shell.")
  } finally {
    if (shell) {
      shell.close()
    }
    if (streamSocket && streamSocket.readyState === WebSocket.OPEN) {
      streamSocket.close()
    }
    await runner.stop()
  }
}
