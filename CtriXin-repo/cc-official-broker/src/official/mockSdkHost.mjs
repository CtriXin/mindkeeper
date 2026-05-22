import { randomUUID, createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import http from "node:http"
import path from "node:path"

import {
  buildOfficialHeadlessLaunchPlan,
  getClaudeVersion,
  resolveClaudeBinary
} from "./claudeBinary.mjs"

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", chunk => chunks.push(chunk))
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8")
        resolve(text ? JSON.parse(text) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function buildWsAccept(key) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64")
}

function encodeWsFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload))
  const size = data.length

  if (size < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, size]), data])
  }

  if (size < 65536) {
    const header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(size, 2)
    return Buffer.concat([header, data])
  }

  throw new Error("official mock websocket frame too large")
}

function decodeWsFrames(buffer) {
  const frames = []
  let offset = 0

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    const lengthCode = second & 0x7f
    let payloadLength = lengthCode
    let headerLength = 2

    if (lengthCode === 126) {
      if (offset + 4 > buffer.length) break
      payloadLength = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    }

    if (lengthCode === 127) {
      throw new Error("official mock does not support 64-bit websocket frames")
    }

    const maskLength = masked ? 4 : 0
    if (offset + headerLength + maskLength + payloadLength > buffer.length) {
      break
    }

    const payload = Buffer.from(
      buffer.subarray(offset + headerLength + maskLength, offset + headerLength + maskLength + payloadLength)
    )

    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4)
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4]
      }
    }

    frames.push({
      opcode,
      payload
    })
    offset += headerLength + maskLength + payloadLength
  }

  return {
    frames,
    remaining: buffer.subarray(offset)
  }
}

function createInitializeRequest(requestId) {
  return {
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "initialize",
      promptSuggestions: false,
      agentProgressSummaries: false,
      systemPrompt:
        "You are running inside an official Claude Code SDK smoke test. Reply directly to the next user message. Do not use any tools."
    }
  }
}

function createUserMessage({ sessionId, prompt }) {
  return {
    type: "user",
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: prompt
    }
  }
}

function createControlResponse({ requestId, response, error }) {
  return {
    type: "control_response",
    response: error
      ? {
          subtype: "error",
          request_id: requestId,
          error
        }
      : {
          subtype: "success",
          request_id: requestId,
          response
        }
  }
}

function createPermissionDenyResponse(requestId, toolUseId) {
  return createControlResponse({
    requestId,
    response: {
      behavior: "deny",
      message: "official mock host denies all tool calls in this smoke test",
      toolUseID: toolUseId
    }
  })
}

function defaultPrompt() {
  return "Reply with exactly OFFICIAL_SDK_MOCK_OK and nothing else. Do not use tools."
}

