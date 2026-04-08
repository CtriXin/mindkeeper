import { buildToolResultMessage } from "../contracts/toolProtocol.mjs"
import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import { buildRunnerHeartbeatMessage, buildRunnerRegisterMessage } from "../contracts/runnerProtocol.mjs"
import { startBrokerStub } from "../broker/stubServer.mjs"
import { buildCreateSessionRequest, buildResumeSessionRequest } from "../mms/entryRequests.mjs"
import { createSocketInbox, waitForOpen } from "../shared/socketClient.mjs"
import { executeToolCall, normalizeRunnerTools, parseToolPrompt } from "../runner/toolExecutor.mjs"

function withDemoDefaults(config) {
  return {
    ...config,
    brokerBaseUrl: "",
    deviceKey: config.deviceKey || "demo-device-key",
    requestSource: "cc-official-broker:local-demo",
    runnerTools: config.runnerTools || ["pwd", "git_status", "read_file", "search"],
    runnerWritableScope: config.runnerWritableScope || "none"
  }
}

export async function runLocalBrokerDemo(config, overrides = {}) {
  const demoConfig = withDemoDefaults(config)
  const sessionId = overrides.sessionId || "demo-session"
  const mode = overrides.mode || "create"
  const prompt = overrides.prompt || "ping remote session from local demo"
  const workspaceRoot = overrides.projectRoot || process.cwd()
  const requestedTool = parseToolPrompt(prompt)
  const stub = await startBrokerStub({ config: demoConfig })

  try {
    demoConfig.brokerBaseUrl = stub.baseUrl

    const authRequest = buildDeviceAuthPayload(demoConfig, overrides)
    const authResponse = await fetch(`${stub.baseUrl}/auth/device`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authRequest)
    }).then(response => response.json())

    if (!authResponse.ok) {
      throw new Error(authResponse.error || "device auth failed")
    }

    const headers = {
      authorization: `Bearer ${authResponse.access_token}`,
      "content-type": "application/json"
    }

    if (mode === "resume") {
      const seedRequest = buildCreateSessionRequest(demoConfig, {
        ...overrides,
        clientSessionId: sessionId,
        projectRoot: workspaceRoot,
        initialGoal: overrides.initialGoal || "seed resume session",
        initialPrompt: overrides.initialPrompt || "seed"
      })
      await fetch(`${stub.baseUrl}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify(seedRequest)
      }).then(async response => {
        const payload = await response.json()
        if (!payload.ok) {
          throw new Error(payload.error || "seed session failed")
        }
      })
    }

    const sessionRequest =
      mode === "resume"
        ? buildResumeSessionRequest(demoConfig, { ...overrides, sessionId })
        : buildCreateSessionRequest(demoConfig, {
            ...overrides,
            clientSessionId: sessionId,
            projectRoot: workspaceRoot,
            initialGoal: overrides.initialGoal || "验证本地 broker stub",
            initialPrompt: overrides.initialPrompt || "create local broker demo"
          })

    const sessionResponse = await fetch(`${stub.baseUrl}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify(sessionRequest)
    }).then(response => response.json())

    if (!sessionResponse.ok) {
      throw new Error(sessionResponse.error || "session request failed")
    }

    const streamSocket = new WebSocket(
      `${sessionResponse.session.stream_url}?access_token=${authResponse.access_token}`
    )
    const streamInbox = createSocketInbox(streamSocket)
    await waitForOpen(streamSocket)
    const streamReady = await streamInbox.next(message => message.type === "session.ready")

    const runnerSocket = new WebSocket(`${stub.wsBaseUrl}/runner/connect?access_token=${authResponse.access_token}`)
    const runnerInbox = createSocketInbox(runnerSocket)
    await waitForOpen(runnerSocket)

    const registerRequest = buildRunnerRegisterMessage(demoConfig, {
      ...overrides,
      activeSessionId: sessionResponse.session.session_id
    })
    runnerSocket.send(JSON.stringify(registerRequest))
    const registerAck = await runnerInbox.next(message => message.type === "runner.registered")

    const heartbeatRequest = buildRunnerHeartbeatMessage(demoConfig, {
      ...overrides,
      status: "ready",
      activeSessionIds: [sessionResponse.session.session_id]
    })
    runnerSocket.send(JSON.stringify(heartbeatRequest))
    const heartbeatAck = await runnerInbox.next(message => message.type === "runner.heartbeat.ack")

    streamSocket.send(
      JSON.stringify({
        type: "session.input",
        payload: {
          text: prompt
        }
      })
    )
    const streamAck = await streamInbox.next(message => message.type === "session.input.ack")

    let toolCall = null
    let toolExecution = null
    let toolAck = null

    if (requestedTool) {
      toolCall = await runnerInbox.next(message => message.type === "tool.call")
      const toolResult = await executeToolCall({
        name: toolCall.payload?.tool_call?.name,
        args: toolCall.payload?.tool_call?.arguments || {},
        workspaceRoot,
        allowedTools: normalizeRunnerTools(demoConfig.runnerTools)
      })
      toolExecution = {
        name: toolCall.payload?.tool_call?.name,
        args: toolCall.payload?.tool_call?.arguments || {},
        result: toolResult
      }
      runnerSocket.send(
        JSON.stringify(
          buildToolResultMessage({
            routing: toolCall.payload?.routing || {},
            toolCallId: toolCall.payload?.tool_call?.id,
            toolName: toolCall.payload?.tool_call?.name,
            result: toolResult,
            source: `${demoConfig.requestSource}:runner`
          })
        )
      )
      toolAck = await runnerInbox.next(message => message.type === "tool.result.ack")
    }

    const streamOutput = await streamInbox.next(message => message.type === "session.output")
    runnerSocket.close()
    streamSocket.close()

    return {
      ok: true,
      mode: "local-demo",
      answer:
        mode === "resume"
          ? "本地 broker stub 已跑通 resume session + stream + runner attach"
          : "本地 broker stub 已跑通 create session + stream + runner attach",
      flow: [
        `device auth ok (${authRequest.routing.runner_key})`,
        `${mode} session ok (${sessionResponse.session.session_id})`,
        "session stream ready",
        "runner register ok",
        "runner heartbeat ok",
        requestedTool ? `tool routed ok (${requestedTool.name})` : "session input/output ok"
      ],
      session: {
        selected_path: mode,
        session_id: sessionResponse.session.session_id,
        runner_key: authRequest.routing.runner_key,
        attached_runner_key: sessionResponse.session.attached_runner_key,
        stream_url: sessionResponse.session.stream_url
      },
      broker: {
        base_url: stub.baseUrl,
        ws_url: `${stub.wsBaseUrl}/runner/connect`
      },
      events: stub.state.events,
      websocket: {
        stream_ready: streamReady.type,
        register_ack: registerAck.type,
        heartbeat_ack: heartbeatAck.type,
        stream_ack: streamAck.type,
        stream_output: streamOutput.type,
        tool_call: toolCall?.type || null,
        tool_ack: toolAck?.type || null
      },
      stream: {
        sent_prompt: prompt,
        output: streamOutput.payload?.output || ""
      },
      tool: toolExecution,
      note: requestedTool
        ? "你现在能直观看到 broker 把 tool call 转给本地 runner，再把结果回灌到 session stream。"
        : "这是 cc-official-broker 自己的本地 stub，不依赖另一个项目"
    }
  } finally {
    await stub.close()
  }
}
