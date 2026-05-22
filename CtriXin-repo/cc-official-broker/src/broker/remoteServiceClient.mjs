export function buildRemoteServiceHeaders(config) {
  const headers = {
    "content-type": "application/json"
  }

  if (config.remoteServiceBearerToken) {
    headers.authorization = `Bearer ${config.remoteServiceBearerToken}`
  } else if (config.remoteServiceApiKey) {
    headers["x-api-key"] = config.remoteServiceApiKey
  }

  return headers
}

export function buildRemoteServiceUrl(config, path) {
  if (!config.remoteServiceBaseUrl) {
    throw new Error("CC_BROKER_REMOTE_SERVICE_BASE_URL is required")
  }

  const pathname = path.startsWith("/") ? path : `/${path}`
  return `${config.remoteServiceBaseUrl}${pathname}`
}

function extractErrorMessage(payload, fallback) {
  if (!payload) {
    return fallback
  }

  if (typeof payload === "string") {
    return payload
  }

  if (typeof payload.error === "string") {
    return payload.error
  }

  if (payload.error && typeof payload.error.message === "string") {
    return payload.error.message
  }

  if (typeof payload.message === "string") {
    return payload.message
  }

  return fallback
}

function shouldRetryRemoteError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up") ||
    normalized.includes("other side closed") ||
    normalized.includes("network")
  )
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchRemoteJson(config, url, options = {}) {
  const timeoutMs = config.remoteServiceTimeoutMs || 90000
  const maxAttempts = 2

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload) {
        throw new Error(extractErrorMessage(payload, `remote service request failed: ${response.status}`))
      }

      return payload
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`remote service request timed out after ${timeoutMs}ms`)
      }

      if (attempt < maxAttempts && shouldRetryRemoteError(error)) {
        await sleep(400)
        continue
      }

      if (error instanceof Error) {
        throw error
      }
      throw new Error(String(error))
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error("remote service request failed")
}

function toMetadata(routing) {
  return {
    owner_user_id: routing.owner_user_id,
    device_id: routing.device_id,
    workspace_id: routing.workspace_id,
    session_id: routing.session_id
  }
}

function extractResponseOutputText(payload = {}) {
  const parts = []

  for (const item of payload.output || []) {
    if (!item || item.type !== "message") {
      continue
    }

    for (const content of item.content || []) {
      if (!content) {
        continue
      }
      if (content.type === "output_text" || content.type === "text") {
        parts.push(String(content.text || ""))
      }
    }
  }

  return parts.join("").trim()
}

function extractChatOutputText(payload = {}) {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === "string") {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (!item) return ""
        if (typeof item === "string") return item
        return item.text || item.content || ""
      })
      .join("")
      .trim()
  }

  return ""
}

function normalizeEndpoint(value = "") {
  const raw = String(value || "").trim().toLowerCase()
  if (["chat", "chat.completions", "chat_completions"].includes(raw)) {
    return "chat.completions"
  }
  return "responses"
}

export function hasRemoteService(config) {
  return Boolean(config.remoteServiceBaseUrl)
}

export async function promptRemoteService({
  config,
  routing,
  input,
  previousResponseId = "",
  source = "cc-official-broker:broker"
}) {
  const endpoint = normalizeEndpoint(config.remoteServiceEndpoint)
  const headers = buildRemoteServiceHeaders(config)
  const metadata = {
    ...toMetadata(routing),
    source
  }

  let requestBody = null
  let url = ""

  if (endpoint === "chat.completions") {
    url = buildRemoteServiceUrl(config, "/v1/chat/completions")
    requestBody = {
      model: config.remoteServiceModel,
      messages: [{ role: "user", content: input }],
      metadata
    }
  } else {
    url = buildRemoteServiceUrl(config, "/v1/responses")
    requestBody = {
      model: config.remoteServiceModel,
      input,
      metadata
    }
    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId
    }
  }

  const payload = await fetchRemoteJson(config, url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  })

  const output =
    endpoint === "chat.completions" ? extractChatOutputText(payload) : extractResponseOutputText(payload)
  const ccMeta = payload.cc_meta || {}
  const meta = ccMeta.meta || {}

  return {
    endpoint,
    output,
    responseId: payload.id || "",
    previousResponseId: payload.previous_response_id || previousResponseId || "",
    remoteSessionId: meta.remote_session_id || "",
    reusedRemoteSession: Boolean(meta.reused_remote_session),
    usage: ccMeta.usage || null,
    costUsd: ccMeta.cost_usd ?? null,
    ccMeta
  }
}

export async function fetchRemoteSessionState({ config, routing }) {
  const query = new URLSearchParams({
    device_id: routing.device_id,
    workspace_id: routing.workspace_id,
    session_id: routing.session_id
  })

  const payload = await fetchRemoteJson(config, buildRemoteServiceUrl(config, `/v1/session_state?${query.toString()}`), {
    headers: buildRemoteServiceHeaders(config)
  })

  return payload
}

export async function fetchRemoteStats({ config, window = "24h", limit = 20, endpoint = "" } = {}) {
  const query = new URLSearchParams({
    window,
    limit: String(limit)
  })
  if (endpoint) {
    query.set("endpoint", endpoint)
  }

  const payload = await fetchRemoteJson(config, buildRemoteServiceUrl(config, `/v1/stats?${query.toString()}`), {
    headers: buildRemoteServiceHeaders(config)
  })

  return payload
}

export async function fetchRemoteModels({ config }) {
  const payload = await fetchRemoteJson(config, buildRemoteServiceUrl(config, "/v1/models"), {
    headers: buildRemoteServiceHeaders(config)
  })

  return payload
}
