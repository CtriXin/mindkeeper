import { buildDeviceAuthPayload } from "../contracts/authDevice.mjs"

export async function inspectSession(config, overrides = {}) {
  if (!config.brokerBaseUrl) {
    throw new Error("CC_BROKER_BASE_URL is required")
  }

  if (!config.deviceKey) {
    throw new Error("CC_BROKER_DEVICE_KEY is required")
  }

  const sessionId = overrides.sessionId || "demo-session"
  const authRequest = buildDeviceAuthPayload(config, overrides)
  const authResponse = await fetch(`${config.brokerBaseUrl}/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(authRequest)
  }).then(response => response.json())

  if (!authResponse.ok) {
    throw new Error(authResponse.error || "device auth failed")
  }

  const sessionResponse = await fetch(`${config.brokerBaseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      authorization: `Bearer ${authResponse.access_token}`
    }
  }).then(response => response.json())

  if (!sessionResponse.ok) {
    throw new Error(sessionResponse.error || "session inspect failed")
  }

  return {
    ok: true,
    answer: "session inspect finished",
    session: sessionResponse.session,
    remote_session_state: sessionResponse.remote_session_state || null
  }
}
