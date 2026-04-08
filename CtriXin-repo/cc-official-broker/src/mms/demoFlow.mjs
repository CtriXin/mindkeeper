import { buildDeviceAuthRequestSample, buildDeviceAuthResponseSample } from "../contracts/authDevice.mjs"
import {
  buildRunnerHeartbeatMessage,
  buildRunnerRegisterMessage,
  buildRunnerRegisteredAckSample
} from "../contracts/runnerProtocol.mjs"
import { buildCreateSessionRequest, buildResumeSessionRequest } from "./entryRequests.mjs"

export function buildDemoFlow(config, overrides = {}) {
  const sessionId = overrides.sessionId || "demo-session"
  const mode = overrides.mode || "create"
  const projectRoot = overrides.projectRoot || "<project-root>"
  const initialGoal = overrides.initialGoal || "验证本地 MMS -> Broker -> Runner 链路"
  const initialPrompt = overrides.initialPrompt || "start broker session"

  const authRequest = buildDeviceAuthRequestSample(config, overrides)
  const authResponse = buildDeviceAuthResponseSample(config, overrides)
  const sessionRequest =
    mode === "resume"
      ? buildResumeSessionRequest(config, { ...overrides, sessionId })
      : buildCreateSessionRequest(config, {
          ...overrides,
          clientSessionId: sessionId,
          projectRoot,
          initialGoal,
          initialPrompt
        })
  const runnerRegister = buildRunnerRegisterMessage(config, { ...overrides, activeSessionId: sessionId })
  const runnerRegistered = buildRunnerRegisteredAckSample(config, overrides)
  const runnerHeartbeat = buildRunnerHeartbeatMessage(config, {
    ...overrides,
    activeSessionIds: [sessionId],
    status: "ready"
  })
  const streamUrl = `<broker-ws-base-url>/sessions/${sessionId}/stream`

  return {
    ok: true,
    mode: "demo-flow",
    selected_path: mode === "resume" ? "resume-session" : "create-session",
    what_you_can_feel: [
      "MMS 启动时会先拿 device auth，再决定 create 或 resume session",
      "session stream 建好后，远端 official cc 的输出会先经过 broker 再回到本地",
      "同一台设备/工作区会固定 runner_key，不同 workspace 会自然隔离",
      "session 绑定后，Local Runner 会主动 register 并持续 heartbeat"
    ],
    routing_preview: authRequest.routing,
    steps: [
      {
        step: "device_auth",
        request: authRequest,
        expected_response: authResponse
      },
      {
        step: mode === "resume" ? "resume_session" : "create_session",
        request: sessionRequest
      },
      {
        step: "session_stream",
        request: {
          method: "WS",
          url: streamUrl,
          query: {
            access_token: "<broker-access-token>"
          },
          first_server_event: {
            type: "session.ready",
            payload: {
              session_id: sessionId,
              runner_key: authRequest.routing.runner_key,
              status: "attached"
            }
          },
          sample_input: {
            type: "session.input",
            payload: {
              text: "ping remote session from local demo"
            }
          },
          sample_output: {
            type: "session.output",
            payload: {
              session_id: sessionId,
              runner_key: authRequest.routing.runner_key,
              output: "stub remote cc received: ping remote session from local demo"
            }
          }
        }
      },
      {
        step: "runner_register",
        request: runnerRegister,
        expected_response: runnerRegistered
      },
      {
        step: "runner_heartbeat",
        request: runnerHeartbeat
      }
    ],
    next_to_build: [
      "把本地 stub 扩成持久 broker 进程",
      "把 runner tool call / tool result 往真实执行推进"
    ]
  }
}
