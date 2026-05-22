#!/usr/bin/env node

import http from "node:http"
import { once } from "node:events"

import { startOfficialUpstreamProxy } from "../src/official/upstreamProxy.mjs"

function createMockPlannerDecisionResponse(decisionText, idSuffix = "1") {
  return {
    id: `resp-${idSuffix}`,
    output: [
      {
        id: `msg-${idSuffix}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: decisionText,
            annotations: []
          }
        ]
      }
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 20
    },
    cc_meta: {
      usage: {
        input_tokens: 10,
        output_tokens: 20
      },
      meta: {
        runtime_id: "cc-static-test",
        remote_session_id: `remote-session-${idSuffix}`,
        reused_remote_session: false
      }
    }
  }
}

async function startMockRemoteServer() {
  const requests = []
  const queuedDecisions = []

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "not found" } }))
      return
    }

    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const rawBody = Buffer.concat(chunks).toString("utf8")
    const body = rawBody ? JSON.parse(rawBody) : {}
    requests.push({ url: req.url, body })

    const decisionText =
      queuedDecisions.length > 0
        ? queuedDecisions.shift()
        : "{\"type\":\"final\",\"content\":\"ok\"}"
    const payload = createMockPlannerDecisionResponse(decisionText, String(requests.length))
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(payload))
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    queueDecision(text) {
      queuedDecisions.push(String(text || ""))
    },
    async close() {
      server.close()
      await once(server, "close")
    }
  }
}

function runnerWriteTool() {
  return {
    name: "mcp__cc-official-broker-runner__write_file",
    description: "write via local runner",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path"]
    }
  }
}

function runnerPatchTool() {
  return {
    name: "mcp__cc-official-broker-runner__apply_patch",
    description: "patch via local runner",
    input_schema: {
      type: "object",
      properties: {
        patch: { type: "string" }
      },
      required: ["patch"]
    }
  }
}

function runnerBashTool() {
  return {
    name: "mcp__cc-official-broker-runner__bash",
    description: "bash via local runner",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" }
      },
      required: ["command"]
    }
  }
}

function builtinWriteTool() {
  return {
    name: "Write",
    description: "builtin write tool",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        content: { type: "string" }
      },
      required: ["file_path", "content"]
    }
  }
}

function builtinBashTool() {
  return {
    name: "Bash",
    description: "builtin bash tool",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" }
      },
      required: ["command"]
    }
  }
}

function builtinMultiEditTool() {
  return {
    name: "MultiEdit",
    description: "builtin multi edit tool",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        edits: { type: "array" }
      },
      required: ["file_path", "edits"]
    }
  }
}

function builtinNotebookEditTool() {
  return {
    name: "NotebookEdit",
    description: "builtin notebook edit tool",
    input_schema: {
      type: "object",
      properties: {
        notebook_path: { type: "string" },
        cell_id: { type: "string" },
        new_source: { type: "string" }
      },
      required: ["notebook_path", "cell_id", "new_source"]
    }
  }
}

async function postAnthropicMessage(proxy, body) {
  const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${proxy.bridgeToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  })
  const payload = await response.json()
  return { status: response.status, payload }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const mockRemote = await startMockRemoteServer()
  const proxy = await startOfficialUpstreamProxy(
    {
      ownerUserId: "xin",
      deviceId: "mac",
      workspaceId: "personal",
      remoteServiceBaseUrl: mockRemote.baseUrl,
      remoteServiceBearerToken: "test-remote-token",
      remoteServiceModel: "claude-opus-4-6"
    },
    {
      bridgeToken: "test-bridge-token",
      sessionId: "official-proxy-test"
    }
  )

  try {
    // Case 1: user asks for local file write, but planner returns final text claiming success.
    mockRemote.queueDecision("{\"type\":\"final\",\"content\":\"Done. File created.\"}")
    const case1 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Please create file tmp/local-guard-1.txt with text hello" }]
        }
      ]
    })
    assert(case1.status === 409, `case1 expected 409, got ${case1.status}`)
    assert(
      case1.payload?.error?.code === "planner_final_blocked_for_local_execution",
      "case1 should reject remote final text for local write intent"
    )

    // Case 2: missing advertised runner write/edit tools -> fail fast before hitting remote planner.
    const remoteCallsBeforeCase2 = mockRemote.requests.length
    const case2 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [builtinWriteTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Create file tmp/local-guard-2.txt with text hello" }]
        }
      ]
    })
    assert(case2.status === 409, `case2 expected 409, got ${case2.status}`)
    assert(
      case2.payload?.error?.code === "missing_local_execution_capability",
      "case2 should fail fast when runner write/edit capability is not advertised"
    )
    assert(
      mockRemote.requests.length === remoteCallsBeforeCase2,
      "case2 should fail before remote /v1/responses call"
    )

    // Case 3: planner returns builtin Bash; proxy remaps to injected runner bash tool.
    mockRemote.queueDecision("{\"type\":\"tool_use\",\"name\":\"Bash\",\"arguments\":{\"command\":\"pwd\"}}")
    const case3 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [builtinBashTool(), runnerBashTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Run pwd and show me the path" }]
        }
      ]
    })
    assert(case3.status === 200, `case3 expected 200, got ${case3.status}`)
    const toolUse = case3.payload?.content?.find(block => block?.type === "tool_use")
    assert(Boolean(toolUse), "case3 expected a tool_use block")
    assert(
      toolUse?.name === "mcp__cc-official-broker-runner__bash",
      `case3 expected runner bash tool, got ${toolUse?.name || "(missing)"}`
    )

    // Case 4: follow-up turn already has matching tool_result; final answer should be allowed.
    mockRemote.queueDecision("{\"type\":\"final\",\"content\":\"Done\"}")
    const case4 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Create file tmp/local-guard-4.txt with text hello" }]
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_case4_write",
              name: "mcp__cc-official-broker-runner__write_file",
              input: {
                path: "tmp/local-guard-4.txt",
                content: "hello"
              }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_case4_write",
              content: [{ type: "text", text: "write_file ok" }]
            }
          ]
        }
      ]
    })
    assert(case4.status === 200, `case4 expected 200, got ${case4.status}`)
    const finalText4 = case4.payload?.content?.find(block => block?.type === "text")?.text || ""
    assert(finalText4.includes("Done"), "case4 expected final text after local tool_result")

    // Case 5: filename-path intent — "把 README.md 第一行改成 hello"
    // Should be detected as local write/edit intent, not just "file" keyword.
    mockRemote.queueDecision("{\"type\":\"final\",\"content\":\"Done. File updated.\"}")
    const case5 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "把 README.md 第一行改成 hello" }]
        }
      ]
    })
    assert(case5.status === 409, `case5 expected 409, got ${case5.status}`)
    assert(
      case5.payload?.error?.code === "planner_final_blocked_for_local_execution",
      "case5 should reject remote final for filename-path write intent"
    )

    // Case 6: unmatched tool_result should NOT satisfy local execution
    // A tool_result with tool_use_id that doesn't map to write/edit/bash must not
    // be treated as "local write completed".
    mockRemote.queueDecision("{\"type\":\"final\",\"content\":\"Done\"}")
    const case6 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Create file tmp/local-guard-6.txt with text hello" }]
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_case6_read",
              name: "Read",
              input: { file_path: "tmp/other.txt" }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_case6_read",
              content: [{ type: "text", text: "some content" }]
            }
          ]
        }
      ]
    })
    assert(case6.status === 409, `case6 expected 409, got ${case6.status}`)
    assert(
      case6.payload?.error?.code === "planner_final_blocked_for_local_execution",
      "case6 should reject final when only unmatched (non-write) tool_result is present"
    )

    // Case 7 (positive): filename-path intent + planner returns tool_use -> should pass
    mockRemote.queueDecision("{\"type\":\"tool_use\",\"name\":\"Edit\",\"arguments\":{\"file_path\":\"README.md\",\"old_string\":\"# Old\",\"new_string\":\"# hello\"}}")
    const case7 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "在 src/config.ts 里加一行 export const VERSION = '1.0'" }]
        }
      ]
    })
    assert(case7.status === 200, `case7 expected 200, got ${case7.status}`)
    const toolUse7 = case7.payload?.content?.find(block => block?.type === "tool_use")
    assert(Boolean(toolUse7), "case7 expected a tool_use block")
    assert(
      toolUse7?.name === "mcp__cc-official-broker-runner__apply_patch",
      `case7 expected runner apply_patch tool, got ${toolUse7?.name || "(missing)"}`
    )

    // Case 8: explicit tool_choice={type:"tool",name:"Edit"} with ambiguous user text
    // normalizeToolChoice converts type:"tool" -> type:"function", so guard must
    // recognize both types to detect explicit mutation intent.
    mockRemote.queueDecision("{\"type\":\"final\",\"content\":\"Done\"}")
    const case8 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      tool_choice: { type: "tool", name: "Edit" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "处理一下这个" }]
        }
      ]
    })
    assert(case8.status === 409, `case8 expected 409, got ${case8.status}`)
    assert(
      case8.payload?.error?.code === "planner_final_blocked_for_local_execution",
      "case8 should reject final when explicit tool_choice=Edit is set"
    )

    // Case 9: planner returns builtin MultiEdit; proxy must remap it to local runner apply_patch.
    mockRemote.queueDecision(
      "{\"type\":\"tool_use\",\"name\":\"MultiEdit\",\"arguments\":{\"file_path\":\"src/demo.ts\",\"edits\":[{\"old_string\":\"a\",\"new_string\":\"b\"}]}}"
    )
    const case9 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [builtinMultiEditTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "把 src/demo.ts 里的 a 改成 b" }]
        }
      ]
    })
    assert(case9.status === 200, `case9 expected 200, got ${case9.status}`)
    const toolUse9 = case9.payload?.content?.find(block => block?.type === "tool_use")
    assert(Boolean(toolUse9), "case9 expected a tool_use block")
    assert(
      toolUse9?.name === "mcp__cc-official-broker-runner__apply_patch",
      `case9 expected runner apply_patch tool, got ${toolUse9?.name || "(missing)"}`
    )
    const plannerTools9 = mockRemote.requests.at(-1)?.body?.tools || []
    assert(
      !plannerTools9.some(tool => tool?.name === "MultiEdit"),
      "case9 should hide builtin MultiEdit from remote planner when runner apply_patch is available"
    )

    // Case 10: NotebookEdit should also be treated as local edit capability.
    mockRemote.queueDecision(
      "{\"type\":\"tool_use\",\"name\":\"NotebookEdit\",\"arguments\":{\"notebook_path\":\"demo.ipynb\",\"cell_id\":\"cell-1\",\"new_source\":\"print(1)\"}}"
    )
    const case10 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [builtinNotebookEditTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "改一下 demo.ipynb 里第一个 cell" }]
        }
      ]
    })
    assert(case10.status === 200, `case10 expected 200, got ${case10.status}`)
    const toolUse10 = case10.payload?.content?.find(block => block?.type === "tool_use")
    assert(Boolean(toolUse10), "case10 expected a tool_use block")
    assert(
      toolUse10?.name === "mcp__cc-official-broker-runner__apply_patch",
      `case10 expected runner apply_patch tool, got ${toolUse10?.name || "(missing)"}`
    )
    const plannerTools10 = mockRemote.requests.at(-1)?.body?.tools || []
    assert(
      !plannerTools10.some(tool => tool?.name === "NotebookEdit"),
      "case10 should hide builtin NotebookEdit from remote planner when runner apply_patch is available"
    )

    // Case 11: Chinese create-file intent with malformed planner text should still
    // infer a local runner write_file decision instead of leaking gibberish to the user.
    mockRemote.queueDecision("✻S\nwi\n✽Swrl\nii\nrn\n✻lg")
    const case11 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "在当前文件夹添加一个 helloworld.html，里面写 hi。用本地工具执行，完成后只回复 DONE。" }]
        }
      ]
    })
    assert(case11.status === 200, `case11 expected 200, got ${case11.status}`)
    const toolUse11 = case11.payload?.content?.find(block => block?.type === "tool_use")
    assert(Boolean(toolUse11), "case11 expected a tool_use block")
    assert(
      toolUse11?.name === "mcp__cc-official-broker-runner__write_file",
      `case11 expected runner write_file tool, got ${toolUse11?.name || "(missing)"}`
    )
    assert(toolUse11?.input?.path === "helloworld.html", `case11 expected helloworld.html, got ${toolUse11?.input?.path || "(missing)"}`)
    assert(toolUse11?.input?.content === "hi", `case11 expected content hi, got ${toolUse11?.input?.content || "(missing)"}`)

    // Case 12: after local tool_result already completed, malformed planner text
    // should fall back to the exact requested final literal instead of leaking noise.
    mockRemote.queueDecision("✻S\nwi\n✽Swrl\nii\nrn\n✻lg")
    const case12 = await postAnthropicMessage(proxy, {
      model: "claude-sonnet-4-6",
      stream: false,
      tools: [runnerWriteTool(), runnerPatchTool()],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "在当前文件夹添加一个 helloworld.html，里面写 hi。用本地工具执行，完成后只回复 DONE。" }]
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_case12_write",
              name: "mcp__cc-official-broker-runner__write_file",
              input: {
                path: "helloworld.html",
                content: "hi"
              }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_case12_write",
              content: [{ type: "text", text: "write_file ok" }]
            }
          ]
        }
      ]
    })
    assert(case12.status === 200, `case12 expected 200, got ${case12.status}`)
    const finalText12 = case12.payload?.content?.find(block => block?.type === "text")?.text || ""
    assert(finalText12 === "DONE", `case12 expected DONE, got ${finalText12 || "(empty)"}`)

    process.stdout.write("PASS test-official-proxy-local-exec-guard\n")
  } finally {
    await proxy.close()
    await mockRemote.close()
  }
}

main().catch(error => {
  process.stderr.write(`FAIL test-official-proxy-local-exec-guard: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
