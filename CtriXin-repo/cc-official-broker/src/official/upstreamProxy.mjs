import http from "node:http"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"

import {
  buildRemoteServiceHeaders,
  buildRemoteServiceUrl,
  postRemoteAgentEvent
} from "../broker/remoteServiceClient.mjs"

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  })
  res.end(body)
}

async function writeDebugDump(name, payload) {
  const dumpDir = String(process.env.CC_BROKER_OFFICIAL_PROXY_DUMP_DIR || "").trim()
  if (!dumpDir) {
    return
  }

  await mkdir(dumpDir, { recursive: true })
  const filePath = path.join(
    dumpDir,
    `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${name}.json`
  )
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function writeAnthropicError(res, status, message, type = "api_error") {
  jsonResponse(res, status, {
    type: "error",
    error: {
      type,
      message: String(message || "unknown error")
    }
  })
}

function writeSseResponse(res, body) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", chunk => chunks.push(chunk))
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8")
        resolve(text ? JSON.parse(text) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

function systemToInstructions(systemValue) {
  if (typeof systemValue === "string") {
    return systemValue.trim()
  }
  if (!Array.isArray(systemValue)) {
    return ""
  }

  return systemValue
    .map(item => {
      if (typeof item === "string") {
        return item
      }
      if (item && typeof item === "object") {
        return String(item.text || item.content || "")
      }
      return ""
    })
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }]
  }
  if (Array.isArray(content)) {
    return content.filter(item => item && typeof item === "object")
  }
  return []
}

function toolResultText(content) {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return JSON.stringify(content || {})
  }

  return content
    .map(item => {
      if (typeof item === "string") {
        return item
      }
      if (item && typeof item === "object" && item.type === "text") {
        return String(item.text || "")
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function compactText(text = "", limit = 500) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit)}...`
}

function buildMirrorRouting(config, sessionId = "") {
  return {
    owner_user_id: config.ownerUserId || "xin",
    device_id: config.deviceId || "mac",
    workspace_id: config.workspaceId || "personal",
    session_id: String(sessionId || "").trim()
  }
}

async function mirrorAgentEvent(config, routing, eventType, payload = {}, source = "cc-official-broker:official-proxy") {
  if (!config?.remoteServiceBaseUrl || !routing?.session_id) {
    return
  }

  try {
    await postRemoteAgentEvent({
      config,
      routing,
      eventType,
      source,
      payload
    })
  } catch (_error) {
    // Best effort only; proxy output should not fail because mirror logging is unavailable.
  }
}

function extractLatestToolResult(messages = []) {
  const list = Array.isArray(messages) ? messages : []
  for (let messageIndex = list.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = list[messageIndex] || {}
    const content = normalizeMessageContent(message.content)
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const block = content[index] || {}
      if (block.type !== "tool_result") {
        continue
      }
      return {
        toolUseId: String(block.tool_use_id || ""),
        preview: compactText(toolResultText(block.content), 200)
      }
    }
  }
  return null
}

function flattenAnthropicBlock(block = {}) {
  if (!block || typeof block !== "object") {
    return ""
  }

  if (block.type === "text") {
    return String(block.text || "")
  }

  if (block.type === "tool_result") {
    const body = toolResultText(block.content)
    return body ? `[tool_result ${block.tool_use_id || ""}]\n${body}`.trim() : ""
  }

  if (block.type === "tool_use") {
    const input = block.input ? JSON.stringify(block.input) : "{}"
    return `[tool_use ${block.name || ""}] ${input}`.trim()
  }

  return ""
}

function flattenAnthropicMessage(message = {}) {
  return normalizeMessageContent(message.content)
    .map(block => flattenAnthropicBlock(block))
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function buildRemoteInputText(messages = []) {
  const lastMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null
  return flattenAnthropicMessage(lastMessage || {})
}

function buildRemoteContextSummary(messages = []) {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return ""
  }

  return messages
    .slice(0, -1)
    .map(message => {
      const text = compactText(flattenAnthropicMessage(message), 400)
      if (!text) return ""
      return `${String(message?.role || "user")}: ${text}`
    })
    .filter(Boolean)
    .slice(-8)
    .join("\n")
}

function stripSystemReminderTags(text = "") {
  return String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function sanitizeClaudeText(text = "", limit = 4000) {
  const stripped = stripSystemReminderTags(text)
  const normalized = stripped.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit)}...`
}

