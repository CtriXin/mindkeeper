import { buildRunnerRoutingFields, toWireRunnerRouting } from "../shared/sessionKeys.mjs"
import { createRequestMeta } from "../shared/wireMeta.mjs"

export function buildCreateSessionRequest(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  return {
    routing: toWireRunnerRouting(routing),
    session: {
      mode: "create",
      bind_runner: true,
      client_session_id: overrides.clientSessionId || "draft-session",
      project_root: overrides.projectRoot || "<project-root>",
      initial_goal: overrides.initialGoal || "<goal>",
      initial_prompt: overrides.initialPrompt || "<prompt>"
    },
    client: {
      name: config.clientName,
      version: config.clientVersion
    },
    meta: createRequestMeta({ source: `${config.requestSource}:mms` })
  }
}

export function buildResumeSessionRequest(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  return {
    routing: toWireRunnerRouting(routing),
    session: {
      mode: "resume",
      session_id: overrides.sessionId || "existing-session-id",
      bind_runner: true,
      ...(overrides.initialPrompt
        ? {
            initial_prompt: overrides.initialPrompt
          }
        : {})
    },
    client: {
      name: config.clientName,
      version: config.clientVersion
    },
    meta: createRequestMeta({ source: `${config.requestSource}:mms` })
  }
}

export function buildMmsFlowSummary(config) {
  return {
    steps: [
      "1. MMS calls POST /auth/device with device_key to bootstrap broker access token",
      "2. MMS calls POST /sessions to create or resume a remote session",
      "3. MMS opens WS /sessions/:id/stream for user/model streaming",
      "4. Local Runner opens WS /runner/connect for tool execution callbacks"
    ],
    defaults: {
      client_name: config.clientName,
      client_version: config.clientVersion,
      preferred_auth_mode: "bearer"
    }
  }
}
