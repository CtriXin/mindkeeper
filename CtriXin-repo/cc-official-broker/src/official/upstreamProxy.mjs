import http from "node:http"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"

import {
  buildRemoteServiceHeaders,
  buildRemoteServiceUrl,
  postRemoteAgentEvent
} from "../broker/remoteServiceClient.mjs"

class PlannerBoundaryError extends Error {
  constructor(message, { status = 409, type = "invalid_request_error", code = "planner_boundary_violation" } = {}) {
    super(message)
    this.name = "PlannerBoundaryError"
    this.status = status
    this.type = type
    this.code = code
  }
}

const RUNNER_TOOL_PREFIX = "mcp__cc-official-broker-runner__"
const RUNNER_TOOL = {
  bash: `${RUNNER_TOOL_PREFIX}bash`,
  writeFile: `${RUNNER_TOOL_PREFIX}write_file`,
  applyPatch: `${RUNNER_TOOL_PREFIX}apply_patch`
}

const BUILTIN_MUTATION_TO_RUNNER = new Map([
  ["Bash", RUNNER_TOOL.bash],
  ["Write", RUNNER_TOOL.writeFile],
  ["Edit", RUNNER_TOOL.applyPatch],
  ["MultiEdit", RUNNER_TOOL.applyPatch],
  ["NotebookEdit", RUNNER_TOOL.applyPatch]
])

const FILE_EXT_PATTERN = "(?:ts|js|mjs|json|md|txt|yaml|yml|toml|py|go|rs|vue|jsx|tsx|css|html|sh|env|lock|conf|ini|cfg)"

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

function writeAnthropicError(res, status, message, type = "api_error", code = "") {
  const normalizedCode = String(code || "").trim()
  jsonResponse(res, status, {
    type: "error",
    error: {
      type,
      message: String(message || "unknown error"),
      ...(normalizedCode ? { code: normalizedCode } : {})
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
    hideBuiltins.add("MultiEdit")
    hideBuiltins.add("NotebookEdit")
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

function getAvailableToolNames(tools = []) {
  return new Set((Array.isArray(tools) ? tools : []).map(tool => String(tool?.name || "")).filter(Boolean))
}

function normalizeToolChoiceName(toolChoice) {
  if (toolChoice && typeof toolChoice === "object" && (toolChoice.type === "tool" || toolChoice.type === "function")) {
    return String(toolChoice.name || "")
  }
  return ""
}

function findLatestUserTextMessageIndex(messages = []) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (!message || message.role !== "user") {
      continue
    }
    const hasText = normalizeMessageContent(message.content).some(
      block => block?.type === "text" && sanitizeClaudeText(block.text || "", 2000)
    )
    if (hasText) {
      return index
    }
  }
  return -1
}

function latestMessageIsToolResultOnly(messages = []) {
  const list = Array.isArray(messages) ? messages : []
  const last = list[list.length - 1]
  if (!last || last.role !== "user") {
    return false
  }

  const blocks = normalizeMessageContent(last.content)
  if (!blocks.length) {
    return false
  }

  let hasToolResult = false
  for (const block of blocks) {
    if (block?.type === "tool_result") {
      hasToolResult = true
      continue
    }
    if (block?.type === "text" && !sanitizeClaudeText(block.text || "", 2000)) {
      continue
    }
    return false
  }

  return hasToolResult
}

function buildToolNameByUseId(messages = []) {
  const mapping = new Map()
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const block of normalizeMessageContent(message.content)) {
      if (block?.type !== "tool_use") {
        continue
      }
      const id = String(block.id || "").trim()
      const name = String(block.name || "").trim()
      if (id && name) {
        mapping.set(id, name)
      }
    }
  }
  return mapping
}