function summarizeToolSchema(schema = {}) {
  if (!schema || typeof schema !== "object") {
    return {}
  }

  const properties =
    schema.properties && typeof schema.properties === "object"
      ? Object.keys(schema.properties).slice(0, 12)
      : []

  return {
    type: schema.type || "object",
    properties,
    required: Array.isArray(schema.required) ? schema.required.slice(0, 12) : []
  }
}

function buildToolCatalogText(tools = []) {
  return tools
    .map(tool => {
      const schema = summarizeToolSchema(tool?.input_schema || {})
      return JSON.stringify({
        name: String(tool?.name || ""),
        description: compactText(String(tool?.description || ""), 180),
        input_schema: schema
      })
    })
    .filter(Boolean)
    .join("\n")
}

function selectPlannerTools(tools = []) {
  const list = Array.isArray(tools) ? tools.filter(Boolean) : []
  const names = new Set(list.map(tool => String(tool?.name || "")))
  const filtered = []

  const hideBuiltins = new Set()
  if (names.has("mcp__cc-official-broker-runner__read_file")) {
    hideBuiltins.add("Read")
  }
  if (names.has("mcp__cc-official-broker-runner__search")) {
    hideBuiltins.add("Grep")
  }
  if (names.has("mcp__cc-official-broker-runner__bash")) {
    hideBuiltins.add("Bash")
  }
  if (names.has("mcp__cc-official-broker-runner__write_file")) {
    hideBuiltins.add("Write")
  }
  if (names.has("mcp__cc-official-broker-runner__apply_patch")) {
    hideBuiltins.add("Edit")
  }

  for (const tool of list) {
    const name = String(tool?.name || "")
    if (hideBuiltins.has(name)) {
      continue
    }
    filtered.push(tool)
  }

  return filtered.length ? filtered : list
}

function summarizeAnthropicMessages(messages = []) {
  const lines = []

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || "user").toUpperCase()
    for (const block of normalizeMessageContent(message?.content)) {
      if (block.type === "text") {
        const text = sanitizeClaudeText(block.text || "", 1600)
        if (text) {
          lines.push(`${role}: ${text}`)
        }
        continue
      }

      if (block.type === "tool_use") {
        lines.push(
          `${role}_TOOL_USE ${String(block.name || "")}: ${compactText(
            JSON.stringify(block.input || {}),
            1000
          )}`
        )
        continue
      }

      if (block.type === "tool_result") {
        const text = sanitizeClaudeText(toolResultText(block.content), 1600)
        if (text) {
          lines.push(`${role}_TOOL_RESULT ${String(block.tool_use_id || "")}: ${text}`)
        }
      }
    }
  }

  return lines.slice(-16).join("\n")
}

function extractUserAsk(messages = []) {
  if (!Array.isArray(messages) || !messages.length) {
    return ""
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (!item || item.role !== "user") {
      continue
    }
    const text = normalizeMessageContent(item.content)
      .filter(block => block.type === "text")
      .map(block => sanitizeClaudeText(block.text || "", 2000))
      .filter(Boolean)
      .join("\n\n")
      .trim()
    if (text) {
      return text
    }
  }

  return ""
}

