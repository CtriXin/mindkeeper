import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const MAX_OUTPUT_CHARS = 8000
const DEFAULT_COMMAND_TIMEOUT_MS = 20000
const MAX_COMMAND_TIMEOUT_MS = 120000
const SUPPORTED_TOOLS = ["pwd", "git_status", "read_file", "search", "write_file", "apply_patch", "bash"]
const TOOL_ALIASES = {
  rg: "search"
}

function truncate(text = "", limit = MAX_OUTPUT_CHARS) {
  const normalized = String(text)
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit)}\n...<truncated>`
}

function stripWrappingQuotes(value = "") {
  const text = String(value || "").trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

function parseSearchLikeArgs(raw = "") {
  const text = String(raw || "").trim()
  if (!text) {
    return {
      query: "",
      path: "."
    }
  }

  const quoted = text.match(/^("([^"]+)"|'([^']+)')\s*(.*)$/)
  if (quoted) {
    return {
      query: quoted[2] || quoted[3] || "",
      path: quoted[4] ? quoted[4].trim() || "." : "."
    }
  }

  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return {
      query: stripWrappingQuotes(parts[0] || ""),
      path: "."
    }
  }

  return {
    query: stripWrappingQuotes(parts[0]),
    path: parts.slice(1).join(" ") || "."
  }
}

function parseWriteFileArgs(raw = "") {
  const text = String(raw || "")
  const trimmed = text.trim()
  if (!trimmed) {
    return {
      path: "tmp.txt",
      content: ""
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed)
      return {
        path: String(parsed.path || "tmp.txt"),
        content: typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content ?? ""),
        append: Boolean(parsed.append),
        old_text: typeof parsed.old_text === "string" ? parsed.old_text : parsed.oldText,
        new_text: typeof parsed.new_text === "string" ? parsed.new_text : parsed.newText,
        replace_all: Boolean(parsed.replace_all ?? parsed.replaceAll),
        expected_count: parsed.expected_count ?? parsed.expectedCount,
        start_line: parsed.start_line ?? parsed.startLine,
        end_line: parsed.end_line ?? parsed.endLine
      }
    } catch {
      // fall through to plain-text parsing
    }
  }

  const delimiter = text.indexOf(" -- ")
  if (delimiter >= 0) {
    return {
      path: text.slice(0, delimiter).trim() || "tmp.txt",
      content: text.slice(delimiter + 4),
      append: false
    }
  }

  const firstGap = trimmed.search(/\s/)
  if (firstGap < 0) {
    return {
      path: trimmed,
      content: "",
      append: false
    }
  }

  return {
    path: trimmed.slice(0, firstGap).trim() || "tmp.txt",
    content: trimmed.slice(firstGap + 1),
    append: false
  }
}

function normalizeAllowedTools(allowedTools = SUPPORTED_TOOLS) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(allowedTools) ? allowedTools : SUPPORTED_TOOLS)
        .map(item => String(item || "").trim())
        .filter(Boolean)
    )
  )

  return normalized.length ? normalized : [...SUPPORTED_TOOLS]
}

export function normalizeRunnerTools(allowedTools = SUPPORTED_TOOLS) {
  const allowed = normalizeAllowedTools(allowedTools)
  return allowed.filter(toolName => SUPPORTED_TOOLS.includes(toolName))
}

function ensureInsideWorkspace(workspaceRoot, targetPath = ".") {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(root, targetPath)

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${targetPath}`)
  }

  return target
}

function resolveWritableScope(workspaceRoot, writableScope = "none") {
  const root = path.resolve(workspaceRoot)
  const raw = String(writableScope || "none").trim() || "none"
  const normalized = raw.toLowerCase()

  if (normalized === "none") {
    return {
      mode: "none",
      root,
      raw
    }
  }

  if (["workspace", "workspace-write", "project", "*"].includes(normalized)) {
    return {
      mode: "workspace",
      root,
      raw
    }
  }

  return {
    mode: "scoped",
    root: ensureInsideWorkspace(root, raw),
    raw
  }
}

