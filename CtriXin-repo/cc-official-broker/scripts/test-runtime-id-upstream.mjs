#!/usr/bin/env node
/**
 * test-runtime-id-upstream.mjs - 验证 runtime_id 是否正确传递到 upstream
 *
 * 验证方式：启动一个 mock upstream server，然后直接调用 remoteServiceClient 函数来验证
 */

import http from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import {
  promptRemoteService,
  postRemoteAgentEvent,
  fetchRemoteSessionState
} from "../src/broker/remoteServiceClient.mjs"

// Mock upstream server that captures incoming headers
async function startMockUpstream(port = 9999) {
  const requests = []

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on("data", chunk => chunks.push(chunk))
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString()
      const requestInfo = {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
        timestamp: new Date().toISOString()
      }
      requests.push(requestInfo)

      // Return mock response based on endpoint
      if (req.url === "/v1/agent/events") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
      } else if (req.url.startsWith("/v1/session_state")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({
          ok: true,
          session_id: "test-session",
          runtime_id: req.headers["x-cc-runtime-id"] || "not-set"
        }))
      } else {
        // Default responses endpoint
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({
          id: "mock-resp-001",
          object: "response",
          status: "completed",
          model: "claude-opus-4-6",
          output: [
            {
              id: "msg-001",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "MOCK_OK", annotations: [] }]
            }
          ],
          cc_meta: {
            confidence: "high",
            risks: [],
            next_steps: [],
            meta: {
              remote_session_id: "mock-session-001",
              reused_remote_session: false,
              requested_runtime_id: req.headers["x-cc-runtime-id"] || "not-set"
            }
          }
        }))
      }
    })
  })

  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve))

  return {
    server,
    requests,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

async function main() {
  console.log("=== Testing runtime_id upstream passthrough ===\n")

  // 1. Start mock upstream
  const mockUpstream = await startMockUpstream(9999)
  console.log("✓ Mock upstream started on :9999")

  // Config matching what stubServer would use
  const config = {
    remoteServiceBaseUrl: "http://127.0.0.1:9999",
    remoteServiceBearerToken: "test-token",
    remoteServiceModel: "claude-opus-4-6",
    remoteServiceEndpoint: "responses"
  }

  const routing = {
    owner_user_id: "xin",
    device_id: "mac",
    workspace_id: "test",
    session_id: "sess-001"
  }

  const testRuntimeId = "cc-static-test-001"

  // Test 1: promptRemoteService with runtimeId
  console.log("\n--- Test 1: promptRemoteService ---")
  const result1 = await promptRemoteService({
    config,
    routing,
    input: "Hello test",
    runtimeId: testRuntimeId
  })
  console.log("Response:", result1.output)

  // Test 2: postRemoteAgentEvent with runtimeId
  console.log("\n--- Test 2: postRemoteAgentEvent ---")
  await postRemoteAgentEvent({
    config,
    routing,
    eventType: "test.event",
    runtimeId: testRuntimeId
  })
  console.log("Event posted")

  // Test 3: fetchRemoteSessionState with runtimeId
  console.log("\n--- Test 3: fetchRemoteSessionState ---")
  await fetchRemoteSessionState({
    config,
    routing,
    runtimeId: testRuntimeId
  })
  console.log("Session state fetched")

  // 4. Check captured requests
  console.log("\n=== Captured Upstream Requests ===")
  console.log(`Total requests: ${mockUpstream.requests.length}\n`)

  let passed = true

  for (let i = 0; i < mockUpstream.requests.length; i++) {
    const req = mockUpstream.requests[i]
    console.log(`Request ${i + 1} (${req.url}):`)
    console.log(`  Method: ${req.method}`)
    console.log(`  x-cc-runtime-id header: ${req.headers["x-cc-runtime-id"] || "NOT SET"}`)

    if (req.body?.metadata) {
      console.log(`  metadata.runtime_id: ${req.body.metadata.runtime_id || "NOT SET"}`)
    }

    // Verify header is present and correct
    if (req.headers["x-cc-runtime-id"] === testRuntimeId) {
      console.log("  ✓ Header PASSED")
    } else {
      console.log(`  ✗ Header FAILED (expected: ${testRuntimeId})`)
      passed = false
    }

    // Verify metadata is present (for POST requests with body)
    if (req.body?.metadata) {
      if (req.body.metadata.runtime_id === testRuntimeId) {
        console.log("  ✓ Metadata PASSED")
      } else {
        console.log(`  ✗ Metadata FAILED (expected: ${testRuntimeId}, got: ${req.body.metadata.runtime_id})`)
        passed = false
      }
    }

    console.log("")
  }

  // Cleanup
  await mockUpstream.close()

  console.log("=== Test Result ===")
  if (passed && mockUpstream.requests.length >= 3) {
    console.log("✓ ALL TESTS PASSED")
    process.exit(0)
  } else {
    console.log("✗ TESTS FAILED")
    process.exit(1)
  }
}

main().catch(err => {
  console.error("Test error:", err)
  process.exit(1)
})