function buildPlannerPrompt(request = {}) {
  const tools = selectPlannerTools(request.tools)
  const transcript = summarizeAnthropicMessages(request.messages || [])
  const userAsk = extractUserAsk(request.messages || [])
  const toolChoice = normalizeToolChoice(request.tool_choice)
  const toolChoiceText =
    typeof toolChoice === "string"
      ? toolChoice
      : toolChoice && typeof toolChoice === "object"
        ? JSON.stringify(toolChoice)
        : "auto"

  return [
    "You are the remote planning brain behind a local Claude Code session.",
    "The local host can execute the tools listed below and send back tool results.",
    "Never claim the session is read-only, advisory-only, or unable to use tools.",
    "Decide the single best next action.",
    "If the answer depends on reading a file, searching code, or running a command, you MUST return type=tool_use.",
    "Never describe an intended tool action in plain text. Return the tool call instead.",
    "When returning type=final, keep content concise, complete, and under 1200 Chinese characters.",
    "Do not truncate JSON, do not use code fences, and do not wrap the JSON in extra commentary.",
    "Return valid JSON only with one of these shapes:",
    '{"type":"tool_use","name":"<tool name>","arguments":{...},"prelude":"optional short user-facing text"}',
    '{"type":"final","content":"final user-facing answer"}',
    `tool_choice: ${toolChoiceText}`,
    "",
    "available_tools:",
    buildToolCatalogText(tools),
    "",
    "conversation_transcript:",
    transcript || "(empty)",
    "",
    "latest_user_request:",
    userAsk || "(empty)"
  ].join("\n")
}

function buildPlannerResponseFormat() {
  return {
    text: {
      format: {
        type: "json_schema",
        name: "planner_decision",
        strict: true,
        schema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                type: {
                  type: "string",
                  const: "tool_use"
                },
                name: {
                  type: "string"
                },
                arguments: {
                  type: "object",
                  additionalProperties: true
                },
                prelude: {
                  type: "string"
                }
              },
              required: ["type", "name", "arguments"]
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                type: {
                  type: "string",
                  const: "final"
                },
                content: {
                  type: "string"
                }
              },
              required: ["type", "content"]
            }
          ]
        }
      }
    }
  }
}

function tryParseJsonObject(text = "") {
  const raw = String(text || "").trim()
  if (!raw) {
    return null
  }

  const candidates = [raw]
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim())
  }

  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object") {
        return parsed
      }
    } catch {
      // ignore
    }
  }

  return null
}

function decodePlannerJsonStringFragment(fragment = "") {
  const raw = String(fragment || "")
    .replace(/"}?\s*$/, "")
    .trim()

  if (!raw) {
    return ""
  }

  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
  }
}

function trySalvagePlannerDecision(text = "", availableTools = []) {
  const raw = String(text || "").trim()
  if (!raw) {
    return null
  }

  const finalPrefix = "{\"type\":\"final\",\"content\":\""
  if (raw.startsWith(finalPrefix)) {
    return {
      type: "final",
      content: decodePlannerJsonStringFragment(raw.slice(finalPrefix.length))
    }
  }

  const toolPrefix = "{\"type\":\"tool_use\",\"name\":\""
  if (raw.startsWith(toolPrefix)) {
    const toolNameEnd = raw.indexOf("\",\"arguments\":")
    if (toolNameEnd <= toolPrefix.length) {
      return null
    }

    const toolName = raw.slice(toolPrefix.length, toolNameEnd)
    const available = new Set((availableTools || []).map(tool => String(tool?.name || "")))
    if (!available.has(toolName)) {
      return null
    }

    const argsStart = raw.indexOf("{", toolNameEnd)
    if (argsStart < 0) {
      return {
        type: "tool_use",
        name: toolName,
        arguments: {},
        prelude: ""
      }
    }

    const preludeMarker = ",\"prelude\":\""
    const preludeIndex = raw.indexOf(preludeMarker, argsStart)
    const argsText =
      preludeIndex >= 0
        ? raw.slice(argsStart, preludeIndex)
        : raw.slice(argsStart).replace(/}\s*$/, "}")

    let parsedArgs = {}
    try {
      parsedArgs = JSON.parse(argsText.endsWith("}") ? argsText : `${argsText}}`)
    } catch {
      parsedArgs = {}
    }

    const prelude =
      preludeIndex >= 0
        ? decodePlannerJsonStringFragment(raw.slice(preludeIndex + preludeMarker.length))
        : ""

    return {
      type: "tool_use",
      name: toolName,
      arguments: parsedArgs,
      prelude
    }
  }

  return null
}