function ensureWritablePath(workspaceRoot, writableScope, targetPath) {
  const scope = resolveWritableScope(workspaceRoot, writableScope)
  if (scope.mode === "none") {
    throw new Error("writable tools are disabled for this runner")
  }

  const target = ensureInsideWorkspace(workspaceRoot, targetPath)
  if (target !== scope.root && !target.startsWith(`${scope.root}${path.sep}`)) {
    throw new Error(`path is outside writable_scope: ${targetPath}`)
  }

  return {
    scope,
    target
  }
}

function normalizeTimeoutMs(value, fallback = DEFAULT_COMMAND_TIMEOUT_MS) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(parsed, MAX_COMMAND_TIMEOUT_MS)
}

function extractPatchPath(raw = "") {
  const text = String(raw || "").trim()
  if (!text || text === "/dev/null") {
    return ""
  }
  if (text.startsWith("a/") || text.startsWith("b/")) {
    return text.slice(2)
  }
  return text
}

function parsePatchTouchedPaths(patch = "") {
  const touched = new Set()
  for (const rawLine of String(patch || "").split(/\r?\n/)) {
    const line = rawLine.trim()
    let candidate = ""

    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/)
      candidate = extractPatchPath(match?.[2] || match?.[1] || "")
    } else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      candidate = extractPatchPath(line.slice(4))
    }

    if (candidate) {
      touched.add(candidate)
    }
  }
  return [...touched]
}

function normalizePatchForWorkspace(patch = "") {
  return String(patch || "")
    .replace(/^diff --git\s+.+$/gm, "")
    .replace(/^(---|\+\+\+)\s+[ab]\/(.+)$/gm, "$1 $2")
}

function normalizeOptionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function detectLineEnding(text = "") {
  return String(text).includes("\r\n") ? "\r\n" : "\n"
}

function splitTextToLogicalLines(text = "") {
  const normalized = String(text).replace(/\r\n/g, "\n")
  const hasTrailingNewline = normalized.endsWith("\n")
  const lines = normalized.split("\n")
  if (hasTrailingNewline) {
    lines.pop()
  }
  return {
    lines,
    hasTrailingNewline
  }
}

function joinLogicalLines(lines = [], { lineEnding = "\n", trailingNewline = false } = {}) {
  const body = lines.join(lineEnding)
  if (!trailingNewline) {
    return body
  }
  return body ? `${body}${lineEnding}` : lineEnding
}

function countOccurrences(text = "", needle = "") {
  const haystack = String(text)
  const pattern = String(needle)
  if (!pattern) {
    return 0
  }

  let count = 0
  let index = 0
  while (true) {
    index = haystack.indexOf(pattern, index)
    if (index < 0) {
      return count
    }
    count += 1
    index += pattern.length || 1
  }
}

function sliceFileByLines(text = "", startLine, endLine) {
  const { lines, hasTrailingNewline } = splitTextToLogicalLines(text)
  const totalLines = lines.length
  const normalizedStart = startLine ? Math.max(1, startLine) : 1
  const normalizedEnd = endLine ? Math.max(normalizedStart, endLine) : totalLines
  const effectiveStart = totalLines > 0 ? Math.min(normalizedStart, totalLines) : 1
  const effectiveEnd = totalLines > 0 ? Math.min(normalizedEnd, totalLines) : 0
  const selected =
    totalLines > 0 && effectiveEnd >= effectiveStart
      ? lines.slice(effectiveStart - 1, effectiveEnd)
      : []
  const lineEnding = detectLineEnding(text)
  const content = joinLogicalLines(selected, {
    lineEnding,
    trailingNewline: hasTrailingNewline && effectiveEnd === totalLines && selected.length > 0
  })

  return {
    content,
    totalLines,
    startLine: effectiveStart,
    endLine: effectiveEnd,
    clipped: Boolean(startLine || endLine)
  }
}

