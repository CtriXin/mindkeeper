import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"
import { buildCreateSessionRequest, buildResumeSessionRequest } from "../mms/entryRequests.mjs"
import { createSocketInbox, waitForOpen } from "../shared/socketClient.mjs"

export async function runSessionPrompt(config, overrides = {}) {
  if (!config.brokerBaseUrl) {
    throw new Error("CC_BROKER_BASE_URL is required")
  }

  if (!config.deviceKey) {
    throw new Error("CC_BROKER_DEVICE_KEY is required")
  }

  const sessionId = overrides.sessionId || "demo-session"
  const mode = overrides.mode || "create"
  const prompt = overrides.prompt || "ping broker session"
  const projectRoot = overrides.projectRoot || config.workspaceRoot || process.cwd()

  const authRequest = buildDeviceAuthPayload(config, overrides)
  const authResponse = await fetch(`${config.brokerBaseUrl}/auth/device`, {
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

  const sessionRequest =
    mode === "resume"
      ? buildResumeSessionRequest(config, { ...overrides, sessionId })
      : buildCreateSessionRequest(config, {
          ...overrides,
          clientSessionId: sessionId,
          projectRoot,
          initialGoal: overrides.initialGoal || "manual broker prompt",
          initialPrompt: overrides.initialPrompt || prompt
        })

  const sessionResponse = await fetch(`${config.brokerBaseUrl}/sessions`, {
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

  try {
    await waitForOpen(streamSocket)
    const streamReady = await streamInbox.next(message => message.type === "session.ready")

    streamSocket.send(
      JSON.stringify({
        type: "session.input",
        payload: {
          text: prompt
        }
      })
    )

    const streamAck = await streamInbox.next(message => message.type === "session.input.ack")
    const streamOutput = await streamInbox.next(message => message.type === "session.output")

    return {
      ok: true,
      answer: "session prompt finished",
      session: {
        selected_path: mode,
        session_id: sessionResponse.session.session_id,
        runner_key: sessionResponse.session.attached_runner_key,
        stream_url: sessionResponse.session.stream_url
      },
      websocket: {
        stream_ready: streamReady.type,
        stream_ack: streamAck.type,
        stream_output: streamOutput.type
      },
      prompt,
      output: streamOutput.payload?.output || "",
      note: "如果 runner 已连接，这里可以收到 tool 回灌后的 session.output。"
    }
  } finally {
    streamSocket.close()
  }
}