function inferToolArgsFromNextStep(stepText = "", toolName = "") {
  const raw = String(stepText || "").trim()
  if (!raw || !toolName) {
    return null
  }

  if (toolName === "mcp__cc-official-broker-runner__read_file") {
    const readMatch = raw.match(/^Read\s+(.+?)\s+via\s+/i)
    if (readMatch?.[1]) {
      return { path: String(readMatch[1]).trim() }
    }
  }

  if (toolName === "Read") {
    const readMatch = raw.match(/^Read\s+(.+?)\s+via\s+/i)
    if (readMatch?.[1]) {
      return { file_path: String(readMatch[1]).trim() }
    }
  }

  if (toolName === "Bash") {
    const runMatch = raw.match(/^Run\s+(.+?)\s+via\s+/i)
    if (runMatch?.[1]) {
      return { command: String(runMatch[1]).trim() }
    }
  }

  return null
}

function inferDecisionFromCcMeta(payload = {}, availableTools = []) {
  const nextSteps = Array.isArray(payload?.cc_meta?.next_steps) ? payload.cc_meta.next_steps : []
  if (!nextSteps.length) {
    return null
  }

  const available = new Set((availableTools || []).map(tool => String(tool?.name || "")))
  for (const step of nextSteps) {
    const match = String(step || "").match(/\bvia\s+([A-Za-z0-9_:-]+)\s*$/i)
    const toolName = String(match?.[1] || "")
    if (!toolName || !available.has(toolName)) {
      continue
    }

    const inferredArgs = inferToolArgsFromNextStep(step, toolName)
    return {
      type: "tool_use",
      name: toolName,
      arguments: inferredArgs || {},
      prelude: ""
    }
  }

  return null
}

function parsePlannerDecision(payload = {}, availableTools = []) {
  const blocks = extractResponsesBlocks(payload)
  const text = blocks
    .filter(block => block.type === "text")
    .map(block => String(block.text || ""))
    .join("\n")
    .trim()

  const parsed = tryParseJsonObject(text)
  const available = new Set((availableTools || []).map(tool => String(tool?.name || "")))

  if (parsed?.type === "tool_use" && available.has(String(parsed.name || ""))) {
    return {
      type: "tool_use",
      name: String(parsed.name || ""),
      arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {},
      prelude: String(parsed.prelude || "").trim()
    }
  }

  if (parsed?.type === "final") {
    return {
      type: "final",
      content: String(parsed.content || "").trim()
    }
  }

  const salvaged = trySalvagePlannerDecision(text, availableTools)
  if (salvaged?.type === "tool_use" && available.has(String(salvaged.name || ""))) {
    return {
      type: "tool_use",
      name: String(salvaged.name || ""),
      arguments: salvaged.arguments && typeof salvaged.arguments === "object" ? salvaged.arguments : {},
      prelude: String(salvaged.prelude || "").trim()
    }
  }

  if (salvaged?.type === "final") {
    return {
      type: "final",
      content: String(salvaged.content || "").trim()
    }
  }

  const inferred = inferDecisionFromCcMeta(payload, availableTools)
  if (inferred?.type === "tool_use" && available.has(String(inferred.name || ""))) {
    return {
      type: "tool_use",
      name: String(inferred.name || ""),
      arguments: inferred.arguments && typeof inferred.arguments === "object" ? inferred.arguments : {},
      prelude: ""
    }
  }

  return {
    type: "final",
    content: text
  }
}

