import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import {
  buildRunnerHeartbeatMessage,
  buildRunnerRegisterMessage
} from "../contracts/runnerProtocol.mjs"
import { buildToolResultMessage } from "../contracts/toolProtocol.mjs"
import { createSocketInbox, waitForOpen } from "../shared/socketClient.mjs"
import { executeToolCall, normalizeRunnerTools } from "./toolExecutor.mjs"

function printJsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

export async function runRunnerService(config, overrides = {}) {
  if (!config.brokerBaseUrl) {
    throw new Error("CC_BROKER_BASE_URL is required")
  }

  if (!config.deviceKey) {
    throw new Error("CC_BROKER_DEVICE_KEY is required")
  }

  const allowedTools = normalizeRunnerTools(config.runnerTools)
  const authRequest = buildDeviceAuthPayload(config, overrides)
  const authResponse = await fetch(`${config.brokerBaseUrl}/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(authRequest)
  }).then(response => response.json())

  if (!authResponse.ok) {
    throw new Error(authResponse.error || "device auth failed")
  }

  const socket = new WebSocket(
    `${authResponse.broker.ws_base_url}${authResponse.broker.runner_connect_path}?access_token=${authResponse.access_token}`
  )
  const inbox = createSocketInbox(socket)
  await waitForOpen(socket)

  const registerRequest = buildRunnerRegisterMessage(config, overrides)
  socket.send(JSON.stringify(registerRequest))
  const registerAck = await inbox.next(message => message.type === "runner.registered")

  printJsonLine({
    type: "runner.service.ready",
    runner_key: registerRequest.payload.routing.runner_key,
    workspace_root: config.workspaceRoot,
    tools: registerRequest.payload.runner.tools,
    writable_scope: registerRequest.payload.runner.writable_scope,
    broker: authResponse.broker,
    register_ack: registerAck.type
  })

  let stopped = false
  let heartbeatTimer = null

  const cleanup = async () => {
    if (stopped) {
      return
    }
    stopped = true
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.close()
    }
  }

  const heartbeatIntervalMs =
    registerAck.payload?.broker?.heartbeat_interval_ms || config.runnerHeartbeatIntervalMs

  heartbeatTimer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      return
    }

    socket.send(
      JSON.stringify(
        buildRunnerHeartbeatMessage(config, {
          ...overrides,
          status: "ready",
          activeSessionIds: overrides.activeSessionId ? [overrides.activeSessionId] : []
        })
      )
    )
  }, heartbeatIntervalMs)

  const shutdownPromise = new Promise(resolve => {
    let closing = false
    const finish = async signal => {
      if (closing) {
        return
      }
      closing = true
      await cleanup()
      resolve(signal)
    }

    process.on("SIGINT", () => {
      void finish("SIGINT")
    })
    process.on("SIGTERM", () => {
      void finish("SIGTERM")
    })
    socket.addEventListener("close", () => {
      void finish("socket.close")
    })
    socket.addEventListener("error", () => {
      void finish("socket.error")
    })
  })

  const consumePromise = (async () => {
    while (!stopped && socket.readyState === WebSocket.OPEN) {
      const message = await inbox.next()

      if (message.type === "runner.heartbeat.ack") {
        printJsonLine({
          type: "runner.heartbeat.ack",
          runner_key: registerRequest.payload.routing.runner_key,
          active_session_ids: message.payload?.health?.active_session_ids || []
        })
        continue
      }

      if (message.type === "tool.result.ack") {
        printJsonLine({
          type: "runner.tool.result.ack",
          tool_call_id: message.payload?.tool_call?.id || null
        })
        continue
      }

      if (message.type !== "tool.call") {
        printJsonLine({
          type: "runner.message.skip",
          message_type: message.type
        })
        continue
      }

      const toolName = message.payload?.tool_call?.name
      const toolArgs = message.payload?.tool_call?.arguments || {}
      const toolCallId = message.payload?.tool_call?.id

      const result = await executeToolCall({
        name: toolName,
        args: toolArgs,
        workspaceRoot: config.workspaceRoot,
        allowedTools,
        writableScope: config.runnerWritableScope
      })

      printJsonLine({
        type: "runner.tool.executed",
        tool_call_id: toolCallId,
        tool_name: toolName,
        ok: result.ok
      })

      socket.send(
        JSON.stringify(
          buildToolResultMessage({
            routing: message.payload?.routing || {},
            toolCallId,
            toolName,
            result,
            source: `${config.requestSource}:runner-service`
          })
        )
      )
    }
  })()

  const stopReason = await Promise.race([shutdownPromise, consumePromise])
  await cleanup()

  return {
    ok: true,
    answer: "runner service stopped",
    stop_reason: stopReason || "completed"
  }
}
