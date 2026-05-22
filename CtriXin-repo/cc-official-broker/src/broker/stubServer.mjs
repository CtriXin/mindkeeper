import { createHash, randomUUID } from "node:crypto"
import http from "node:http"

import {
  fetchRemoteSessionState,
  hasRemoteService,
  promptRemoteService
} from "./remoteServiceClient.mjs"
import { buildOfficialHeadlessLaunchPlan } from "../official/claudeBinary.mjs"
import { buildToolCallMessage } from "../contracts/toolProtocol.mjs"
import { buildRoutingFields, toWireRouting } from "../shared/sessionKeys.mjs"
import { createRequestMeta } from "../shared/wireMeta.mjs"
import { parseToolPrompt } from "../runner/toolExecutor.mjs"

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

function buildWsAccept(key) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64")
}

function encodeWsFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
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

  throw new Error("stub websocket frame too large")
}

function decodeIngressWsFrames(buffer) {
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
      throw new Error("stub ingress does not support 64-bit websocket frames")
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

function decodeWsFrames(buffer) {
  const messages = []
  let offset = 0

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    const lengthCode = second & 0x7f
    let payloadLength = lengthCode
    let headerLength = 2

    if (opcode === 0x8) {
      return { messages, remaining: Buffer.alloc(0), closed: true }
    }

    if (lengthCode === 126) {
      if (offset + 4 > buffer.length) break
      payloadLength = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    }

    if (!masked) {
      throw new Error("unsupported websocket frame")
    }

    if (offset + headerLength + 4 + payloadLength > buffer.length) {
      break
    }

    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4)
    const payload = Buffer.from(
      buffer.subarray(offset + headerLength + 4, offset + headerLength + 4 + payloadLength)
    )

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4]
    }

    messages.push(payload.toString("utf8"))
    offset += headerLength + 4 + payloadLength
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
    closed: false
  }
}

function bearerFromRequest(req) {
  const auth = req.headers.authorization || ""
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length)
  }

  const url = new URL(req.url || "/", "http://127.0.0.1")
  return url.searchParams.get("access_token") || ""
}

