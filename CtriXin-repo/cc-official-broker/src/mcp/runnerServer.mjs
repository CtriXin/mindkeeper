import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { loadConfig } from "../config.mjs"
import { executeToolCall, normalizeRunnerTools } from "../runner/toolExecutor.mjs"

function resolveSdkModule(specifier) {
  const require = createRequire(import.meta.url)
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "../hive"),
    path.resolve(process.cwd(), "../mindkeeper"),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")
  ]

  for (const base of candidates) {
    try {
      return require.resolve(specifier, { paths: [base] })
    } catch {
      // continue
    }
  }

  throw new Error(`unable to resolve MCP SDK module: ${specifier}`)
}

const serverModule = await import(pathToFileURL(resolveSdkModule("@modelcontextprotocol/sdk/server/index.js")).href)
const stdioModule = await import(pathToFileURL(resolveSdkModule("@modelcontextprotocol/sdk/server/stdio.js")).href)
const typesModule = await import(pathToFileURL(resolveSdkModule("@modelcontextprotocol/sdk/types.js")).href)

const { Server } = serverModule
const { StdioServerTransport } = stdioModule
const { CallToolRequestSchema, ListToolsRequestSchema } = typesModule

const config = loadConfig(process.env)
const allowedTools = normalizeRunnerTools(config.runnerTools)

function buildTools() {
  const allTools = [
    {
      name: "pwd",
      description: "Return the current workspace root path.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "git_status",
      description: "Return git status scoped to the current workspace.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "read_file",
      description: "Read a file inside the workspace. Optional line range supported.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path" },
          start_line: { type: "number", description: "Optional 1-based inclusive start line" },
          end_line: { type: "number", description: "Optional 1-based inclusive end line" }
        },
        required: ["path"]
      }
    },
    {
      name: "search",
      description: "Search text inside the workspace with rg/grep.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          path: { type: "string", description: "Optional workspace-relative search path" }
        },
        required: ["query"]
      }
    },
    {
      name: "write_file",
      description: "Write or patch a file inside the workspace. Supports overwrite, append, text replace, and line-range replace. Requires writable scope.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path" },
          content: { type: "string", description: "File content for overwrite/append or line-range replace" },
          append: { type: "boolean", description: "Append instead of overwrite" },
          old_text: { type: "string", description: "Existing text to replace" },
          new_text: { type: "string", description: "Replacement text for old_text" },
          replace_all: { type: "boolean", description: "Replace every old_text occurrence instead of only the first" },
          expected_count: { type: "number", description: "Optional exact number of old_text matches expected before replacing" },
          start_line: { type: "number", description: "Optional 1-based inclusive start line for line-range replacement" },
          end_line: { type: "number", description: "Optional 1-based inclusive end line for line-range replacement" }
        },
        required: ["path"]
      }
    },
    {
      name: "apply_patch",
      description: "Apply a unified diff patch inside the workspace. Requires writable scope.",
      inputSchema: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Unified diff patch text" }
        },
        required: ["patch"]
      }
    },
    {
      name: "bash",
      description: "Run a bash command inside the workspace. Requires writable scope.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Bash command to execute" },
          cwd: { type: "string", description: "Optional workspace-relative working directory" },
          timeout_ms: { type: "number", description: "Optional timeout in milliseconds" }
        },
        required: ["command"]
      }
    }
  ]

  return allTools.filter(tool => allowedTools.includes(tool.name))
}

function formatToolResult(result) {
  const content = String(result?.content || "").trim()
  const metadata =
    result?.metadata && typeof result.metadata === "object"
      ? `\n\nmetadata:\n${JSON.stringify(result.metadata, null, 2)}`
      : ""
  return `${content || "(empty)"}${metadata}`
}

const server = new Server(
  {
    name: "cc-official-broker-runner",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: buildTools()
}))

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: toolArgs } = request.params
  const result = await executeToolCall({
    name,
    args: toolArgs || {},
    workspaceRoot: config.workspaceRoot,
    allowedTools,
    writableScope: config.runnerWritableScope
  })

  return {
    content: [
      {
        type: "text",
        text: formatToolResult(result)
      }
    ],
    isError: !result.ok
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
