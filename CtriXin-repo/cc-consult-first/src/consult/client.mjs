import { readFile } from "node:fs/promises"

import { buildRoutingFields, toWireRouting } from "../shared/routing.mjs"

function buildHeaders(config) {
  return {
    authorization: `Bearer ${config.bearerToken}`,
    "content-type": "application/json"
  }
}

function buildUrl(config, path) {
  return `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`
}

function extractChatText(payload = {}) {
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

function extractResponseText(payload = {}) {
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

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback
  if (typeof payload === "string") return payload
  if (typeof payload.error === "string") return payload.error
  if (payload.error && typeof payload.error.message === "string") return payload.error.message
  if (typeof payload.message === "string") return payload.message
  return fallback
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timer }
}

function buildConsultText({ prompt, contextText = "" }) {
  const sections = []

  if (contextText) {
    sections.push(["[Context]", contextText.trim()].join("\n"))
  }

  sections.push(["[Task]", String(prompt || "").trim()].join("\n"))
  return sections.join("\n\n").trim()
}

export async function readContextFile(pathname = "") {
  if (!pathname) {
    return ""
  }

  return readFile(pathname, "utf8")
}

export function buildConsultRequest(config, { prompt, contextText = "", sessionId = "", endpoint = "" } = {}) {
  const routing = buildRoutingFields({
    ownerUserId: config.ownerUserId,
    deviceId: config.deviceId,
    workspaceId: config.workspaceId,
    sessionId: sessionId || config.sessionId
  })
  const selectedEndpoint = endpoint || config.endpoint
  const inputText = buildConsultText({ prompt, contextText })
  const metadata = {
    ...toWireRouting(routing),
    source: config.source
  }

  if (selectedEndpoint === "responses") {
    return {
      endpoint: selectedEndpoint,
      routing,
      url: buildUrl(config, "/v1/responses"),
      body: {
        model: config.model,
        input: inputText,
        metadata
      }
    }
  }

  const messages = []
  if (config.systemPrompt) {
    messages.push({ role: "system", content: config.systemPrompt })
  }
  messages.push({ role: "user", content: inputText })

  return {
    endpoint: "chat.completions",
    routing,
    url: buildUrl(config, "/v1/chat/completions"),
    body: {
      model: config.model,
      messages,
      stream: false,
      metadata
    }
  }
}

export async function consultRemoteBrain(config, options = {}) {
  const request = buildConsultRequest(config, options)
  const { controller, timer } = createAbortSignal(config.timeoutMs)

  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(request.body),
      signal: controller.signal
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok || !payload) {
      throw new Error(extractErrorMessage(payload, `consult request failed: ${response.status}`))
    }

    const meta = payload.cc_meta?.meta || {}
    return {
      ok: true,
      endpoint: request.endpoint,
      routing: toWireRouting(request.routing),
      output: request.endpoint === "responses" ? extractResponseText(payload) : extractChatText(payload),
      response_id: payload.id || "",
      remote_session_id: meta.remote_session_id || "",
      usage: payload.usage || null,
      raw: payload
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`consult request timed out after ${config.timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchSessionState(config, { sessionId = "" } = {}) {
  const routing = buildRoutingFields({
    ownerUserId: config.ownerUserId,
    deviceId: config.deviceId,
    workspaceId: config.workspaceId,
    sessionId: sessionId || config.sessionId
  })
  const query = new URLSearchParams({
    device_id: routing.deviceId,
    workspace_id: routing.workspaceId,
    session_id: routing.sessionId
  })
  const { controller, timer } = createAbortSignal(config.timeoutMs)

  try {
    const response = await fetch(buildUrl(config, `/v1/session_state?${query.toString()}`), {
      headers: { authorization: `Bearer ${config.bearerToken}` },
      signal: controller.signal
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok || !payload) {
      throw new Error(extractErrorMessage(payload, `session state request failed: ${response.status}`))
    }

    return payload
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`session state request timed out after ${config.timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