function contentBlockToResponses(block, role = "user") {
  const blockType = block.type
  if (blockType === "text") {
    return {
      type: role === "assistant" ? "output_text" : "input_text",
      text: String(block.text || "")
    }
  }
  if (blockType === "image") {
    const source = block.source || {}
    if (source.type === "base64") {
      const mediaType = source.media_type || "image/png"
      return {
        type: "input_image",
        image_url: `data:${mediaType};base64,${source.data || ""}`
      }
    }
  }
  return null
}

function anthropicMessagesToResponsesInput(messages = []) {
  const items = []

  for (const message of messages) {
    const role = String(message?.role || "user")
    const textParts = []

    const flushTextParts = currentRole => {
      if (!textParts.length) return
      items.push({
        type: "message",
        role: currentRole,
        content: [...textParts]
      })
      textParts.length = 0
    }

    for (const block of normalizeMessageContent(message?.content)) {
      const blockType = block.type
      if (blockType === "text" || blockType === "image") {
        const converted = contentBlockToResponses(block, role)
        if (converted) {
          textParts.push(converted)
        }
        continue
      }

      if (blockType === "tool_use") {
        flushTextParts(role)
        items.push({
          type: "function_call",
          call_id: String(block.id || ""),
          name: String(block.name || ""),
          arguments: JSON.stringify(block.input || {})
        })
        continue
      }

      if (blockType === "tool_result") {
        flushTextParts(role)
        items.push({
          type: "function_call_output",
          call_id: String(block.tool_use_id || ""),
          output: toolResultText(block.content)
        })
      }
    }

    flushTextParts(role)
  }

  return items
}

function anthropicToolsToResponses(tools = []) {
  const converted = []
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue
    converted.push({
      type: "function",
      name: String(tool.name || ""),
      description: String(tool.description || ""),
      parameters: tool.input_schema || { type: "object", properties: {} }
    })
  }
  return converted
}

function normalizeToolChoice(toolChoice) {
  if (!toolChoice) {
    return null
  }
  if (typeof toolChoice === "string") {
    return toolChoice
  }
  if (toolChoice && typeof toolChoice === "object") {
    if (toolChoice.type === "tool" && toolChoice.name) {
      return {
        type: "function",
        name: String(toolChoice.name)
      }
    }
    return toolChoice
  }
  return null
}

function approxTokenCount(payload = {}) {
  const parts = []
  const system = systemToInstructions(payload.system)
  if (system) {
    parts.push(system)
  }

  for (const message of payload.messages || []) {
    for (const block of normalizeMessageContent(message?.content)) {
      if (block.type === "text") {
        parts.push(String(block.text || ""))
      } else if (block.type === "tool_use") {
        parts.push(JSON.stringify(block.input || {}))
      } else if (block.type === "tool_result") {
        parts.push(toolResultText(block.content))
      }
    }
  }

  const combined = parts.join("\n")
  return Math.max(1, Math.ceil(combined.length / 4))
}

function mapUsage(usage = {}) {
  const inputTokens =
    usage.input_tokens ??
    usage.prompt_tokens ??
    0
  const outputTokens =
    usage.output_tokens ??
    usage.completion_tokens ??
    0

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens
  }
}

function extractResponsesBlocks(payload = {}) {
  const blocks = []

  for (const item of payload.output || []) {
    if (!item || typeof item !== "object") continue

    if (item.type === "message") {
      for (const content of item.content || []) {
        if (!content || typeof content !== "object") continue
        if (content.type === "output_text" || content.type === "text") {
          blocks.push({
            type: "text",
            text: String(content.text || "")
          })
        }
      }
      continue
    }

    if (item.type === "function_call") {
      let parsedInput = {}
      try {
        parsedInput = item.arguments ? JSON.parse(item.arguments) : {}
      } catch {
        parsedInput = {}
      }

      blocks.push({
        type: "tool_use",
        id: String(item.call_id || item.id || `toolu_${randomUUID().replace(/-/g, "")}`),
        name: String(item.name || ""),
        input: parsedInput
      })
    }
  }

  return blocks
}