function evaluateToolResultEvidence(messages = [], startIndex = -1, expectedToolNames = []) {
  const list = Array.isArray(messages) ? messages : []
  const expected = new Set((Array.isArray(expectedToolNames) ? expectedToolNames : []).map(name => String(name || "")).filter(Boolean))
  const toolNameByUseId = buildToolNameByUseId(list)
  let totalToolResults = 0
  let matchedToolResults = 0
  let unresolvedToolResults = 0

  for (let messageIndex = Math.max(0, startIndex + 1); messageIndex < list.length; messageIndex += 1) {
    const message = list[messageIndex] || {}
    for (const block of normalizeMessageContent(message.content)) {
      if (block?.type !== "tool_result") {
        continue
      }

      totalToolResults += 1
      const toolUseId = String(block.tool_use_id || "").trim()
      const toolName = toolUseId ? toolNameByUseId.get(toolUseId) : ""
      if (!toolName) {
        unresolvedToolResults += 1
        continue
      }
      if (expected.has(toolName)) {
        matchedToolResults += 1
      }
    }
  }

  return {
    totalToolResults,
    matchedToolResults,
    unresolvedToolResults
  }
}

function hasSatisfiedLocalExecution(messages = [], latestUserAskIndex = -1, expectedToolNames = []) {
  if (latestUserAskIndex < 0) {
    return false
  }

  const evidence = evaluateToolResultEvidence(messages, latestUserAskIndex, expectedToolNames)
  // Only matched tool_results count as satisfied.
  // Unresolved tool_results (tool_use_id not found in history) are NOT sufficient —
  // they may come from history truncation or unrelated tool calls.
  return evidence.matchedToolResults > 0
}

function stripOuterQuotes(value = "") {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }

  return text.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim()
}