function summarizeAssistantText(message) {
  if (message.type === "streamlined_text") {
    return String(message.text || "").trim()
  }
  if (message.type !== "assistant") {
    return ""
  }

  const content = Array.isArray(message.message?.content) ? message.message.content : []
  return content
    .filter(block => block && typeof block === "object" && block.type === "text")
    .map(block => String(block.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
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
  const workspaceRoot = path.join(baseRoot, "tmp", "official-mock-workspace")
  await mkdir(workspaceRoot, { recursive: true })
  return workspaceRoot
}

async function startOfficialMockHost({
  host = "127.0.0.1",
  port = 0,
  sessionId,
  prompt,
  accessToken,
  timeoutMs = 90000
}) {
  const initRequestId = randomUUID()
  const resultDeferred = createDeferred()
  const readyDeferred = createDeferred()
  const state = {
    connected: false,
    sessionId,
    prompt,
    accessToken,
    headers: null,
    initRequestId,
    initializeAck: null,
    result: null,
    userReplay: null,
    assistantTexts: [],
    receivedEvents: [],
    deniedTools: [],
    closeCode: null,
    closeReason: null
  }

  let socket = null
  let upgradeBuffer = Buffer.alloc(0)
  let promptSent = false
  let settled = false

  const settleSuccess = payload => {
    if (settled) return
    settled = true
    resultDeferred.resolve(payload)
  }

  const settleFailure = error => {
    if (settled) return
    settled = true
    resultDeferred.reject(error instanceof Error ? error : new Error(String(error)))
  }

  const sendWsJson = payload => {
    if (!socket || socket.destroyed) {
      throw new Error("official mock websocket is not connected")
    }
    socket.write(encodeWsFrame(`${JSON.stringify(payload)}\n`))
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")

    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, 200, { ok: true, service: "official-sdk-mock-host" })
      return
    }

    if (req.method === "POST" && url.pathname === `/v2/session_ingress/session/${sessionId}/events`) {
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        jsonResponse(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
        return
      }

      const auth = req.headers.authorization || ""
      state.headers = {
        authorization: auth,
        user_agent: req.headers["user-agent"] || ""
      }

      const events = Array.isArray(body.events) ? body.events : []
      state.receivedEvents.push(...events)

      for (const event of events) {
        if (!event || typeof event !== "object") {
          continue
        }

        if (event.type === "control_response" && event.response?.request_id === initRequestId) {
          state.initializeAck = event
          if (event.response?.subtype !== "success") {
            settleFailure(new Error(event.response?.error || "initialize failed"))
            continue
          }

          if (!promptSent) {
            promptSent = true
            sendWsJson(
              createUserMessage({
                sessionId,
                prompt
              })
            )
          }
          continue
        }

        if (event.type === "control_request" && event.request?.subtype === "can_use_tool") {
          state.deniedTools.push({
            tool_name: event.request.tool_name,
            tool_use_id: event.request.tool_use_id
          })
          sendWsJson(createPermissionDenyResponse(event.request_id, event.request.tool_use_id))
          continue
        }

        if (event.type === "user" && event.isReplay === true) {
          state.userReplay = event
          continue
        }

        if (event.type === "assistant" || event.type === "streamlined_text") {
          const text = summarizeAssistantText(event)
          if (text) {
            state.assistantTexts.push(text)
          }
          continue
        }

        if (event.type === "result") {
          state.result = event
          settleSuccess({
            ok: !event.is_error,
            event
          })
        }
      }

      jsonResponse(res, 200, { ok: true, received: events.length })
      return
    }

    jsonResponse(res, 404, { ok: false, error: "not found" })
  })

  server.on("upgrade", (req, upgradeSocket) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    if (url.pathname !== `/v2/session_ingress/ws/${sessionId}`) {
      upgradeSocket.end("HTTP/1.1 404 Not Found\r\n\r\n")
      return
    }

    const wsKey = req.headers["sec-websocket-key"]
    if (!wsKey) {
      upgradeSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
      return
    }

    upgradeSocket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${buildWsAccept(wsKey)}`,
        "\r\n"
      ].join("\r\n")
    )

    socket = upgradeSocket
    state.connected = true
    state.headers = {
      authorization: req.headers.authorization || "",
      user_agent: req.headers["user-agent"] || ""
    }

    upgradeSocket.on("data", chunk => {
      upgradeBuffer = Buffer.concat([upgradeBuffer, chunk])
      const { frames, remaining } = decodeWsFrames(upgradeBuffer)
      upgradeBuffer = remaining

      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          state.closeCode = 1000
          upgradeSocket.end(encodeWsFrame(Buffer.alloc(0), 0x8))
          return
        }
        if (frame.opcode === 0x9) {
          upgradeSocket.write(encodeWsFrame(frame.payload, 0x0a))
        }
      }
    })

    upgradeSocket.on("close", () => {
      if (!settled && !state.result) {
        settleFailure(new Error("official mock websocket closed before result"))
      }
    })

    upgradeSocket.on("error", error => {
      if (!settled) {
        settleFailure(error)
      }
    })

    sendWsJson(createInitializeRequest(initRequestId))
    readyDeferred.resolve()
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    await new Promise(resolve => server.close(resolve))
    throw new Error("official mock host failed to get a listening address")
  }

  const baseUrl = `http://${host}:${address.port}`
  const wsUrl = `ws://${host}:${address.port}/v2/session_ingress/ws/${sessionId}`
  const timeout = setTimeout(() => {
    settleFailure(new Error(`official mock timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  timeout.unref?.()

  return {
    baseUrl,
    wsUrl,
    state,
    async waitForReady() {
      await readyDeferred.promise
    },
    async waitForResult() {
      try {
        return await resultDeferred.promise
      } finally {
        clearTimeout(timeout)
      }
    },
    async close() {
      clearTimeout(timeout)
      if (socket && !socket.destroyed) {
        socket.end()
      }
      await new Promise(resolve => server.close(resolve))
    }
  }
}

export async function runOfficialMockDemo(config, overrides = {}) {
  const prompt = overrides.prompt || defaultPrompt()
  const binary = resolveClaudeBinary()
  if (!binary.ok) {
    throw new Error(binary.error || "official claude binary not found")
  }

  const version = getClaudeVersion(binary.path)
  if (!version.ok) {
    throw new Error(version.error || "failed to read official claude version")
  }

  const sessionId = overrides.sessionId || `session_local_${Date.now().toString(36)}`
  const accessToken = overrides.accessToken || `mock-token-${randomUUID()}`
  const workspaceRoot = overrides.workspaceRoot || (await ensureWorkspace(config.workspaceRoot || process.cwd()))
  const mockHost = await startOfficialMockHost({
    sessionId,
    prompt,
    accessToken,
    timeoutMs: overrides.timeoutMs || 90000
  })

  const launch = buildOfficialHeadlessLaunchPlan({
    binaryPath: binary.path,
    sessionId,
    sdkUrl: mockHost.wsUrl,
    accessToken,
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

  try {
    await mockHost.waitForReady()
    await mockHost.waitForResult()
  } finally {
    await mockHost.close().catch(() => {})
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

  const protocolOk = Boolean(
    mockHost.state.initializeAck && mockHost.state.userReplay && mockHost.state.result
  )
  const authRequired =
    mockHost.state.result?.is_error === true &&
    /not logged in/i.test(String(mockHost.state.result?.result || ""))
  const modelTurnOk = Boolean(mockHost.state.result && !mockHost.state.result.is_error)

  return {
    ok: protocolOk,
    status: authRequired
      ? "protocol_ok_auth_missing"
      : modelTurnOk
        ? "protocol_and_model_ok"
        : "protocol_ok_model_error",
    official: {
      path: binary.path,
      version: version.version
    },
    workspace_root: workspaceRoot,
    mock_host: {
      base_url: mockHost.baseUrl,
      ws_url: mockHost.wsUrl,
      session_id: sessionId,
      auth_header_present: Boolean(mockHost.state.headers?.authorization),
      initialized: Boolean(mockHost.state.initializeAck)
    },
    interpretation: {
      protocol_ok: protocolOk,
      model_turn_ok: modelTurnOk,
      auth_required: authRequired,
      note: authRequired
        ? "The official child connected and replayed the user turn successfully, but the local Claude CLI is not logged in yet."
        : modelTurnOk
          ? "The official child connected and completed a real model turn through the mock host."
          : "The official child connected, but the model turn still failed for a reason other than login."
    },
    transcript: {
      replayed_user_message: mockHost.state.userReplay?.message?.content || "",
      assistant_texts: mockHost.state.assistantTexts,
      result: mockHost.state.result,
      denied_tools: mockHost.state.deniedTools
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