function extractChatBlocks(payload = {}) {
  const blocks = []
  const choice = payload.choices?.[0] || {}
  const message = choice.message || {}
  const content = message.content

  if (typeof content === "string" && content) {
    blocks.push({
      type: "text",
      text: content
    })
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        blocks.push({ type: "text", text: item })
        continue
      }
      if (item && typeof item === "object" && item.text) {
        blocks.push({ type: "text", text: String(item.text) })
      }
    }
  }

  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {}
    let parsedInput = {}
    try {
      parsedInput = fn.arguments ? JSON.parse(fn.arguments) : {}
    } catch {
      parsedInput = {}
    }
    blocks.push({
      type: "tool_use",
      id: String(toolCall.id || `toolu_${randomUUID().replace(/-/g, "")}`),
      name: String(fn.name || ""),
      input: parsedInput
    })
  }

  return blocks
}

function buildAnthropicMessage({
  payload,
  requestedModel,
  responseId = "",
  remoteSessionId = "",
  responseMode = null
}) {
  let blocks = []
  if (responseMode?.kind === "tool_orchestrator") {
    const decision = parsePlannerDecision(payload, responseMode.availableTools || [])
    if (decision.type === "tool_use") {
      if (decision.prelude) {
        blocks.push({
          type: "text",
          text: decision.prelude
        })
      }
      blocks.push({
        type: "tool_use",
        id: `toolu_${randomUUID().replace(/-/g, "")}`,
        name: decision.name,
        input: decision.arguments || {}
      })
    } else {
      blocks = [
        {
          type: "text",
          text: decision.content || "(empty)"
        }
      ]
    }
  } else {
    blocks =
      Array.isArray(payload.output)
        ? extractResponsesBlocks(payload)
        : extractChatBlocks(payload)
  }

  const usage = mapUsage(payload.cc_meta?.usage || payload.usage || {})
  const stopReason = blocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn"

  return {
    id: responseId || payload.id || `msg_${randomUUID().replace(/-/g, "")}`,
    type: "message",
    role: "assistant",
    model: requestedModel || "claude-sonnet-4-6",
    content: blocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
    _cc_meta: payload.cc_meta || null,
    _remote_session_id: remoteSessionId || ""
  }
}

function buildAnthropicSseBody(message) {
  const usage = mapUsage(message.usage || {})
  const start = {
    id: message.id,
    type: "message",
    role: "assistant",
    model: message.model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: 0
    }
  }

  const events = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: start })}\n\n`
  ]

  for (const [index, block] of message.content.entries()) {
    const contentBlock =
      block.type === "tool_use"
        ? {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {}
          }
        : {
            type: "text",
            text: ""
          }

    events.push(
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index,
        content_block: contentBlock
      })}\n\n`
    )

    if (block.type === "tool_use") {
      events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input || {})
          }
        })}\n\n`
      )
    } else {
      events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index,
          delta: {
            type: "text_delta",
            text: String(block.text || "")
          }
        })}\n\n`
      )
    }

    events.push(
      `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index
      })}\n\n`
    )
  }

  events.push(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: {
        stop_reason: message.stop_reason || "end_turn",
        stop_sequence: null
      },
      usage: {
        output_tokens: usage.output_tokens || 0
      }
    })}\n\n`
  )
  events.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`)

  return events.join("")
}

function normalizePath(reqUrl = "/") {
  return new URL(reqUrl, "http://127.0.0.1").pathname
}

