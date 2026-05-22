import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const MAX_OUTPUT_CHARS = 8000
const DEFAULT_BASH_TIMEOUT_MS = 120000
const SUPPORTED_TOOLS = ["pwd", "git_status", "read_file", "search", "bash", "write_file", "apply_patch"]
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

function parseJsonArgs(raw = "") {
  const text = String(raw || "").trim()
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
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

function normalizeWritableScope(workspaceRoot, writableScope = "none") {
  const root = path.resolve(workspaceRoot)
  const raw = String(writableScope || "none").trim()

  if (!raw || raw === "none") {
    return []
  }

  if (["workspace", "*", "."].includes(raw)) {
    return [root]
  }

  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => ensureInsideWorkspace(root, item))
}

function ensureInsideWorkspace(workspaceRoot, targetPath = ".") {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(root, targetPath)

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${targetPath}`)
  }

  return target
}

function ensureWritableTarget(root, target, writableScope) {
  const allowedRoots = normalizeWritableScope(root, writableScope)

  if (!allowedRoots.length) {
    throw new Error("write access is disabled for this runner")
  }

  const permitted = allowedRoots.some(scopeRoot => {
    return target === scopeRoot || target.startsWith(`${scopeRoot}${path.sep}`)
  })

  if (!permitted) {
    const relative = path.relative(root, target) || "."
    throw new Error(`path is outside writable_scope: ${relative}`)
  }
}

async function runCommand(file, args, { cwd, timeout = 0, shell = false } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      maxBuffer: 1024 * 1024,
      timeout,
      shell
    })
    return {
      ok: true,
      stdout: stdout || "",
      stderr: stderr || ""
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw error
    }

    return {
      ok: false,
      stdout: error?.stdout || "",
      stderr: error?.stderr || error?.message || String(error)
    }
  }
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

  if (name === "bash") {
    return {
      name,
      args: {
        command: tail
      }
    }
  }

  if (name === "write_file") {
    const parsed = parseJsonArgs(tail)
    if (parsed) {
      return { name, args: parsed }
    }

    const [rawPath = "", ...contentParts] = tail.split(/\s+/)
    return {
      name,
      args: {
        path: rawPath,
        content: contentParts.join(" ")
      }
    }
  }

  if (name === "apply_patch") {
    const parsed = parseJsonArgs(tail)
    return {
      name,
      args: parsed || {}
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

  if (canonicalName !== "help" && !allowed.includes(canonicalName)) {
    return {
      ok: false,
      content: `tool is not enabled for this runner: ${canonicalName}`,
      metadata: {
        workspace_root: root,
        allowed_tools: allowed
      }
    }
  }

  if (canonicalName === "help") {
    return {
      ok: true,
      content:
        "supported tools: pwd, git_status, read_file <path>, search <query> [path] (alias: rg), bash <command>, write_file, apply_patch",
      metadata: {
        workspace_root: root
      }
    }
  }

  if (canonicalName === "pwd") {
    return {
      ok: true,
      content: root,
      metadata: {
        workspace_root: root
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
          workspace_root: root
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
        pathspec
      }
    }
  }

  if (canonicalName === "read_file") {
    const target = ensureInsideWorkspace(root, args.path || "README.md")
    const content = await readFile(target, "utf8")
    return {
      ok: true,
      content: truncate(content),
      metadata: {
        workspace_root: root,
        path: path.relative(root, target) || path.basename(target)
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
          workspace_root: root
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
          path: path.relative(root, target) || "."
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
          fallback: "grep"
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
          workspace_root: root
        }
      }
    }

    if (String(writableScope || "none").trim() === "none") {
      return {
        ok: false,
        content: "bash is disabled because writable_scope is none",
        metadata: {
          workspace_root: root,
          writable_scope: writableScope
        }
      }
    }

    const timeoutMs = Number.parseInt(String(args.timeout_ms || DEFAULT_BASH_TIMEOUT_MS), 10)
    const result = await runCommand("zsh", ["-lc", command], {
      cwd: root,
      timeout: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_BASH_TIMEOUT_MS
    })

    return {
      ok: result.ok,
      content: truncate(
        [String(result.stdout || "").trim(), String(result.stderr || "").trim()].filter(Boolean).join("\n") ||
          "(empty)"
      ),
      metadata: {
        workspace_root: root,
        command,
        writable_scope: writableScope
      }
    }
  }

  if (canonicalName === "write_file") {
    const rawPath = String(args.path || "").trim()
    if (!rawPath) {
      return {
        ok: false,
        content: "write_file path is required",
        metadata: {
          workspace_root: root
        }
      }
    }

    const target = ensureInsideWorkspace(root, rawPath)
    try {
      ensureWritableTarget(root, target, writableScope)
    } catch (error) {
      return {
        ok: false,
        content: error instanceof Error ? error.message : String(error),
        metadata: {
          workspace_root: root,
          writable_scope: writableScope,
          path: path.relative(root, target) || path.basename(target)
        }
      }
    }

    const content = String(args.content ?? "")
    const append = Boolean(args.append)
    const existing = append ? await readFile(target, "utf8").catch(() => "") : ""
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, append ? `${existing}${content}` : content, "utf8")

    return {
      ok: true,
      content: append ? "file appended" : "file written",
      metadata: {
        workspace_root: root,
        path: path.relative(root, target) || path.basename(target),
        bytes_written: Buffer.byteLength(content, "utf8"),
        append
      }
    }
  }

  if (canonicalName === "apply_patch") {
    const operations = Array.isArray(args.operations)
      ? args.operations
      : args.path && typeof args.search === "string"
        ? [args]
        : []

    if (!operations.length) {
      return {
        ok: false,
        content:
          "apply_patch requires args.operations[] or { path, search, replace, replace_all? }",
        metadata: {
          workspace_root: root
        }
      }
    }

    const changedPaths = []

    for (const operation of operations) {
      const rawPath = String(operation.path || "").trim()
      if (!rawPath) {
        throw new Error("apply_patch.path is required")
      }

      const target = ensureInsideWorkspace(root, rawPath)
      ensureWritableTarget(root, target, writableScope)

      const search = String(operation.search ?? "")
      const replace = String(operation.replace ?? "")
      const replaceAll = Boolean(operation.replace_all || operation.all)
      if (!search) {
        throw new Error(`apply_patch.search is required for ${operation.path || "<unknown>"}`)
      }

      const original = await readFile(target, "utf8")
      if (!original.includes(search)) {
        throw new Error(`apply_patch search text not found in ${operation.path}`)
      }

      const next = replaceAll ? original.split(search).join(replace) : original.replace(search, replace)
      if (next === original) {
        throw new Error(`apply_patch produced no changes for ${operation.path}`)
      }

      await writeFile(target, next, "utf8")
      changedPaths.push(path.relative(root, target) || path.basename(target))
    }

    return {
      ok: true,
      content: `patch applied to ${changedPaths.length} file(s)`,
      metadata: {
        workspace_root: root,
        writable_scope: writableScope,
        paths: changedPaths
      }
    }
  }

  return {
    ok: false,
    content: `unsupported tool: ${canonicalName}`,
    metadata: {
      workspace_root: root
    }
  }
}
