function normalizeKeyPart(input = "", fallback = "unknown") {
  return String(input)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback
}

export function buildRoutingFields({ ownerUserId, deviceId, workspaceId, sessionId }) {
  const normalized = {
    ownerUserId: normalizeKeyPart(ownerUserId, "unknown-owner"),
    deviceId: normalizeKeyPart(deviceId, "unknown-device"),
    workspaceId: normalizeKeyPart(workspaceId, "default-workspace"),
    sessionId: normalizeKeyPart(sessionId, "default-session")
  }

  return {
    ...normalized,
    runnerKey: [normalized.ownerUserId, normalized.deviceId, normalized.workspaceId].join(":"),
    sessionKey: [normalized.ownerUserId, normalized.deviceId, normalized.workspaceId, normalized.sessionId].join(":")
  }
}

export function toWireRouting({ ownerUserId, deviceId, workspaceId, sessionId, runnerKey, sessionKey }) {
  return {
    owner_user_id: ownerUserId,
    device_id: deviceId,
    workspace_id: workspaceId,
    session_id: sessionId,
    runner_key: runnerKey,
    session_key: sessionKey
  }
}
