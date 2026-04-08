import { buildRunnerRoutingFields, toWireRunnerRouting } from "../shared/sessionKeys.mjs"
import { createRequestMeta } from "../shared/wireMeta.mjs"

function resolveDeviceAuthContext(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  return {
    routing,
    client: {
      name: config.clientName,
      version: config.clientVersion
    },
    meta: createRequestMeta({ source: `${config.requestSource}:mms` })
  }
}

export function buildDeviceAuthPayload(config, overrides = {}) {
  const context = resolveDeviceAuthContext(config, overrides)

  return {
    routing: toWireRunnerRouting(context.routing),
    auth: {
      device_key: config.deviceKey || "",
      preferred_mode: "bearer",
      compatibility_mode: config.compatApiKey ? "x-api-key" : null,
      requested_scopes: ["sessions:create", "sessions:stream", "runner:connect", "usage:heartbeat"]
    },
    client: context.client,
    meta: context.meta
  }
}

export function buildDeviceAuthRequestSample(config, overrides = {}) {
  const payload = buildDeviceAuthPayload(config, overrides)

  return {
    ...payload,
    auth: {
      ...payload.auth,
      device_key: payload.auth.device_key ? "<redacted>" : "<missing>"
    }
  }
}

export function buildDeviceAuthResponseSample(config, overrides = {}) {
  const routing = buildRunnerRoutingFields({
    ownerUserId: overrides.ownerUserId || config.ownerUserId,
    deviceId: overrides.deviceId || config.deviceId,
    workspaceId: overrides.workspaceId || config.workspaceId
  })

  return {
    access_token: "<broker-access-token>",
    token_type: "Bearer",
    expires_in: 3600,
    routing: toWireRunnerRouting(routing),
    broker: {
      base_url: config.brokerBaseUrl || "<broker-base-url>",
      ws_base_url: config.brokerBaseUrl
        ? config.brokerBaseUrl.replace(/^http/, "ws")
        : "<broker-ws-base-url>",
      runner_connect_path: "/runner/connect",
      session_stream_path_template: "/sessions/:id/stream",
      session_ingress_ws_path_template: "/v2/session_ingress/ws/:id",
      session_ingress_events_path_template: "/v2/session_ingress/session/:id/events"
    },
    logging: {
      enabled: config.requestLogEnabled,
      path: config.requestLogPath
    }
  }
}