function applyTextReplacement(originalText, args = {}) {
  const oldTextValue = args.old_text ?? args.oldText
  const oldText = typeof oldTextValue === "string" ? oldTextValue : ""
  if (!oldText) {
    throw new Error("old_text is required for replace mode")
  }

  const newTextValue = args.new_text ?? args.newText ?? ""
  const newText = typeof newTextValue === "string" ? newTextValue : JSON.stringify(newTextValue ?? "")
  const replaceAll = Boolean(args.replace_all ?? args.replaceAll)
  const expectedCount = normalizeOptionalPositiveInt(args.expected_count ?? args.expectedCount)
  const matchCount = countOccurrences(originalText, oldText)

  if (matchCount <= 0) {
    throw new Error("old_text was not found in target file")
  }
  if (expectedCount !== null && matchCount !== expectedCount) {
    throw new Error(`expected ${expectedCount} matches but found ${matchCount}`)
  }

  const replacementCount = replaceAll ? matchCount : 1
  const nextContent = replaceAll
    ? String(originalText).split(oldText).join(newText)
    : String(originalText).replace(oldText, newText)

  return {
    nextContent,
    mode: "replace",
    replacements: replacementCount,
    replace_all: replaceAll
  }
}

function applyLineRangeReplacement(originalText, args = {}) {
  const startLine = normalizeOptionalPositiveInt(args.start_line ?? args.startLine ?? args.line_start ?? args.lineStart)
  const endLine = normalizeOptionalPositiveInt(args.end_line ?? args.endLine ?? args.line_end ?? args.lineEnd)
  if (startLine === null && endLine === null) {
    return null
  }

  const start = startLine ?? 1
  const { lines, hasTrailingNewline } = splitTextToLogicalLines(originalText)
  const totalLines = lines.length
  const end = Math.max(start, endLine ?? start)
  const maxExistingLine = Math.max(1, totalLines || 1)

  if (start > maxExistingLine + (totalLines === 0 ? 0 : 1)) {
    throw new Error(`line range starts beyond file length: ${start}`)
  }

  const normalizedStart = Math.min(start, maxExistingLine)
  const normalizedEnd = Math.min(end, totalLines || normalizedStart)
  const replacementRaw =
    typeof args.content === "string" ? args.content : JSON.stringify(args.content ?? "", null, 2)
  const replacementLines = splitTextToLogicalLines(replacementRaw).lines
  const nextLines = [...lines]
  const deleteCount = totalLines === 0 ? 0 : Math.max(0, normalizedEnd - normalizedStart + 1)
  nextLines.splice(Math.max(0, normalizedStart - 1), deleteCount, ...replacementLines)

  return {
    nextContent: joinLogicalLines(nextLines, {
      lineEnding: detectLineEnding(originalText),
      trailingNewline: hasTrailingNewline
    }),
    mode: "line_range_replace",
    line_start: normalizedStart,
    line_end: normalizedEnd,
    inserted_lines: replacementLines.length
  }
}

async function runCommand(file, args, { cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      env,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    })
    return {
      ok: true,
      exitCode: 0,
      stdout: stdout || "",
      stderr: stderr || ""
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw error
    }

    return {
      ok: false,
      exitCode: typeof error?.code === "number" ? error.code : null,
      signal: error?.signal || null,
      timedOut: Boolean(error?.killed && error?.signal === "SIGTERM"),
      stdout: error?.stdout || "",
      stderr: error?.stderr || error?.message || String(error)
    }
  }
}

async function runCommandWithInput(
  file,
  args,
  { cwd, env, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, input = "" } = {}
) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false
    let timeout = null

    const finish = result => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve(result)
    }

    child.stdout.on("data", chunk => {
      stdout += String(chunk)
    })
    child.stderr.on("data", chunk => {
      stderr += String(chunk)
    })
    child.on("error", error => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      reject(error)
    })
    child.on("close", (code, signal) => {
      finish({
        ok: code === 0,
        exitCode: code ?? null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut
      })
    })

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
      }, timeoutMs)
    }

    child.stdin.on("error", () => {
      // ignore EPIPE if child exits early
    })
    child.stdin.end(input)
  })
}