function previewText(input = "", limit = 120) {
  const text = String(input || "").trim()
  if (!text) {
    return ""
  }
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}...`
}

function tailList(values = [], value, limit = 20) {
  const next = Array.isArray(values) ? [...values] : []
  next.push(value)
  if (next.length > limit) {
    next.splice(0, next.length - limit)
  }
  return next
}

function createSessionIngressInitializeRequest(requestId) {
  return {
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "initialize",
      promptSuggestions: false,
      agentProgressSummaries: false,
      systemPrompt:
        "You are running inside a broker session-ingress smoke test. Reply directly to the next user message. Do not use any tools."
    }
  }
}

function createSessionIngressReplayUserMessage({ sessionId, prompt }) {
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

function createSessionIngressControlResponse({ requestId, response, error }) {
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

function createSessionIngressPermissionDenyResponse(requestId, toolUseId) {
  return createSessionIngressControlResponse({
    requestId,
    response: {
      behavior: "deny",
      message: "broker stub denies all tool calls in this official child smoke path",
      toolUseID: toolUseId
    }
  })
}

function summarizeIngressAssistantText(message) {
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

function buildSessionIngressContract({ baseUrl, wsBaseUrl, sessionId, accessToken, workingDir }) {
  const sdkUrl = `${wsBaseUrl}/v2/session_ingress/ws/${sessionId}`
  return {
    mode: "session-ingress-v2",
    sdk_url: sdkUrl,
    post_events_url: `${baseUrl}/v2/session_ingress/session/${sessionId}/events`,
    access_token: accessToken,
    sample_launch: buildOfficialHeadlessLaunchPlan({
      binaryPath: "claude",
      sessionId,
      sdkUrl,
      accessToken,
      workingDir,
      useCcrV2: false
    })
  }
}

function isDirectConnectCreateRequest(body) {
  return Boolean(body && typeof body === "object" && !body.session?.mode && typeof body.cwd === "string")
}

function buildDirectConnectAuthContext({ state, config, token }) {
  if (!token) {
    return null
  }

  if (state.tokens.has(token)) {
    const tokenContext = state.tokens.get(token)
    return {
      mode: "access_token",
      runnerKey: tokenContext.runnerKey || `direct-${config.deviceId}-${config.workspaceId}`,
      routing: tokenContext.routing || {}
    }
  }

  if (config.deviceKey && token === config.deviceKey) {
    return {
      mode: "device_key",
      runnerKey: `direct-${config.deviceId}-${config.workspaceId}`,
      routing: toWireRouting(
        buildRoutingFields({
          ownerUserId: config.ownerUserId,
          deviceId: config.deviceId,
          workspaceId: config.workspaceId,
          sessionId: "pending"
        })
      )
    }
  }

  return null
}

function extractDirectConnectInputText(payload = {}) {
  const content = payload.message?.content
  if (typeof content === "string") {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map(block => {
      if (!block) {
        return ""
      }
      if (typeof block === "string") {
        return block
      }
      if (block.type === "text") {
        return String(block.text || "")
      }
      return ""
    })
    .join("\n")
    .trim()
}

function buildDirectConnectInitMessage({ sessionId, cwd, model }) {
  return {
    type: "system",
    subtype: "init",
    agents: [],
    apiKeySource: "oauth",
    betas: [],
    claude_code_version: "2.1.92",
    cwd,
    tools: [],
    mcp_servers: [],
    model: model || "claude-opus-4-6",
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: randomUUID(),
    session_id: sessionId
  }
}

function buildDirectConnectAssistantMessage({ sessionId, text }) {
  return {
    type: "assistant",
    message: {
      id: `msg_${randomUUID()}`,
      role: "assistant",
      content: [
        {
          type: "text",
          text
        }
      ]
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId
  }
}

function buildDirectConnectResultMessage({ sessionId, output, isError = false, errorMessage = "" }) {
  return isError
    ? {
        type: "result",
        subtype: "error_during_execution",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: true,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        errors: [errorMessage || "direct connect request failed"],
        uuid: randomUUID(),
        session_id: sessionId
      }
    : {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result: output,
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: randomUUID(),
        session_id: sessionId
      }
}

function buildDirectConnectMockOutput(input) {
  const text = String(input || "").trim()
  if (!text) {
    return "BROKER_DIRECT_CONNECT_OK"
  }
  return `BROKER_DIRECT_CONNECT_MOCK: ${text}`
}

async function handleDirectConnectTurn({ state, config, sessionId, socket, input }) {
  const session = state.sessions.get(sessionId)
  if (!session) {
    return
  }

  const prompt = String(input || "").trim() || "hello"
  updateSession(state, sessionId, current => ({
    ...current,
    status: "direct_connect_requesting",
    lastInputAt: new Date().toISOString(),
    lastInputPreview: previewText(prompt)
  }))

  const directRouting = toWireRouting(
    buildRoutingFields({
      ownerUserId: session.routing.owner_user_id || config.ownerUserId,
      deviceId: session.routing.device_id || config.deviceId,
      workspaceId: session.routing.workspace_id || config.workspaceId,
      sessionId
    })
  )

  try {
    let output = ""
    let remoteService = session.remoteService || null

    if (hasRemoteService(config)) {
      const remoteResult = await promptRemoteService({
        config,
        routing: directRouting,
        input: prompt,
        previousResponseId: session.directConnect?.previousResponseId || ""
      })
      output = remoteResult.output || ""
      remoteService = {
        enabled: true,
        label: config.remoteServiceLabel || "",
        base_url: config.remoteServiceBaseUrl || "",
        endpoint: remoteResult.endpoint,
        model: config.remoteServiceModel || "",
        response_id: remoteResult.responseId || "",
        previous_response_id: remoteResult.previousResponseId || "",
        remote_session_id: remoteResult.remoteSessionId || "",
        reused_remote_session: remoteResult.reusedRemoteSession,
        usage: remoteResult.usage || null,
        cost_usd: remoteResult.costUsd
      }
      state.events.push({
        type: "direct_connect.remote.prompt",
        sessionId,
        runnerKey: session.runnerKey,
        endpoint: remoteResult.endpoint,
        reusedRemoteSession: remoteResult.reusedRemoteSession
      })
    } else {
      output = buildDirectConnectMockOutput(prompt)
      state.events.push({
        type: "direct_connect.mock.prompt",
        sessionId,
        runnerKey: session.runnerKey
      })
    }

    const assistantMessage = buildDirectConnectAssistantMessage({
      sessionId,
      text: output
    })
    const resultMessage = buildDirectConnectResultMessage({
      sessionId,
      output
    })

    socket.write(encodeWsFrame(`${JSON.stringify(assistantMessage)}\n`))
    socket.write(encodeWsFrame(`${JSON.stringify(resultMessage)}\n`))

    updateSession(state, sessionId, current => ({
      ...current,
      status: "idle",
      remoteService,
      directConnect: {
        ...(current.directConnect || {}),
        previousResponseId: remoteService?.response_id || current.directConnect?.previousResponseId || "",
        turnCount: (current.directConnect?.turnCount || 0) + 1
      },
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(output)
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    socket.write(
      encodeWsFrame(
        `${JSON.stringify(
          buildDirectConnectResultMessage({
            sessionId,
            output: "",
            isError: true,
            errorMessage: message
          })
        )}\n`
      )
    )
    updateSession(state, sessionId, current => ({
      ...current,
      status: "direct_connect_error",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(message)
    }))
    state.events.push({
      type: "direct_connect.prompt.error",
      sessionId,
      runnerKey: session.runnerKey,
      error: message
    })
  }
}

function updateSession(state, sessionId, updater) {
  const existing = state.sessions.get(sessionId)
  if (!existing) {
    return null
  }

  const next = updater(existing) || existing
  next.updatedAt = new Date().toISOString()
  state.sessions.set(sessionId, next)
  return next
}

function buildSessionStatusSnapshot(state, session) {
  const runnerConnection = findRunnerConnection(state, session.runnerKey)
  const hasStream = Array.from(state.streamConnections.values()).some(
    connection => connection.sessionId === session.sessionId
  )
  const pendingToolCall = Array.from(state.pendingToolCalls.entries()).find(
    ([, pending]) => pending.sessionId === session.sessionId
  )

  return {
    session_id: session.sessionId,
    runner_key: session.runnerKey,
    status: session.status || "created",
    mode: session.mode,
    created_at: session.createdAt || session.updatedAt,
    updated_at: session.updatedAt,
    stream_connected: hasStream,
    runner_attached: Boolean(runnerConnection),
    runner_capability: runnerConnection
      ? {
          tools: runnerConnection.tools || [],
          writable_scope: runnerConnection.writableScope || "none",
          workspace_root: runnerConnection.workspaceRoot || null
        }
      : null,
    active_tool_call: pendingToolCall
      ? {
          id: pendingToolCall[0],
          name: pendingToolCall[1].toolName
        }
      : null,
    project_root: session.projectRoot || null,
    remote_service: session.remoteService || null,
    official_child: session.officialChild
      ? {
          mode: session.officialChild.mode,
          connected: Boolean(session.officialChild.connected),
          initialized: Boolean(session.officialChild.initialized),
          auth_header_present: Boolean(session.officialChild.authHeaderPresent),
          assistant_text_count: Array.isArray(session.officialChild.assistantTexts)
            ? session.officialChild.assistantTexts.length
            : 0,
          assistant_texts: session.officialChild.assistantTexts || [],
          last_assistant_text:
            Array.isArray(session.officialChild.assistantTexts) && session.officialChild.assistantTexts.length
              ? session.officialChild.assistantTexts[session.officialChild.assistantTexts.length - 1]
              : "",
          denied_tools: session.officialChild.deniedTools || [],
          received_event_types: session.officialChild.receivedEventTypes || [],
          last_result: session.officialChild.lastResult || null
        }
      : null,
    direct_connect: session.directConnect
      ? {
          connected: Boolean(session.directConnect.connected),
          auth_mode: session.directConnect.authMode || "",
          turn_count: session.directConnect.turnCount || 0,
          previous_response_id: session.directConnect.previousResponseId || ""
        }
      : null,
    last_input_at: session.lastInputAt || null,
    last_input_preview: session.lastInputPreview || null,
    last_output_at: session.lastOutputAt || null,
    last_output_preview: session.lastOutputPreview || null
  }
}

function buildSessionResponse({ mode, sessionId, runnerKey, requestId, streamUrl, officialChild, existed }) {
  return {
    ok: true,
    mode,
    session: {
      session_id: sessionId,
      status: mode === "resume" ? "resumed" : "created",
      attached_runner_key: runnerKey,
      stream_url: streamUrl
    },
    meta: {
      request_id: requestId,
      reused_session: Boolean(existed && mode === "resume")
    },
    official_child: officialChild || null
  }
}

function buildHeartbeatAck(message) {
  return {
    type: "runner.heartbeat.ack",
    ok: true,
    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
    payload: {
      routing: message.payload?.routing || {},
      health: message.payload?.health || {}
    }
  }
}

function buildToolResultAck(message) {
  return {
    type: "tool.result.ack",
    ok: true,
    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
    payload: {
      routing: message.payload?.routing || {},
      tool_call: message.payload?.tool_call || {}
    }
  }
}

function buildSessionReadyEvent({ sessionId, runnerKey }) {
  return {
    type: "session.ready",
    ok: true,
    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
    payload: {
      session_id: sessionId,
      runner_key: runnerKey,
      status: "attached"
    }
  }
}

function buildSessionInputAck(message, sessionId) {
  return {
    type: "session.input.ack",
    ok: true,
    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
    payload: {
      session_id: sessionId,
      accepted: true,
      input: message.payload?.text || ""
    }
  }
}

function buildSessionOutputEvent(message, sessionId, runnerKey) {
  const input = String(message.payload?.text || "").trim() || "start broker session"

  return {
    type: "session.output",
    ok: true,
    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
    payload: {
      session_id: sessionId,
      runner_key: runnerKey,
      output: `stub remote cc received: ${input}`,
      note: "This is a local broker stream stub, not the final remote official cc output"
    }
  }
}

function buildToolRoutedOutputEvent({
  sessionId,
  runnerKey,
  toolName,
  toolCallId,
  result,
  note = "Tool result returned from local runner through broker stub"
}) {
  const header = result?.ok ? `tool ${toolName} ok` : `tool ${toolName} failed`
  const content = String(result?.content || result?.error || "(empty)").trim()

  return {
    type: "session.output",
    ok: Boolean(result?.ok),
    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
    payload: {
      session_id: sessionId,
      runner_key: runnerKey,
      output: `${header}\n${content}`,
      tool: {
        id: toolCallId,
        name: toolName,
        ok: Boolean(result?.ok)
      },
      note
    }
  }
}

function rejectPendingToolCalls(state, matcher, errorMessage) {
  for (const [toolCallId, pending] of state.pendingToolCalls.entries()) {
    if (!matcher(pending)) {
      continue
    }

    clearTimeout(pending.timeout)
    state.pendingToolCalls.delete(toolCallId)
    pending.reject(new Error(errorMessage))
  }
}

function waitForToolResult(state, { toolCallId, sessionId, runnerKey, runnerConnectionId, toolName, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pendingToolCalls.delete(toolCallId)
      reject(new Error(`tool call timeout: ${toolName}`))
    }, timeoutMs)

    state.pendingToolCalls.set(toolCallId, {
      sessionId,
      runnerKey,
      runnerConnectionId,
      toolName,
      timeout,
      resolve: payload => {
        clearTimeout(timeout)
        state.pendingToolCalls.delete(toolCallId)
        resolve(payload)
      },
      reject: error => {
        clearTimeout(timeout)
        state.pendingToolCalls.delete(toolCallId)
        reject(error)
      }
    })
  })
}

function resolveToolResult(state, message) {
  const toolCallId = message.payload?.tool_call?.id
  if (!toolCallId || !state.pendingToolCalls.has(toolCallId)) {
    return false
  }

  const pending = state.pendingToolCalls.get(toolCallId)
  pending.resolve({
    toolCallId,
    toolName: message.payload?.tool_call?.name || pending.toolName,
    result: message.payload?.result || {}
  })
  return true
}

function enqueueSessionWork(state, sessionId, task) {
  const previous = state.sessionWork.get(sessionId) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  state.sessionWork.set(sessionId, current)
  current.finally(() => {
    if (state.sessionWork.get(sessionId) === current) {
      state.sessionWork.delete(sessionId)
    }
  })
  return current
}

function findRunnerConnection(state, runnerKey) {
  for (const [connectionId, connection] of state.runnerConnections.entries()) {
    if (connection.runnerKey === runnerKey) {
      return { connectionId, ...connection }
    }
  }
  return null
}

async function routeToolCall({ state, session, sessionSocket, message }) {
  const parsedTool = parseToolPrompt(message.payload?.text || "")
  if (!parsedTool) {
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "idle",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(`stub remote cc received: ${message.payload?.text || ""}`)
    }))
    sessionSocket.write(encodeWsFrame(JSON.stringify(buildSessionOutputEvent(message, session.sessionId, session.runnerKey))))
    return
  }

  const runnerConnection = findRunnerConnection(state, session.runnerKey)
  if (!runnerConnection?.socket) {
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "waiting_runner",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(`runner is not attached for ${session.runnerKey}`)
    }))
    sessionSocket.write(
      encodeWsFrame(
        JSON.stringify(
          buildToolRoutedOutputEvent({
            sessionId: session.sessionId,
            runnerKey: session.runnerKey,
            toolCallId: "missing-runner",
            toolName: parsedTool.name,
            result: {
              ok: false,
              content: `runner is not attached for ${session.runnerKey}`
            },
            note: "Broker stub received a tool request, but no local runner is connected yet"
          })
        )
      )
    )
    return
  }

  if (Array.isArray(runnerConnection.tools) && !runnerConnection.tools.includes(parsedTool.name)) {
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "runner_capability_blocked",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(`runner does not advertise tool: ${parsedTool.name}`)
    }))
    sessionSocket.write(
      encodeWsFrame(
        JSON.stringify(
          buildToolRoutedOutputEvent({
            sessionId: session.sessionId,
            runnerKey: session.runnerKey,
            toolCallId: "unsupported-tool",
            toolName: parsedTool.name,
            result: {
              ok: false,
              content: `runner does not advertise tool: ${parsedTool.name}`
            },
            note: "Broker stub blocked the tool call because the current runner capability set does not include it"
          })
        )
      )
    )
    return
  }

  const toolCallId = `tool-${randomUUID().slice(0, 8)}`
  const routing = toWireRouting(
    buildRoutingFields({
      ownerUserId: session.routing.owner_user_id,
      deviceId: session.routing.device_id,
      workspaceId: session.routing.workspace_id,
      sessionId: session.sessionId
    })
  )
  const toolCall = buildToolCallMessage({
    routing,
    toolCallId,
    toolName: parsedTool.name,
    args: parsedTool.args,
    timeoutMs:
      Number.isInteger(Number.parseInt(String(parsedTool.args?.timeout_ms || ""), 10)) &&
      Number.parseInt(String(parsedTool.args?.timeout_ms || ""), 10) > 0
        ? Number.parseInt(String(parsedTool.args?.timeout_ms || ""), 10)
        : 10000,
    source: "cc-official-broker:stub-broker"
  })

  state.events.push({
    type: "tool.call",
    sessionId: session.sessionId,
    runnerKey: session.runnerKey,
    toolCallId,
    toolName: parsedTool.name,
    args: parsedTool.args
  })

  updateSession(state, session.sessionId, current => ({
    ...current,
    status: "tool_running"
  }))

  const pendingResult = waitForToolResult(state, {
    toolCallId,
    sessionId: session.sessionId,
    runnerKey: session.runnerKey,
    runnerConnectionId: runnerConnection.connectionId,
    toolName: parsedTool.name,
    timeoutMs: toolCall.payload?.tool_call?.timeout_ms || 10000
  })

  runnerConnection.socket.write(encodeWsFrame(JSON.stringify(toolCall)))

  try {
    const settled = await pendingResult
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "idle",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(settled.result?.content || "")
    }))
    state.events.push({
      type: "tool.result",
      sessionId: session.sessionId,
      runnerKey: session.runnerKey,
      toolCallId,
      toolName: settled.toolName,
      ok: Boolean(settled.result?.ok)
    })

    sessionSocket.write(
      encodeWsFrame(
        JSON.stringify(
          buildToolRoutedOutputEvent({
            sessionId: session.sessionId,
            runnerKey: session.runnerKey,
            toolCallId,
            toolName: settled.toolName,
            result: settled.result
          })
        )
      )
    )
  } catch (error) {
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "tool_error",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(error instanceof Error ? error.message : String(error))
    }))
    state.events.push({
      type: "tool.result.error",
      sessionId: session.sessionId,
      runnerKey: session.runnerKey,
      toolCallId,
      toolName: parsedTool.name,
      error: error instanceof Error ? error.message : String(error)
    })

    sessionSocket.write(
      encodeWsFrame(
        JSON.stringify(
          buildToolRoutedOutputEvent({
            sessionId: session.sessionId,
            runnerKey: session.runnerKey,
            toolCallId,
            toolName: parsedTool.name,
            result: {
              ok: false,
              content: error instanceof Error ? error.message : String(error)
            },
            note: "Broker stub routed a tool call but did not receive a valid tool result in time"
          })
        )
      )
    )
  }
}

function buildRemoteOutputEvent({
  sessionId,
  runnerKey,
  output,
  remoteService,
  note = "Remote output returned from cc-mcp-bridge-backed service"
}) {
  return {
    type: "session.output",
    ok: true,
    ...createRequestMeta({ source: "cc-official-broker:bridge-service" }),
    payload: {
      session_id: sessionId,
      runner_key: runnerKey,
      output: String(output || "").trim() || "(empty output)",
      remote_service: remoteService || null,
      note
    }
  }
}

function buildRemoteErrorEvent({ sessionId, runnerKey, error }) {
  return {
    type: "session.output",
    ok: false,
    ...createRequestMeta({ source: "cc-official-broker:bridge-service" }),
    payload: {
      session_id: sessionId,
      runner_key: runnerKey,
      output: error instanceof Error ? error.message : String(error),
      note: "Remote service request failed before a broker-formatted answer could be returned"
    }
  }
}

async function routeSessionInput({ state, config, session, sessionSocket, message }) {
  const currentSession = state.sessions.get(session.sessionId) || session
  const parsedTool = parseToolPrompt(message.payload?.text || "")
  if (parsedTool) {
    await routeToolCall({ state, config, session: currentSession, sessionSocket, message })
    return
  }

  const input = String(message.payload?.text || "").trim() || "start broker session"
  if (!hasRemoteService(config)) {
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "idle",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(`stub remote cc received: ${input}`)
    }))
    sessionSocket.write(encodeWsFrame(JSON.stringify(buildSessionOutputEvent(message, session.sessionId, session.runnerKey))))
    return
  }

  updateSession(state, session.sessionId, current => ({
    ...current,
    status: "remote_requesting"
  }))

  const remoteRouting = toWireRouting(
    buildRoutingFields({
      ownerUserId: session.routing.owner_user_id,
      deviceId: session.routing.device_id,
      workspaceId: session.routing.workspace_id,
      sessionId: session.sessionId
    })
  )

  try {
    const remoteResult = await promptRemoteService({
      config,
      routing: remoteRouting,
      input,
      previousResponseId: currentSession.remoteService?.response_id || ""
    })

    state.events.push({
      type: "remote.prompt",
      sessionId: session.sessionId,
      runnerKey: session.runnerKey,
      endpoint: remoteResult.endpoint,
      reusedRemoteSession: remoteResult.reusedRemoteSession
    })

    const remoteService = {
      enabled: true,
      label: config.remoteServiceLabel || "",
      base_url: config.remoteServiceBaseUrl || "",
      endpoint: remoteResult.endpoint,
      model: config.remoteServiceModel || "",
      response_id: remoteResult.responseId || "",
      previous_response_id: remoteResult.previousResponseId || "",
      remote_session_id: remoteResult.remoteSessionId || "",
      reused_remote_session: remoteResult.reusedRemoteSession,
      usage: remoteResult.usage || null,
      cost_usd: remoteResult.costUsd
    }

    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "idle",
      remoteService,
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(remoteResult.output || "")
    }))

    sessionSocket.write(
      encodeWsFrame(
        JSON.stringify(
          buildRemoteOutputEvent({
            sessionId: session.sessionId,
            runnerKey: session.runnerKey,
            output: remoteResult.output,
            remoteService
          })
        )
      )
    )
  } catch (error) {
    updateSession(state, session.sessionId, current => ({
      ...current,
      status: "remote_error",
      lastOutputAt: new Date().toISOString(),
      lastOutputPreview: previewText(error instanceof Error ? error.message : String(error))
    }))
    state.events.push({
      type: "remote.prompt.error",
      sessionId: session.sessionId,
      runnerKey: session.runnerKey,
      error: error instanceof Error ? error.message : String(error)
    })
    sessionSocket.write(
      encodeWsFrame(
        JSON.stringify(
          buildRemoteErrorEvent({
            sessionId: session.sessionId,
            runnerKey: session.runnerKey,
            error
          })
        )
      )
    )
  }
}

export async function startBrokerStub({ host = "127.0.0.1", port = 0, config }) {
  const state = {
    tokens: new Map(),
    sessionIngressTokens: new Map(),
    sessions: new Map(),
    runnerConnections: new Map(),
    streamConnections: new Map(),
    sessionIngressConnections: new Map(),
    directConnectConnections: new Map(),
    pendingToolCalls: new Map(),
    sessionWork: new Map(),
    events: [],
    sockets: new Set()
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`)

      if (req.method === "GET" && url.pathname === "/healthz") {
        jsonResponse(res, 200, { ok: true, service: "cc-official-broker-stub" })
        return
      }

      if (req.method === "POST" && url.pathname === "/auth/device") {
        const body = await readJsonBody(req).catch(() => null)
        const deviceKey = body?.auth?.device_key

        if (!body || !deviceKey || deviceKey === "<missing>") {
          jsonResponse(res, 401, { ok: false, error: "device_key is required" })
          return
        }

        const accessToken = `stub-${randomUUID()}`
        const runnerKey = body.routing?.runner_key || "unknown-runner"
        state.tokens.set(accessToken, {
          runnerKey,
          routing: body.routing || {},
          createdAt: new Date().toISOString()
        })
        state.events.push({ type: "auth.device", runnerKey })

        const baseUrl = `http://${host}:${server.address().port}`
        jsonResponse(res, 200, {
          ok: true,
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          routing: body.routing || {},
          broker: {
            base_url: baseUrl,
            ws_base_url: baseUrl.replace(/^http/, "ws"),
            runner_connect_path: "/runner/connect",
            session_stream_path_template: "/sessions/:id/stream",
            session_ingress_ws_path_template: "/v2/session_ingress/ws/:id",
            session_ingress_events_path_template: "/v2/session_ingress/session/:id/events"
          },
          logging: {
            enabled: config.requestLogEnabled,
            path: config.requestLogPath
          }
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/sessions") {
        const token = bearerFromRequest(req)
        const body = await readJsonBody(req).catch(() => null)
        const directConnectAuth = buildDirectConnectAuthContext({ state, config, token })

        if (isDirectConnectCreateRequest(body)) {
          if (!directConnectAuth) {
            jsonResponse(res, 401, { ok: false, error: "invalid direct connect auth token" })
            return
          }

          const sessionId = `session-${randomUUID().slice(0, 8)}`
          const requestId = randomUUID()
          const now = new Date().toISOString()
          const baseUrl = `http://${host}:${server.address().port}`
          const wsBaseUrl = `ws://${host}:${server.address().port}`
          const sessionRouting = toWireRouting(
            buildRoutingFields({
              ownerUserId: directConnectAuth.routing?.owner_user_id || config.ownerUserId,
              deviceId: directConnectAuth.routing?.device_id || config.deviceId,
              workspaceId: directConnectAuth.routing?.workspace_id || config.workspaceId,
              sessionId
            })
          )

          state.sessions.set(sessionId, {
            sessionId,
            runnerKey: directConnectAuth.runnerKey,
            mode: "direct-connect",
            routing: sessionRouting,
            status: "direct_connect_created",
            createdAt: now,
            updatedAt: now,
            projectRoot: body.cwd || config.workspaceRoot || process.cwd(),
            remoteService: null,
            officialChild: null,
            directConnect: {
              connected: false,
              authMode: directConnectAuth.mode,
              previousResponseId: "",
              turnCount: 0
            },
            lastInputAt: null,
            lastInputPreview: null,
            lastOutputAt: null,
            lastOutputPreview: null
          })
          state.events.push({
            type: "session.direct_connect.create",
            sessionId,
            runnerKey: directConnectAuth.runnerKey
          })

          jsonResponse(res, 200, {
            session_id: sessionId,
            ws_url: `${wsBaseUrl}/v2/direct_connect/ws/${sessionId}`,
            work_dir: body.cwd || config.workspaceRoot || process.cwd(),
            meta: {
              request_id: requestId
            }
          })
          return
        }

        if (!state.tokens.has(token)) {
          jsonResponse(res, 401, { ok: false, error: "invalid access token" })
          return
        }

        const tokenContext = state.tokens.get(token)
        if (!body?.session?.mode) {
          jsonResponse(res, 400, { ok: false, error: "session.mode is required" })
          return
        }

        if (body.routing?.runner_key && body.routing.runner_key !== tokenContext.runnerKey) {
          jsonResponse(res, 403, { ok: false, error: "routing.runner_key does not match access token" })
          return
        }

        const requestId = body.meta?.request_id || randomUUID()
        const mode = body.session.mode
        const runnerKey = tokenContext.runnerKey
        const sessionId =
          mode === "resume"
            ? body.session.session_id
            : body.session.client_session_id || `session-${randomUUID().slice(0, 8)}`

        const existed = state.sessions.has(sessionId)
        if (mode === "resume" && !existed) {
          jsonResponse(res, 404, { ok: false, error: "session not found" })
          return
        }

        const previous = state.sessions.get(sessionId)
        const now = new Date().toISOString()
        const baseUrl = `http://${host}:${server.address().port}`
        const wsBaseUrl = `ws://${host}:${server.address().port}`
        const sessionRouting = toWireRouting(
          buildRoutingFields({
            ownerUserId: tokenContext.routing?.owner_user_id || body.routing?.owner_user_id || config.ownerUserId,
            deviceId: tokenContext.routing?.device_id || body.routing?.device_id || config.deviceId,
            workspaceId: tokenContext.routing?.workspace_id || body.routing?.workspace_id || config.workspaceId,
            sessionId
          })
        )
        const sessionAccessToken = previous?.officialChild?.accessToken || `session-${randomUUID()}`
        const officialPrompt =
          body.session.initial_prompt ||
          previous?.officialChild?.prompt ||
          "Reply with exactly BROKER_OFFICIAL_OK and nothing else. Do not use tools."
        const officialChild = {
          mode: "session-ingress-v2",
          accessToken: sessionAccessToken,
          prompt: officialPrompt,
          sdkUrl: `${wsBaseUrl}/v2/session_ingress/ws/${sessionId}`,
          postEventsUrl: `${baseUrl}/v2/session_ingress/session/${sessionId}/events`,
          connected: previous?.officialChild?.connected || false,
          authHeaderPresent: previous?.officialChild?.authHeaderPresent || false,
          initialized: previous?.officialChild?.initialized || false,
          initializeRequestId: previous?.officialChild?.initializeRequestId || "",
          initializeAck: previous?.officialChild?.initializeAck || null,
          replayedUserMessage: previous?.officialChild?.replayedUserMessage || null,
          assistantTexts: previous?.officialChild?.assistantTexts || [],
          deniedTools: previous?.officialChild?.deniedTools || [],
          receivedEventTypes: previous?.officialChild?.receivedEventTypes || [],
          lastResult: previous?.officialChild?.lastResult || null
        }
        state.sessions.set(sessionId, {
          sessionId,
          runnerKey,
          mode,
          routing: sessionRouting,
          status: mode === "resume" ? "resumed" : "created",
          createdAt: previous?.createdAt || now,
          updatedAt: now,
          projectRoot: body.session.project_root || previous?.projectRoot || null,
          remoteService: previous?.remoteService || null,
          officialChild,
          directConnect: previous?.directConnect || null,
          lastInputAt: previous?.lastInputAt || null,
          lastInputPreview: previous?.lastInputPreview || null,
          lastOutputAt: previous?.lastOutputAt || null,
          lastOutputPreview: previous?.lastOutputPreview || null
        })
        state.sessionIngressTokens.set(sessionAccessToken, {
          sessionId,
          runnerKey
        })
        state.events.push({ type: `session.${mode}`, sessionId, runnerKey })

        jsonResponse(
          res,
          200,
          buildSessionResponse({
            mode,
            sessionId,
            runnerKey,
            requestId,
            streamUrl: `${wsBaseUrl}/sessions/${sessionId}/stream`,
            officialChild: buildSessionIngressContract({
              baseUrl,
              wsBaseUrl,
              sessionId,
              accessToken: sessionAccessToken,
              workingDir: body.session.project_root || previous?.projectRoot || config.workspaceRoot || process.cwd()
            }),
            existed
          })
        )
        return
      }

      const sessionMatch = req.method === "GET" ? url.pathname.match(/^\/sessions\/([^/]+)$/) : null
      if (sessionMatch) {
        const token = bearerFromRequest(req)
        if (!state.tokens.has(token)) {
          jsonResponse(res, 401, { ok: false, error: "invalid access token" })
          return
        }

        const tokenContext = state.tokens.get(token)

        const sessionId = decodeURIComponent(sessionMatch[1])
        const session = state.sessions.get(sessionId)
        if (!session) {
          jsonResponse(res, 404, { ok: false, error: "session not found" })
          return
        }

        if (session.runnerKey !== tokenContext.runnerKey) {
          jsonResponse(res, 403, { ok: false, error: "session does not belong to this runner token" })
          return
        }

        const snapshot = buildSessionStatusSnapshot(state, session)
        let remoteSessionState = null
        if (hasRemoteService(config)) {
          try {
            remoteSessionState = await fetchRemoteSessionState({
              config,
              routing: session.routing
            })
          } catch (error) {
            remoteSessionState = {
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }
        }

        jsonResponse(res, 200, {
          ok: true,
          session: snapshot,
          remote_session_state: remoteSessionState
        })
        return
      }

      const ingressEventsMatch =
        req.method === "POST"
          ? url.pathname.match(/^\/v2\/session_ingress\/session\/([^/]+)\/events$/)
          : null
      if (ingressEventsMatch) {
        const sessionId = decodeURIComponent(ingressEventsMatch[1])
        const session = state.sessions.get(sessionId)
        const token = bearerFromRequest(req)
        const sessionToken = state.sessionIngressTokens.get(token)

        if (!session || !sessionToken || sessionToken.sessionId !== sessionId) {
          jsonResponse(res, 401, { ok: false, error: "invalid session ingress token" })
          return
        }

        const body = await readJsonBody(req).catch(() => null)
        const events = Array.isArray(body?.events) ? body.events : []
        const ingressConnection = Array.from(state.sessionIngressConnections.values()).find(
          connection => connection.sessionId === sessionId
        )

        for (const event of events) {
          if (!event || typeof event !== "object") {
            continue
          }

          const currentSession = state.sessions.get(sessionId) || session

          updateSession(state, sessionId, current => ({
            ...current,
            officialChild: {
              ...current.officialChild,
              authHeaderPresent: Boolean(req.headers.authorization),
              receivedEventTypes: tailList(current.officialChild?.receivedEventTypes, event.type)
            }
          }))

          if (event.type === "control_response") {
            if (event.response?.request_id === currentSession.officialChild?.initializeRequestId) {
              updateSession(state, sessionId, current => ({
                ...current,
                status: event.response?.subtype === "success" ? "official_initialized" : "official_init_error",
                officialChild: {
                  ...current.officialChild,
                  initialized: event.response?.subtype === "success",
                  initializeAck: event
                }
              }))

              if (event.response?.subtype === "success" && ingressConnection?.socket) {
                ingressConnection.socket.write(
                  encodeWsFrame(
                    `${JSON.stringify(
                      createSessionIngressReplayUserMessage({
                        sessionId,
                        prompt: currentSession.officialChild?.prompt || "Reply directly."
                      })
                    )}\n`
                  )
                )
              }
            }
            continue
          }

          if (event.type === "control_request" && event.request?.subtype === "can_use_tool") {
            updateSession(state, sessionId, current => ({
              ...current,
              officialChild: {
                ...current.officialChild,
                deniedTools: tailList(current.officialChild?.deniedTools, {
                  tool_name: event.request.tool_name,
                  tool_use_id: event.request.tool_use_id
                })
              }
            }))

            if (ingressConnection?.socket) {
              ingressConnection.socket.write(
                encodeWsFrame(
                  `${JSON.stringify(
                    createSessionIngressPermissionDenyResponse(event.request_id, event.request.tool_use_id)
                  )}\n`
                )
              )
            }
            continue
          }

          if (event.type === "user" && event.isReplay === true) {
            updateSession(state, sessionId, current => ({
              ...current,
              officialChild: {
                ...current.officialChild,
                replayedUserMessage: event
              }
            }))
            continue
          }

          if (event.type === "assistant" || event.type === "streamlined_text") {
            const text = summarizeIngressAssistantText(event)
            if (!text) {
              continue
            }
            updateSession(state, sessionId, current => ({
              ...current,
              officialChild: {
                ...current.officialChild,
                assistantTexts: tailList(current.officialChild?.assistantTexts, text)
              }
            }))
            continue
          }

          if (event.type === "result") {
            const currentOfficialChild = state.sessions.get(sessionId)?.officialChild || currentSession.officialChild || {}
            const assistantTexts = Array.isArray(currentOfficialChild.assistantTexts)
              ? currentOfficialChild.assistantTexts
              : []
            const lastAssistantText = assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : ""
            updateSession(state, sessionId, current => ({
              ...current,
              status: event.is_error ? "official_result_error" : "official_result_ok",
              officialChild: {
                ...current.officialChild,
                lastResult: event
              },
              lastOutputAt: new Date().toISOString(),
              lastOutputPreview: previewText(lastAssistantText || event.result || "")
            }))
          }
        }

        jsonResponse(res, 200, { ok: true, received: events.length })
        return
      }

      jsonResponse(res, 404, { ok: false, error: "not found" })
    } catch (error) {
      jsonResponse(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url || "/", `http://${host}`)
    const token = bearerFromRequest(req)
    const wsKey = req.headers["sec-websocket-key"]
    if (!wsKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
      socket.destroy()
      return
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${buildWsAccept(wsKey)}`,
        "\r\n"
      ].join("\r\n")
    )
    state.sockets.add(socket)
    socket.on("error", () => {
      state.sockets.delete(socket)
    })

    let frameBuffer = Buffer.alloc(0)
    const connectionId = randomUUID()

    if (url.pathname === "/runner/connect") {
      if (!state.tokens.has(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
        socket.destroy()
        return
      }

      socket.on("data", chunk => {
        try {
          frameBuffer = Buffer.concat([frameBuffer, chunk])
          const parsed = decodeWsFrames(frameBuffer)
          frameBuffer = parsed.remaining

          for (const raw of parsed.messages) {
            const message = JSON.parse(raw)
            const runnerKey = message.payload?.routing?.runner_key || "unknown-runner"

            if (message.type === "runner.register") {
              state.runnerConnections.set(connectionId, {
                runnerKey,
                activeSessionId: message.payload?.runner?.active_session_id || null,
                tools: message.payload?.runner?.tools || [],
                writableScope: message.payload?.runner?.writable_scope || "none",
                workspaceRoot: message.payload?.runner?.workspace_root || null,
                socket
              })
              state.events.push({
                type: "runner.register",
                runnerKey,
                activeSessionId: message.payload?.runner?.active_session_id || null,
                tools: message.payload?.runner?.tools || [],
                writableScope: message.payload?.runner?.writable_scope || "none"
              })

              if (message.payload?.runner?.active_session_id) {
                updateSession(state, message.payload.runner.active_session_id, current => ({
                  ...current,
                  status: "runner_attached"
                }))
              }

              socket.write(
                encodeWsFrame(
                  JSON.stringify({
                    type: "runner.registered",
                    ok: true,
                    ...createRequestMeta({ source: "cc-official-broker:stub-broker" }),
                    payload: {
                      routing: message.payload?.routing || {},
                      broker: {
                        runner_connect_path: "/runner/connect",
                        heartbeat_interval_ms: 10000
                      }
                    }
                  })
                )
              )
              continue
            }

            if (message.type === "runner.heartbeat") {
              state.events.push({
                type: "runner.heartbeat",
                runnerKey,
                activeSessionIds: message.payload?.health?.active_session_ids || []
              })

              socket.write(encodeWsFrame(JSON.stringify(buildHeartbeatAck(message))))
              continue
            }

            if (message.type === "tool.result") {
              state.events.push({
                type: "tool.result.receive",
                runnerKey,
                toolCallId: message.payload?.tool_call?.id || "unknown-tool-call",
                ok: Boolean(message.payload?.result?.ok)
              })
              resolveToolResult(state, message)
              socket.write(encodeWsFrame(JSON.stringify(buildToolResultAck(message))))
            }
          }

          if (parsed.closed) {
            socket.end()
          }
        } catch {
          socket.destroy()
        }
      })

      socket.on("close", () => {
        state.runnerConnections.delete(connectionId)
        state.sockets.delete(socket)
        rejectPendingToolCalls(
          state,
          pending => pending.runnerConnectionId === connectionId,
          `runner disconnected before tool result: ${connectionId}`
        )
      })
      return
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)\/stream$/)
    if (sessionMatch) {
      if (!state.tokens.has(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
        socket.destroy()
        return
      }

      const tokenContext = state.tokens.get(token)
      const sessionId = decodeURIComponent(sessionMatch[1])
      const session = state.sessions.get(sessionId)

      if (!session || session.runnerKey !== tokenContext.runnerKey) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
        socket.destroy()
        return
      }

      state.streamConnections.set(connectionId, {
        sessionId,
        runnerKey: session.runnerKey,
        socket
      })
      updateSession(state, sessionId, current => ({
        ...current,
        status: "stream_open"
      }))
      state.events.push({
        type: "session.stream.open",
        sessionId,
        runnerKey: session.runnerKey
      })

      socket.write(encodeWsFrame(JSON.stringify(buildSessionReadyEvent({ sessionId, runnerKey: session.runnerKey }))))

      socket.on("data", chunk => {
        try {
          frameBuffer = Buffer.concat([frameBuffer, chunk])
          const parsed = decodeWsFrames(frameBuffer)
          frameBuffer = parsed.remaining

          for (const raw of parsed.messages) {
            const message = JSON.parse(raw)
            if (message.type === "session.input") {
              updateSession(state, sessionId, current => ({
                ...current,
                status: parseToolPrompt(message.payload?.text || "") ? "tool_requested" : "responding",
                lastInputAt: new Date().toISOString(),
                lastInputPreview: previewText(message.payload?.text || "")
              }))
              state.events.push({
                type: "session.input",
                sessionId,
                runnerKey: session.runnerKey,
                text: message.payload?.text || ""
              })

              socket.write(encodeWsFrame(JSON.stringify(buildSessionInputAck(message, sessionId))))
              void enqueueSessionWork(state, sessionId, () =>
                routeSessionInput({
                  state,
                  config,
                  session,
                  sessionSocket: socket,
                  message
                })
              ).catch(() => {
                socket.destroy()
              })
            }
          }

          if (parsed.closed) {
            socket.end()
          }
        } catch {
          socket.destroy()
        }
      })

      socket.on("close", () => {
        state.streamConnections.delete(connectionId)
        state.sockets.delete(socket)
        updateSession(state, sessionId, current => ({
          ...current,
          status: "stream_closed"
        }))
        rejectPendingToolCalls(
          state,
          pending => pending.sessionId === sessionId,
          `session stream closed before tool result: ${sessionId}`
        )
        state.events.push({
          type: "session.stream.close",
          sessionId,
          runnerKey: session.runnerKey
        })
      })
      return
    }

    const ingressMatch = url.pathname.match(/^\/v2\/session_ingress\/ws\/([^/]+)$/)
    if (ingressMatch) {
      const sessionId = decodeURIComponent(ingressMatch[1])
      const session = state.sessions.get(sessionId)
      const sessionToken = state.sessionIngressTokens.get(token)

      if (!session || !sessionToken || sessionToken.sessionId !== sessionId) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
        socket.destroy()
        return
      }

      state.sessionIngressConnections.set(connectionId, {
        sessionId,
        runnerKey: session.runnerKey,
        socket
      })

      const initializeRequestId = randomUUID()
      updateSession(state, sessionId, current => ({
        ...current,
        status: "official_connecting",
        officialChild: {
          ...current.officialChild,
          connected: true,
          authHeaderPresent: Boolean(req.headers.authorization),
          initializeRequestId
        }
      }))
      state.events.push({
        type: "official.session_ingress.open",
        sessionId,
        runnerKey: session.runnerKey
      })

      socket.write(
        encodeWsFrame(`${JSON.stringify(createSessionIngressInitializeRequest(initializeRequestId))}\n`)
      )

      socket.on("data", chunk => {
        try {
          frameBuffer = Buffer.concat([frameBuffer, chunk])
          const parsed = decodeIngressWsFrames(frameBuffer)
          frameBuffer = parsed.remaining

          for (const frame of parsed.frames) {
            if (frame.opcode === 0x8) {
              socket.end(encodeWsFrame(Buffer.alloc(0), 0x8))
              return
            }

            if (frame.opcode === 0x9) {
              socket.write(encodeWsFrame(frame.payload, 0x0a))
              continue
            }

            if (frame.opcode !== 0x1) {
              continue
            }

            const text = frame.payload.toString("utf8").trim()
            if (!text) {
              continue
            }

            let payload = null
            try {
              payload = JSON.parse(text)
            } catch {
              payload = null
            }

            if (payload?.type === "keep_alive") {
              state.events.push({
                type: "official.keep_alive",
                sessionId,
                runnerKey: session.runnerKey
              })
            }
          }
        } catch {
          socket.destroy()
        }
      })

      socket.on("close", () => {
        state.sessionIngressConnections.delete(connectionId)
        state.sockets.delete(socket)
        updateSession(state, sessionId, current => ({
          ...current,
          status: current.officialChild?.lastResult
            ? current.status
            : current.officialChild?.initialized
              ? "official_waiting_result"
              : "official_stream_closed",
          officialChild: {
            ...current.officialChild,
            connected: false
          }
        }))
        state.events.push({
          type: "official.session_ingress.close",
          sessionId,
          runnerKey: session.runnerKey
        })
      })
      return
    }

    const directConnectMatch = url.pathname.match(/^\/v2\/direct_connect\/ws\/([^/]+)$/)
    if (directConnectMatch) {
      const sessionId = decodeURIComponent(directConnectMatch[1])
      const session = state.sessions.get(sessionId)
      const authContext = buildDirectConnectAuthContext({ state, config, token })

      if (!session || session.mode !== "direct-connect" || !authContext) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
        socket.destroy()
        return
      }

      state.directConnectConnections.set(connectionId, {
        sessionId,
        runnerKey: session.runnerKey,
        socket
      })

      updateSession(state, sessionId, current => ({
        ...current,
        status: "direct_connect_connected",
        directConnect: {
          ...(current.directConnect || {}),
          connected: true,
          authMode: authContext.mode
        }
      }))
      state.events.push({
        type: "direct_connect.open",
        sessionId,
        runnerKey: session.runnerKey
      })

      socket.write(
        encodeWsFrame(
          `${JSON.stringify(
            buildDirectConnectInitMessage({
              sessionId,
              cwd: session.projectRoot || config.workspaceRoot || process.cwd(),
              model: config.remoteServiceModel || "claude-opus-4-6"
            })
          )}\n`
        )
      )

      socket.on("data", chunk => {
        void (async () => {
          try {
            frameBuffer = Buffer.concat([frameBuffer, chunk])
            const parsed = decodeIngressWsFrames(frameBuffer)
            frameBuffer = parsed.remaining

            for (const frame of parsed.frames) {
              if (frame.opcode === 0x8) {
                socket.end(encodeWsFrame(Buffer.alloc(0), 0x8))
                return
              }

              if (frame.opcode === 0x9) {
                socket.write(encodeWsFrame(frame.payload, 0x0a))
                continue
              }

              if (frame.opcode !== 0x1) {
                continue
              }

              const text = frame.payload.toString("utf8").trim()
              if (!text) {
                continue
              }

              let payload = null
              try {
                payload = JSON.parse(text)
              } catch {
                payload = null
              }

              if (!payload) {
                continue
              }

              if (payload.type === "user") {
                await handleDirectConnectTurn({
                  state,
                  config,
                  sessionId,
                  socket,
                  input: extractDirectConnectInputText(payload)
                })
                continue
              }

              if (payload.type === "control_request" && payload.request?.subtype === "interrupt") {
                state.events.push({
                  type: "direct_connect.interrupt",
                  sessionId,
                  runnerKey: session.runnerKey
                })
              }
            }
          } catch {
            socket.destroy()
          }
        })()
      })

      socket.on("close", () => {
        state.directConnectConnections.delete(connectionId)
        state.sockets.delete(socket)
        updateSession(state, sessionId, current => ({
          ...current,
          status: current.status === "direct_connect_error" ? current.status : "direct_connect_closed",
          directConnect: {
            ...(current.directConnect || {}),
            connected: false
          }
        }))
        state.events.push({
          type: "direct_connect.close",
          sessionId,
          runnerKey: session.runnerKey
        })
      })
      return
    }

    socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
    socket.destroy()
  })

  await new Promise(resolve => server.listen(port, host, resolve))

  return {
    state,
    close: async () => {
      rejectPendingToolCalls(state, () => true, "broker stub is shutting down")
      for (const socket of state.sockets) {
        socket.destroy()
      }
      state.sockets.clear()
      return new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    },
    baseUrl: `http://${host}:${server.address().port}`,
    wsBaseUrl: `ws://${host}:${server.address().port}`
  }
}
