import { buildRunnerRoutingFields, toWireRunnerRouting } from "../shared/sessionKeys.mjs"
import { createRequestMeta } from "../shared/wireMeta.mjs"
import { normalizeRunnerTools } from "../runner/toolExecutor.mjs"

export const RUNNER_PROTOCOL_VERSION = "2026-04-05"

function buildEnvelope(type, payload, source) {
  return {
    type,
    protocol_version: RUNNER_PROTOCOL_VERSION,
    ...createRequestMeta({ source }),
    payload
  }
}

export function buildRunnerRegisterMessage(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  const tools = normalizeRunnerTools(overrides.tools || config.runnerTools)

  return buildEnvelope(
    "runner.register",
    {
      routing: toWireRunnerRouting(routing),
      runner: {
        host_kind: "local",
        workspace_root: overrides.workspaceRoot || config.workspaceRoot,
        writable_scope: overrides.writableScope || config.runnerWritableScope,
        tools,
        active_session_id: overrides.activeSessionId || null
      }
    },
    `${config.requestSource}:runner`
  )
}

export function buildRunnerHeartbeatMessage(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  return buildEnvelope(
    "runner.heartbeat",
    {
      routing: toWireRunnerRouting(routing),
      health: {
        status: overrides.status || "idle",
        active_session_ids: overrides.activeSessionIds || [],
        pending_tool_calls: overrides.pendingToolCalls || 0,
        workspace_root: overrides.workspaceRoot || config.workspaceRoot
      }
    },
    `${config.requestSource}:runner`
  )
}

export function buildRunnerRegisteredAckSample(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  return buildEnvelope(
    "runner.registered",
    {
      routing: toWireRunnerRouting(routing),
      broker: {
        runner_connect_path: "/runner/connect",
        heartbeat_interval_ms: 10000
      }
    },
    `${config.requestSource}:broker`
  )
}
