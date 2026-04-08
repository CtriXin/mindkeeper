import { buildRoutingFields, toWireRouting } from "../shared/sessionKeys.mjs"

export function buildDeviceContext({ ownerUserId = "xin", deviceId, workspaceId, sessionId }) {
  const routing = buildRoutingFields({ ownerUserId, deviceId, workspaceId, sessionId })

  return {
    ...routing,
    wireRouting: toWireRouting(routing),
    createdAt: new Date().toISOString()
  }
}