function extractExactReplyLiteral(userAsk = "") {
  const ask = String(userAsk || "").trim()
  if (!ask) {
    return ""
  }

  const patterns = [
    /(?:只回复|只输出|回复时只写|最后只回复)\s*["'“”‘’`]?([A-Za-z0-9._-]+)["'“”‘’`]?/i,
    /reply\s+with\s+exactly\s+["'“”‘’`]?([A-Za-z0-9._-]+)["'“”‘’`]?/i
  ]
  for (const pattern of patterns) {
    const match = ask.match(pattern)
    if (match?.[1]) {
      return String(match[1]).trim()
    }
  }
  return ""
}

function looksLikePlannerNoise(text = "") {
  const raw = String(text || "").trim()
  if (!raw) {
    return false
  }
  if (/[✻✶✽✢]/.test(raw)) {
    return true
  }
  const compact = raw.replace(/\s+/g, "")
  if (!compact) {
    return false
  }
  const shortFragments = raw
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  return shortFragments.length >= 3 && shortFragments.every(line => line.length <= 4)
}

function extractCreateFileIntent(userAsk = "") {
  const ask = String(userAsk || "").trim()
  if (!ask) {
    return null
  }

  const fileMatch = ask.match(new RegExp(`([A-Za-z0-9_./-]+\\.${FILE_EXT_PATTERN})\\b`, "i"))
  if (!fileMatch?.[1]) {
    return null
  }

  if (
    !/(?:创建|新建|添加|生成|写一个|加(?:一个|个)?|create|add|write)/i.test(ask)
  ) {
    return null
  }

  let content = ""
  const markers = [
    /(?:里面写|内容(?:写成|是)?|文件内容(?:写成|是)?|写入|写上?)\s*([\s\S]+)$/i,
    /with\s+(?:exactly\s+)?(?:content|text)\s*[:：]?\s*([\s\S]+)$/i
  ]
  for (const pattern of markers) {
    const match = ask.match(pattern)
    if (!match?.[1]) {
      continue
    }
    content = String(match[1] || "").trim()
    break
  }

  if (content) {
    content = content
      .split(/(?:。|，|；|,|;)\s*(?:用本地工具|使用本地工具|完成后|然后|最后|并|再|只回复|只输出|reply with exactly)/i)[0]
      .split(/\r?\n/)[0]
      .trim()
  }

  return {
    path: String(fileMatch[1]).trim(),
    content: stripOuterQuotes(content)
  }
}

function inferDecisionFromUserAsk(userAsk = "", availableTools = [], policy = {}) {
  const available = getAvailableToolNames(availableTools)
  const createFile = extractCreateFileIntent(userAsk)
  if (policy?.requireToolDecision && createFile?.path) {
    const toolName = available.has(RUNNER_TOOL.writeFile)
      ? RUNNER_TOOL.writeFile
      : available.has("Write")
        ? "Write"
        : ""
    if (toolName) {
      return {
        type: "tool_use",
        name: toolName,
        arguments:
          toolName === RUNNER_TOOL.writeFile
            ? {
                path: createFile.path,
                content: createFile.content || ""
              }
            : {
                file_path: createFile.path,
                content: createFile.content || ""
              },
        prelude: ""
      }
    }
  }

  const exactReply = extractExactReplyLiteral(policy?.userAsk || userAsk)
  if (exactReply && looksLikePlannerNoise(policy?.rawPlannerText || "")) {
    return {
      type: "final",
      content: exactReply
    }
  }

  return null
}

function buildLocalShortcutDecision(request = {}, availableTools = [], plannerPolicy = {}) {
  const userAsk = String(plannerPolicy?.userAsk || extractUserAsk(request.messages || []) || "").trim()
  if (!/[一-龥]/.test(userAsk) || !/(?:在当前|里面写|添加|新建|创建)/.test(userAsk)) {
    return null
  }
  const createFile = extractCreateFileIntent(userAsk)
  if (!createFile?.path) {
    return null
  }

  const messages = Array.isArray(request.messages) ? request.messages : []
  const latestUserAskIndex = findLatestUserTextMessageIndex(messages)
  const completionTools = [
    RUNNER_TOOL.writeFile,
    RUNNER_TOOL.applyPatch,
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit"
  ]

  if (!hasSatisfiedLocalExecution(messages, latestUserAskIndex, completionTools)) {
    return inferDecisionFromUserAsk(userAsk, availableTools, {
      ...plannerPolicy,
      requireToolDecision: true
    })
  }

  return {
    type: "final",
    content: extractExactReplyLiteral(userAsk) || `已在当前目录创建 ${createFile.path}`
  }
}

function shouldRequireLocalFileMutationTool(userAsk = "", explicitToolName = "") {
  const ask = String(userAsk || "")
  const explicit = String(explicitToolName || "")
  if (
    explicit === "Write" ||
    explicit === "Edit" ||
    explicit === "MultiEdit" ||
    explicit === "NotebookEdit" ||
    explicit === RUNNER_TOOL.writeFile ||
    explicit === RUNNER_TOOL.applyPatch
  ) {
    return true
  }

  // Filename/path intent patterns — detect file mutation intent via filename presence
  const filenamePatterns = [
    // "把 README.md ... 改成", "把 src/foo.ts ... 加"
    new RegExp(`把.{0,60}\\.${FILE_EXT_PATTERN}\\b.{0,30}(?:改|加|删|修|替换)`),
    // "在 src/foo.ts 里加/删/改"
    new RegExp(`在.{0,60}\\.${FILE_EXT_PATTERN}\\b.{0,30}里?(?:加|删|改|插入)`),
    // "添加一个 foo.html", "新建 bar.md"
    new RegExp(`(?:创建|新建|添加|生成|加(?:一个|个)?).{0,20}\\.${FILE_EXT_PATTERN}\\b`),
    // "修改这个文件", "编辑下面的文件"
    /(?:修改|编辑|更新|改一下|改下)(?:这个|下面的|下面这个)?(?:文件|file)/,
    // English: "change/update/edit <filename>", "add line to src/foo.ts"
    new RegExp(`\\b(?:change|update|edit|modify|add|remove|delete|replace)\\b.{0,50}\\.${FILE_EXT_PATTERN}\\b`, "i"),
    // English: "create/write <filename>"
    new RegExp(`\\b(?:create|write|append)\\b.{0,50}\\.${FILE_EXT_PATTERN}\\b`, "i")
  ]

  const patterns = [
    /\b(create|write|append|overwrite)\b.{0,30}\b(file|files)\b/i,
    /\b(edit|modify|update|patch|replace|delete|remove|rename)\b.{0,30}\b(file|files)\b/i,
    /\bapply[_\s-]?patch\b/i,
    /(创建|新建|写入|追加|覆盖).{0,12}(文件|file)/,
    /(修改|编辑|替换|补丁|删除|重命名).{0,12}(文件|file)/
  ]
  return (
    patterns.some(pattern => pattern.test(ask)) ||
    filenamePatterns.some(pattern => pattern.test(ask)) ||
    Boolean(extractCreateFileIntent(ask))
  )
}

function shouldRequireLocalBashTool(userAsk = "", explicitToolName = "") {
  const ask = String(userAsk || "")
  const explicit = String(explicitToolName || "")
  if (explicit === "Bash" || explicit === RUNNER_TOOL.bash) {
    return true
  }

  const patterns = [
    /\b(run|execute)\b.{0,30}\b(command|bash|shell|script|npm|pnpm|yarn|node|python|git|make|cargo)\b/i,
    /\b(bash|shell|terminal)\b.{0,20}\b(command|script)\b/i,
    /(执行|运行).{0,12}(命令|bash|shell|脚本|终端)/
  ]
  return patterns.some(pattern => pattern.test(ask))
}

function buildPlannerPolicy(request = {}, availableTools = []) {
  const messages = Array.isArray(request.messages) ? request.messages : []
  const userAsk = extractUserAsk(request.messages || [])
  const latestUserAskIndex = findLatestUserTextMessageIndex(messages)
  const explicitToolName = normalizeToolChoiceName(normalizeToolChoice(request.tool_choice))
  const availableNames = getAvailableToolNames(availableTools)
  const requiredGroups = []

  if (shouldRequireLocalFileMutationTool(userAsk, explicitToolName)) {
    requiredGroups.push({
      label: "local write/edit",
      advertisedTools: [RUNNER_TOOL.writeFile, RUNNER_TOOL.applyPatch],
      completionTools: [
        RUNNER_TOOL.writeFile,
        RUNNER_TOOL.applyPatch,
        "Write",
        "Edit",
        "MultiEdit",
        "NotebookEdit"
      ]
    })
  }

  if (shouldRequireLocalBashTool(userAsk, explicitToolName)) {
    requiredGroups.push({
      label: "local bash",
      advertisedTools: [RUNNER_TOOL.bash],
      completionTools: [RUNNER_TOOL.bash, "Bash"]
    })
  }

  const missingGroups = requiredGroups.filter(
    group => !group.advertisedTools.some(toolName => availableNames.has(toolName))
  )
  const pendingGroups = requiredGroups.filter(
    group => !hasSatisfiedLocalExecution(messages, latestUserAskIndex, group.completionTools)
  )

  return {
    userAsk,
    requireToolDecision: pendingGroups.length > 0,
    requiredGroups,
    pendingGroups,
    missingGroups
  }
}

function mapMutatingBuiltinToRunner(toolName = "", availableTools = []) {
  const name = String(toolName || "")
  const mapped = BUILTIN_MUTATION_TO_RUNNER.get(name)
  if (!mapped) {
    return name
  }

  const availableNames = getAvailableToolNames(availableTools)
  return availableNames.has(mapped) ? mapped : name
}

function validatePlannerPolicy(policy = {}) {
  const missingGroups = Array.isArray(policy?.missingGroups) ? policy.missingGroups : []
  if (!missingGroups.length) {
    return
  }

  const labels = missingGroups.map(group => String(group.label || "required local tool")).join(", ")
  throw new PlannerBoundaryError(
    `local execution guard blocked this request: missing advertised ${labels} capability in this session/profile`,
    {
      status: 409,
      type: "invalid_request_error",
      code: "missing_local_execution_capability"
    }
  )
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
    "If the user asks to create/edit files or run shell commands, you MUST emit a tool_use decision and wait for tool_result.",
    "Never claim a write/edit/bash action succeeded unless it was executed via tool_use + tool_result in this session.",
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

function parsePlannerDecision(payload = {}, availableTools = [], policy = {}) {
  const blocks = extractResponsesBlocks(payload)
  const text = blocks
    .filter(block => block.type === "text")
    .map(block => String(block.text || ""))
    .join("\n")
    .trim()
  const enrichedPolicy = {
    ...policy,
    rawPlannerText: text
  }

  const parsed = tryParseJsonObject(text)
  const available = new Set((availableTools || []).map(tool => String(tool?.name || "")))
  const resolveAllowedToolName = rawName => {
    const original = String(rawName || "")
    if (!original) {
      return ""
    }
    const mapped = mapMutatingBuiltinToRunner(original, availableTools)
    if (available.has(original) || available.has(mapped)) {
      return mapped
    }
    return ""
  }

  const finalizeDecision = decision => {
    if (!decision || typeof decision !== "object") {
      return decision
    }

    if (decision.type === "tool_use") {
      const mappedName = mapMutatingBuiltinToRunner(decision.name, availableTools)
      return {
        ...decision,
        name: mappedName
      }
    }

    if (decision.type === "final" && policy?.requireToolDecision) {
      throw new PlannerBoundaryError(
        "remote planner returned final text for a turn that requires local write/bash/edit execution",
        {
          status: 409,
          type: "invalid_request_error",
          code: "planner_final_blocked_for_local_execution"
        }
      )
    }

    return decision
  }

  const parsedToolName = resolveAllowedToolName(parsed?.name)
  if (parsed?.type === "tool_use" && parsedToolName) {
    return finalizeDecision({
      type: "tool_use",
      name: parsedToolName,
      arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {},
      prelude: String(parsed.prelude || "").trim()
    })
  }

  if (parsed?.type === "final") {
    return finalizeDecision({
      type: "final",
      content: String(parsed.content || "").trim()
    })
  }

  const salvaged = trySalvagePlannerDecision(text, availableTools)
  const salvagedToolName = resolveAllowedToolName(salvaged?.name)
  if (salvaged?.type === "tool_use" && salvagedToolName) {
    return finalizeDecision({
      type: "tool_use",
      name: salvagedToolName,
      arguments: salvaged.arguments && typeof salvaged.arguments === "object" ? salvaged.arguments : {},
      prelude: String(salvaged.prelude || "").trim()
    })
  }

  if (salvaged?.type === "final") {
    return finalizeDecision({
      type: "final",
      content: String(salvaged.content || "").trim()
    })
  }

  const inferred = inferDecisionFromCcMeta(payload, availableTools)
  const inferredToolName = resolveAllowedToolName(inferred?.name)
  if (inferred?.type === "tool_use" && inferredToolName) {
    return finalizeDecision({
      type: "tool_use",
      name: inferredToolName,
      arguments: inferred.arguments && typeof inferred.arguments === "object" ? inferred.arguments : {},
      prelude: ""
    })
  }

  const userInferred = inferDecisionFromUserAsk(enrichedPolicy.userAsk || "", availableTools, enrichedPolicy)
  const userInferredToolName = resolveAllowedToolName(userInferred?.name)
  if (enrichedPolicy.requireToolDecision && userInferred?.type === "tool_use" && userInferredToolName) {
    return finalizeDecision({
      type: "tool_use",
      name: userInferredToolName,
      arguments:
        userInferred.arguments && typeof userInferred.arguments === "object" ? userInferred.arguments : {},
      prelude: String(userInferred.prelude || "").trim()
    })
  }
  if (userInferred?.type === "final") {
    return finalizeDecision({
      type: "final",
      content: String(userInferred.content || "").trim()
    })
  }

  if (enrichedPolicy?.requireToolDecision) {
    throw new PlannerBoundaryError(
      "remote planner did not return a valid tool_use/final decision JSON for a local execution turn",
      {
        status: 502,
        type: "api_error",
        code: "planner_invalid_decision_payload"
      }
    )
  }

  return finalizeDecision({
    type: "final",
    content: text
  })
}

function extractPlannerResponseText(payload = {}) {
  return extractResponsesBlocks(payload)
    .filter(block => block.type === "text")
    .map(block => String(block.text || ""))
    .join("\n")
    .trim()
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
  if (responseMode?.kind === "local_shortcut") {
    const decision = responseMode.decision || { type: "final", content: "(empty)" }
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
  } else if (responseMode?.kind === "tool_orchestrator") {
    const decision = parsePlannerDecision(
      payload,
      responseMode.availableTools || [],
      responseMode.plannerPolicy || {}
    )
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
  const plannerPolicy = buildPlannerPolicy(request, tools)
  validatePlannerPolicy(plannerPolicy)
  const localShortcutDecision = tools.length
    ? buildLocalShortcutDecision(request, tools, plannerPolicy)
    : null

  if (localShortcutDecision) {
    return {
      remoteRequest: null,
      responseMode: {
        kind: "local_shortcut",
        decision: localShortcutDecision,
        plannerPolicy
      }
    }
  }

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
        availableTools: tools,
        plannerPolicy
      }
    }
  }

  if (plannerPolicy.requireToolDecision) {
    throw new PlannerBoundaryError(
      "local execution guard blocked this request: local write/bash/edit intent requires advertised tools in this session/profile",
      {
        status: 409,
        type: "invalid_request_error",
        code: "local_execution_tools_not_advertised"
      }
    )
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

        let remotePayload = null
        if (builtPayload) {
          await writeDebugDump("remote-request", builtPayload)

          remotePayload = await fetchRemoteJson(config, builtPayload)
          await writeDebugDump("remote-response", remotePayload)
          const plannerText =
            built.responseMode?.kind === "tool_orchestrator" ? extractPlannerResponseText(remotePayload) : ""
          const shouldPersistRemotePlannerState =
            !(built.responseMode?.kind === "tool_orchestrator" && looksLikePlannerNoise(plannerText))
          if (shouldPersistRemotePlannerState) {
            state.previousResponseId = String(remotePayload.id || state.previousResponseId || "")
            state.remoteSessionId = String(remotePayload.cc_meta?.meta?.remote_session_id || state.remoteSessionId || "")
          }
        }

        const message = buildAnthropicMessage({
          payload: remotePayload || {},
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
            usage: remotePayload?.cc_meta?.usage || remotePayload?.usage || null,
            cost_usd: remotePayload?.cc_meta?.cost_usd ?? null,
            target_model: String(body?.model || config.remoteServiceModel || ""),
            runtime_id: remotePayload?.cc_meta?.meta?.runtime_id || "",
            reused_remote_session: Boolean(remotePayload?.cc_meta?.meta?.reused_remote_session)
          })
        }

        if (body?.stream === true) {
          writeSseResponse(res, buildAnthropicSseBody(message))
          return
        }

        jsonResponse(res, 200, message)
      } catch (error) {
        const plannerError = error instanceof PlannerBoundaryError ? error : null
        await mirrorAgentEvent(config, buildMirrorRouting(config, state.sessionId), "turn.failed", {
          request_id: `official-fail-${Date.now().toString(36)}`,
          remote_session_id: state.remoteSessionId || "",
          error: error instanceof Error ? error.message : String(error)
        })
        writeAnthropicError(
          res,
          plannerError?.status || 500,
          error instanceof Error ? error.message : String(error),
          plannerError?.type || "api_error",
          plannerError?.code || ""
        )
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