async function findGitTopLevel(cwd) {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd })
  if (!result.ok) {
    return null
  }

  const topLevel = String(result.stdout || "").trim()
  return topLevel || null
}

export function parseToolPrompt(prompt = "") {
  const trimmed = String(prompt).trim()
  if (!trimmed.startsWith("/tool ")) {
    return null
  }

  const raw = trimmed.slice("/tool ".length).trim()
  if (!raw) {
    return {
      name: "help",
      args: {}
    }
  }

  const [rawName = "", ...rest] = raw.split(/\s+/)
  const name = TOOL_ALIASES[rawName] || rawName
  const tail = rest.join(" ").trim()

  if (name === "pwd" || name === "git_status") {
    return { name, args: {} }
  }

  if (name === "read_file") {
    if (tail.startsWith("{")) {
      try {
        const parsed = JSON.parse(tail)
        return {
          name,
          args: {
            path: String(parsed.path || "README.md"),
            start_line: parsed.start_line ?? parsed.startLine,
            end_line: parsed.end_line ?? parsed.endLine
          }
        }
      } catch {
        // fall through to plain-text parsing
      }
    }

    return {
      name,
      args: {
        path: tail || "README.md"
      }
    }
  }

  if (rawName === "rg" || name === "search") {
    const parsed = parseSearchLikeArgs(tail)
    return {
      name,
      args: {
        query: parsed.query,
        path: parsed.path
      }
    }
  }

  if (name === "write_file") {
    const parsed = parseWriteFileArgs(tail)
    return {
      name,
      args: {
        path: parsed.path,
        content: parsed.content,
        append: parsed.append,
        old_text: parsed.old_text,
        new_text: parsed.new_text,
        replace_all: parsed.replace_all,
        expected_count: parsed.expected_count,
        start_line: parsed.start_line,
        end_line: parsed.end_line
      }
    }
  }

  if (name === "apply_patch") {
    if (tail.startsWith("{")) {
      try {
        const parsed = JSON.parse(tail)
        return {
          name,
          args: {
            patch: typeof parsed.patch === "string" ? parsed.patch : JSON.stringify(parsed.patch ?? ""),
            cwd: parsed.cwd
          }
        }
      } catch {
        // fall through to plain-text parsing
      }
    }

    return {
      name,
      args: {
        patch: tail
      }
    }
  }

  if (name === "bash") {
    return {
      name,
      args: {
        command: tail
      }
    }
  }

  return {
    name,
    args: tail ? { raw: tail } : {}
  }
}

export function getSupportedToolNames() {
  return [...SUPPORTED_TOOLS]
}

