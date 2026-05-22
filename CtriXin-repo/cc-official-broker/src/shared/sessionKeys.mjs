function normalizeKeyPart(input = "", fallback = "unknown") {
  return String(input)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback
}

export function normalizeOwnerUserId(input = "") {
  return normalizeKeyPart(input, "unknown-owner")
}

export function normalizeDeviceId(input = "") {
  return normalizeKeyPart(input, "unknown-device")
}

export function normalizeWorkspaceId(input = "") {
  return normalizeKeyPart(input, "default-workspace")
}

export function normalizeSessionId(input = "") {
  return normalizeKeyPart(input, "default-session")
}

export function buildRunnerKey({ ownerUserId, deviceId, workspaceId }) {
  return [
    normalizeOwnerUserId(ownerUserId),
    normalizeDeviceId(deviceId),
    normalizeWorkspaceId(workspaceId)
  ].join(":")
}

export function buildRunnerRoutingFields({ ownerUserId, deviceId, workspaceId }) {
  const normalized = {
    ownerUserId: normalizeOwnerUserId(ownerUserId),
    deviceId: normalizeDeviceId(deviceId),
    workspaceId: normalizeWorkspaceId(workspaceId)
  }

  return {
    ...normalized,
    runnerKey: buildRunnerKey(normalized)
  }
}

export function buildSessionKey({ ownerUserId, deviceId, workspaceId, sessionId }) {
  return [buildRunnerKey({ ownerUserId, deviceId, workspaceId }), normalizeSessionId(sessionId)].join(":")
}

export function buildRoutingFields({ ownerUserId, deviceId, workspaceId, sessionId }) {
  const normalized = {
    ...buildRunnerRoutingFields({ ownerUserId, deviceId, workspaceId }),
    sessionId: normalizeSessionId(sessionId)
  }

  return {
    ...normalized,
    runnerKey: buildRunnerKey(normalized),
    sessionKey: buildSessionKey(normalized)
  }
}

export function toWireRunnerRouting({ ownerUserId, deviceId, workspaceId, runnerKey }) {
  return {
    owner_user_id: ownerUserId,
    device_id: deviceId,
    workspace_id: workspaceId,
    runner_key: runnerKey
  }
}

export function toWireRouting({ ownerUserId, deviceId, workspaceId, sessionId, runnerKey, sessionKey }) {
  return {
    ...toWireRunnerRouting({ ownerUserId, deviceId, workspaceId, runnerKey }),
    session_id: sessionId,
    session_key: sessionKey
  }
}
