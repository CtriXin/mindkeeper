import test from "node:test"
import assert from "node:assert/strict"

import { buildConsultRequest } from "../src/consult/client.mjs"

const config = {
  baseUrl: "http://23.95.30.199:28082",
  bearerToken: "token",
  model: "claude-opus-4-6",
  endpoint: "chat.completions",
  ownerUserId: "xin",
  deviceId: "mac",
  workspaceId: "company",
  sessionId: "demo-001",
  source: "cc-consult-first",
  systemPrompt: "",
  timeoutMs: 90000
}

test("buildConsultRequest uses routing metadata for chat.completions", () => {
  const request = buildConsultRequest(config, {
    prompt: "请分析错误",
    contextText: "stack trace"
  })

  assert.equal(request.endpoint, "chat.completions")
  assert.equal(request.url, "http://23.95.30.199:28082/v1/chat/completions")
  assert.equal(request.body.metadata.device_id, "mac")
  assert.equal(request.body.metadata.workspace_id, "company")
  assert.equal(request.body.metadata.session_id, "demo-001")
  assert.match(request.body.messages[0].content, /Context/)
})

test("buildConsultRequest can target responses endpoint", () => {
  const request = buildConsultRequest(config, {
    prompt: "只给结论",
    endpoint: "responses"
  })

  assert.equal(request.endpoint, "responses")
  assert.equal(request.url, "http://23.95.30.199:28082/v1/responses")
  assert.equal(request.body.metadata.session_key, "xin:mac:company:demo-001")
  assert.equal(request.body.input.includes("[Task]"), true)
})