export async function executeToolCall({
  name,
  args = {},
  workspaceRoot = process.cwd(),
  allowedTools = SUPPORTED_TOOLS,
  writableScope = "none"
}) {
  const root = path.resolve(workspaceRoot)
  const canonicalName = TOOL_ALIASES[name] || name
  const allowed = normalizeAllowedTools(allowedTools)
  const scope = resolveWritableScope(root, writableScope)

  if (canonicalName !== "help" && !allowed.includes(canonicalName)) {
    return {
      ok: false,
      content: `tool is not enabled for this runner: ${canonicalName}`,
      metadata: {
        workspace_root: root,
        allowed_tools: allowed,
        writable_scope: scope.raw
      }
    }
  }

  if (canonicalName === "help") {
    return {
      ok: true,
      content:
        "supported tools: pwd, git_status, read_file(path[,start_line,end_line]), search <query> [path] (alias: rg), write_file(path+content | old_text/new_text | line_start/line_end+content), apply_patch(patch), bash <command>",
      metadata: {
        workspace_root: root,
        writable_scope: scope.raw
      }
    }
  }

  if (canonicalName === "pwd") {
    return {
      ok: true,
      content: root,
      metadata: {
        workspace_root: root,
        writable_scope: scope.raw
      }
    }
  }

  if (canonicalName === "git_status") {
    const gitTopLevel = await findGitTopLevel(root)
    if (!gitTopLevel) {
      return {
        ok: false,
        content: "git repository not found for current workspace",
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }

    const pathspec = path.relative(gitTopLevel, root) || "."
    const result = await runCommand("git", ["status", "--short", "--branch", "--", pathspec], {
      cwd: gitTopLevel
    })
    return {
      ok: result.ok,
      content: truncate((result.stdout || result.stderr || "").trim() || "(empty)"),
      metadata: {
        workspace_root: root,
        git_top_level: gitTopLevel,
        pathspec,
        writable_scope: scope.raw
      }
    }
  }

  if (canonicalName === "read_file") {
    const target = ensureInsideWorkspace(root, args.path || "README.md")
    const content = await readFile(target, "utf8")
    const startLine = normalizeOptionalPositiveInt(args.start_line ?? args.startLine)
    const endLine = normalizeOptionalPositiveInt(args.end_line ?? args.endLine)
    const sliced = sliceFileByLines(content, startLine, endLine)
    const renderedContent = truncate(sliced.content)
    return {
      ok: true,
      content: renderedContent,
      metadata: {
        workspace_root: root,
        path: path.relative(root, target) || path.basename(target),
        total_lines: sliced.totalLines,
        start_line: sliced.startLine,
        end_line: sliced.endLine,
        line_range_applied: sliced.clipped,
        truncated: renderedContent !== sliced.content,
        writable_scope: scope.raw
      }
    }
  }

  if (canonicalName === "search") {
    const query = String(args.query || "").trim()
    const searchPath = String(args.path || ".").trim() || "."
    if (!query) {
      return {
        ok: false,
        content: "search query is required",
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }

    try {
      const target = ensureInsideWorkspace(root, searchPath)
      const result = await runCommand(
        "rg",
        ["--line-number", "--no-heading", "--color", "never", "--max-count", "20", query, target],
        { cwd: root }
      )
      return {
        ok: result.ok,
        content: truncate((result.stdout || result.stderr || "").trim() || "(no matches)"),
        metadata: {
          workspace_root: root,
          query,
          path: path.relative(root, target) || ".",
          writable_scope: scope.raw
        }
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error
      }

      const target = ensureInsideWorkspace(root, searchPath)
      const fallback = await runCommand("grep", ["-R", "-n", query, target], { cwd: root })
      return {
        ok: fallback.ok,
        content: truncate((fallback.stdout || fallback.stderr || "").trim() || "(no matches)"),
        metadata: {
          workspace_root: root,
          query,
          path: path.relative(root, target) || ".",
          fallback: "grep",
          writable_scope: scope.raw
        }
      }
    }
  }

  if (canonicalName === "write_file") {
    try {
      const { target } = ensureWritablePath(root, writableScope, args.path || "tmp.txt")
      await mkdir(path.dirname(target), { recursive: true })
      const fileExistsResult = await readFile(target, "utf8").catch(error => {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return null
        }
        throw error
      })
      const currentContent = typeof fileExistsResult === "string" ? fileExistsResult : ""
      const hasReplaceMode = args.old_text !== undefined || args.oldText !== undefined
      const lineRangeResult = applyLineRangeReplacement(currentContent, args)
      const content =
        typeof args.content === "string" ? args.content : JSON.stringify(args.content ?? "", null, 2)
      let nextContent = content
      let writeMode = "overwrite"
      let extraMetadata = {}

      if (Boolean(args.append)) {
        nextContent = `${currentContent}${content}`
        writeMode = "append"
      } else if (hasReplaceMode) {
        const replacement = applyTextReplacement(currentContent, args)
        nextContent = replacement.nextContent
        writeMode = replacement.mode
        extraMetadata = {
          replacements: replacement.replacements,
          replace_all: replacement.replace_all
        }
      } else if (lineRangeResult) {
        nextContent = lineRangeResult.nextContent
        writeMode = lineRangeResult.mode
        extraMetadata = {
          line_start: lineRangeResult.line_start,
          line_end: lineRangeResult.line_end,
          inserted_lines: lineRangeResult.inserted_lines
        }
      }

      await writeFile(target, nextContent, {
        encoding: "utf8",
        flag: "w"
      })
      return {
        ok: true,
        content: `wrote ${path.relative(root, target) || path.basename(target)}`,
        metadata: {
          workspace_root: root,
          path: path.relative(root, target) || path.basename(target),
          bytes: Buffer.byteLength(nextContent),
          mode: writeMode,
          append: Boolean(args.append),
          existed_before: fileExistsResult !== null,
          ...extraMetadata,
          writable_scope: scope.raw
        }
      }
    } catch (error) {
      return {
        ok: false,
        content: error instanceof Error ? error.message : String(error),
        metadata: {
          workspace_root: root,
          path: String(args.path || "tmp.txt"),
          writable_scope: scope.raw
        }
      }
    }
  }

  if (canonicalName === "bash") {
    const command = String(args.command || args.raw || "").trim()
    if (!command) {
      return {
        ok: false,
        content: "bash command is required",
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }

    if (scope.mode === "none") {
      return {
        ok: false,
        content: "bash is disabled because writable_scope is none",
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }

    const cwd = ensureInsideWorkspace(root, args.cwd || ".")
    if (cwd !== scope.root && !cwd.startsWith(`${scope.root}${path.sep}`)) {
      return {
        ok: false,
        content: `bash cwd is outside writable_scope: ${args.cwd || "."}`,
        metadata: {
          workspace_root: root,
          cwd: path.relative(root, cwd) || ".",
          writable_scope: scope.raw
        }
      }
    }

    const timeoutMs = normalizeTimeoutMs(args.timeout_ms || args.timeoutMs)
    const result = await runCommand("bash", ["-lc", command], {
      cwd,
      timeoutMs,
      env: {
        ...process.env,
        CC_BROKER_RUNNER_WORKSPACE_ROOT: root,
        CC_BROKER_RUNNER_WRITABLE_SCOPE: scope.raw
      }
    })

    const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "")
    return {
      ok: result.ok,
      content: truncate(output.trim() || `(exit ${result.exitCode ?? "unknown"})`),
      metadata: {
        workspace_root: root,
        cwd: path.relative(root, cwd) || ".",
        exit_code: result.exitCode,
        signal: result.signal || null,
        timed_out: Boolean(result.timedOut),
        timeout_ms: timeoutMs,
        writable_scope: scope.raw
      }
    }
  }

  if (canonicalName === "apply_patch") {
    const patch = String(args.patch || args.raw || "")
    if (!patch.trim()) {
      return {
        ok: false,
        content: "patch content is required",
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }

    if (scope.mode === "none") {
      return {
        ok: false,
        content: "apply_patch is disabled because writable_scope is none",
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }

    try {
      const touchedPaths = parsePatchTouchedPaths(patch)
      const normalizedPatch = normalizePatchForWorkspace(patch)
      for (const touchedPath of touchedPaths) {
        ensureWritablePath(root, writableScope, touchedPath)
      }

      const result = await runCommandWithInput(
        "git",
        ["apply", "--no-index", "--recount", "--unidiff-zero", "-p0", "-"],
        {
          cwd: root,
          env: process.env,
          input: normalizedPatch,
          timeoutMs: MAX_COMMAND_TIMEOUT_MS
        }
      )

      return {
        ok: result.ok,
        content: truncate((result.stdout || result.stderr || (result.ok ? "patch applied" : "(patch failed)")).trim()),
        metadata: {
          workspace_root: root,
          touched_paths: touchedPaths,
          exit_code: result.exitCode,
          signal: result.signal,
          timed_out: Boolean(result.timedOut),
          writable_scope: scope.raw
        }
      }
    } catch (error) {
      return {
        ok: false,
        content: error instanceof Error ? error.message : String(error),
        metadata: {
          workspace_root: root,
          writable_scope: scope.raw
        }
      }
    }
  }

  return {
    ok: false,
    content: `unsupported tool: ${canonicalName}`,
    metadata: {
      workspace_root: root,
      writable_scope: scope.raw
    }
  }
}