async function fetchRemoteJson(config, body) {
  const response = await fetch(buildRemoteServiceUrl(config, "/v1/responses"), {
    method: "POST",
    headers: buildRemoteServiceHeaders(config),
    body: JSON.stringify(body)
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      `remote service request failed: ${response.status}`
    throw new Error(message)
  }

  return payload
}

async function fetchRemoteModels(config) {
  const response = await fetch(buildRemoteServiceUrl(config, "/v1/models"), {
    headers: buildRemoteServiceHeaders(config)
  })

  if (!response.ok) {
    return {
      object: "list",
      data: [
        {
          id: config.remoteServiceModel || "claude-opus-4-6",
          object: "model",
          owned_by: "cc-official-broker"
        }
      ]
    }
  }

  return await response.json().catch(() => ({
    object: "list",
    data: []
  }))
}

function buildRemoteResponsesBody(config, state, request) {
  const messages = request.messages || []
  const tools = selectPlannerTools(request.tools)
  const basePayload = {
    model: config.remoteServiceModel || request.model || "claude-opus-4-6",
    stream: false,
    metadata: {
      owner_user_id: config.ownerUserId,
      device_id: config.deviceId,
      workspace_id: config.workspaceId,
      session_id: state.sessionId,
      source: "cc-official-broker:official-proxy",
      requested_model: String(request.model || ""),
      skip_session_state_persist: true
    }
  }

  if (state.previousResponseId) {
    basePayload.previous_response_id = state.previousResponseId
  }

  if (request.max_tokens) {
    basePayload.max_output_tokens = request.max_tokens
  }

  if (tools.length) {
    return {
      remoteRequest: {
        ...basePayload,
        input: buildPlannerPrompt(request),
        ...buildPlannerResponseFormat()
      },
      responseMode: {
        kind: "tool_orchestrator",
        availableTools: tools
      }
    }
  }

  const payload = {
    ...basePayload,
    input: sanitizeClaudeText(buildRemoteInputText(messages), 4000)
  }

  const contextSummary = sanitizeClaudeText(buildRemoteContextSummary(messages), 2000)
  if (contextSummary) {
    payload.context_summary = contextSummary
  }

  return {
    remoteRequest: payload,
    responseMode: {
      kind: "consult"
    }
  }
}

export async function startOfficialUpstreamProxy(config, overrides = {}) {
  if (!config.remoteServiceBaseUrl) {
    throw new Error("CC_BROKER_REMOTE_SERVICE_BASE_URL is required")
  }
  if (!config.remoteServiceBearerToken && !config.remoteServiceApiKey) {
    throw new Error("remote service auth is required for official proxy")
  }

  const host = overrides.host || "127.0.0.1"
  const port = overrides.port || 0
  const bridgeToken = overrides.bridgeToken || `official-proxy-${randomUUID()}`
  const state = {
    sessionId: overrides.sessionId || `official-proxy-${Date.now().toString(36)}`,
    previousResponseId: String(overrides.previousResponseId || ""),
    remoteSessionId: String(overrides.remoteSessionId || "")
  }

  const server = http.createServer(async (req, res) => {
    const pathname = normalizePath(req.url || "/")
    const authHeader = String(req.headers.authorization || "")
    const expected = `Bearer ${bridgeToken}`

    if (authHeader !== expected && pathname !== "/healthz") {
      writeAnthropicError(res, 401, "invalid bridge auth token", "authentication_error")
      return
    }

    if (req.method === "GET" && pathname === "/healthz") {
      jsonResponse(res, 200, {
        ok: true,
        service: "cc-official-broker-official-proxy",
        session_id: state.sessionId
      })
      return
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      try {
        jsonResponse(res, 200, await fetchRemoteModels(config))
      } catch (error) {
        writeAnthropicError(res, 500, error instanceof Error ? error.message : String(error))
      }
      return
    }

    if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
      try {
        const body = await readJsonBody(req)
        jsonResponse(res, 200, {
          input_tokens: approxTokenCount(body)
        })
      } catch (error) {
        writeAnthropicError(res, 400, error instanceof Error ? error.message : String(error), "invalid_request_error")
      }
      return
    }

    if (req.method === "POST" && pathname === "/v1/messages") {
      let body = null
      try {
        body = await readJsonBody(req)
      } catch (error) {
        writeAnthropicError(res, 400, error instanceof Error ? error.message : String(error), "invalid_request_error")
        return
      }

      try {
        const built = buildRemoteResponsesBody(config, state, body || {})
        const builtPayload = built.remoteRequest
        const routing = buildMirrorRouting(config, state.sessionId)
        const requestId = `official-${Date.now().toString(36)}`
        const inputPreview = compactText(
          extractUserAsk(body?.messages || []) ||
            buildRemoteInputText(body?.messages || []) ||
            summarizeAnthropicMessages(body?.messages || []),
          160
        )
        const latestToolResult = extractLatestToolResult(body?.messages || [])

        await mirrorAgentEvent(config, routing, "prompt.submitted", {
          request_id: requestId,
          remote_session_id: state.remoteSessionId || "",
          input_preview: inputPreview
        })
        if (latestToolResult?.preview) {
          await mirrorAgentEvent(config, routing, "tool.result", {
            request_id: requestId,
            remote_session_id: state.remoteSessionId || "",
            tool_name: latestToolResult.toolUseId ? `tool_result:${latestToolResult.toolUseId}` : "tool_result",
            tool_result_preview: latestToolResult.preview
          })
        }

        await writeDebugDump("anthropic-request", body || {})
        await writeDebugDump("remote-request", builtPayload)

        const remotePayload = await fetchRemoteJson(config, builtPayload)
        await writeDebugDump("remote-response", remotePayload)
        state.previousResponseId = String(remotePayload.id || state.previousResponseId || "")
        state.remoteSessionId = String(remotePayload.cc_meta?.meta?.remote_session_id || state.remoteSessionId || "")

        const message = buildAnthropicMessage({
          payload: remotePayload,
          requestedModel: String(body?.model || ""),
          responseId: state.previousResponseId,
          remoteSessionId: state.remoteSessionId,
          responseMode: built.responseMode
        })
        await writeDebugDump("anthropic-response", message)

        const toolUseBlocks = Array.isArray(message.content)
          ? message.content.filter(block => block?.type === "tool_use")
          : []
        if (toolUseBlocks.length) {
          for (const block of toolUseBlocks) {
            await mirrorAgentEvent(config, routing, "tool.call", {
              request_id: state.previousResponseId || requestId,
              remote_session_id: state.remoteSessionId || "",
              tool_name: String(block.name || ""),
              tool_args_preview: compactText(JSON.stringify(block.input || {}), 200)
            })
          }
        } else {
          const textOutput = compactText(flattenAnthropicMessage(message), 200)
          await mirrorAgentEvent(config, routing, "turn.completed", {
            request_id: state.previousResponseId || requestId,
            remote_session_id: state.remoteSessionId || "",
            input_preview: inputPreview,
            output_preview: textOutput,
            usage: remotePayload.cc_meta?.usage || remotePayload.usage || null,
            cost_usd: remotePayload.cc_meta?.cost_usd ?? null,
            target_model: String(body?.model || config.remoteServiceModel || ""),
            runtime_id: remotePayload.cc_meta?.meta?.runtime_id || "",
            reused_remote_session: Boolean(remotePayload.cc_meta?.meta?.reused_remote_session)
          })
        }

        if (body?.stream === true) {
          writeSseResponse(res, buildAnthropicSseBody(message))
          return
        }

        jsonResponse(res, 200, message)
      } catch (error) {
        await mirrorAgentEvent(config, buildMirrorRouting(config, state.sessionId), "turn.failed", {
          request_id: `official-fail-${Date.now().toString(36)}`,
          remote_session_id: state.remoteSessionId || "",
          error: error instanceof Error ? error.message : String(error)
        })
        writeAnthropicError(res, 500, error instanceof Error ? error.message : String(error))
      }
      return
    }

    writeAnthropicError(res, 404, `unsupported path: ${pathname}`, "not_found_error")
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })

  const address = server.address()
  const resolvedPort = typeof address === "object" && address ? address.port : port

  return {
    ok: true,
    baseUrl: `http://${host}:${resolvedPort}`,
    bridgeToken,
    state,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    }
  }
}
