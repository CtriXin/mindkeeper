#!/usr/bin/env node
/**
 * Full-chain verification for GET /v1/session_state
 * Flow: start broker → auth/device → create session → query session_state
 * Usage: node scripts/verify-session-state.mjs
 */

import { startBrokerStub } from "../src/broker/stubServer.mjs";

let fail = 0;
function assert(cond, label) {
  if (!cond) {
    fail += 1;
    console.log(`  FAIL: ${label}`);
  } else {
    console.log(`  PASS: ${label}`);
  }
}

const server = await startBrokerStub({
  port: 0,
  config: {
    deviceKey: "test-device-key",
    deviceId: "mac",
    workspaceId: "personal",
    ownerUserId: "xin",
  },
});

const baseUrl = server.baseUrl;
const { state } = server;
console.log(`Broker started at ${baseUrl}\n`);

// --- 1. Missing query params (400) ---
console.log("--- 1. Missing query params ---");
{
  const authR = await fetch(`${baseUrl}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth: { device_key: "test-device-key" },
      routing: {
        runner_key: "xin:mac:personal",
        owner_user_id: "xin",
        device_id: "mac",
        workspace_id: "personal",
      },
    }),
  });
  const token = (await authR.json()).access_token;

  const r = await fetch(`${baseUrl}/v1/session_state?device_id=mac`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  assert(r.status === 400, `status 400, got ${r.status}`);
  assert(j.ok === false, `ok=false, got ${j.ok}`);
}

// --- 2. Session not found (404, binding_reason=null) ---
console.log("\n--- 2. Session not found ---");
{
  const authR = await fetch(`${baseUrl}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth: { device_key: "test-device-key" },
      routing: {
        runner_key: "xin:mac:personal",
        owner_user_id: "xin",
        device_id: "mac",
        workspace_id: "personal",
      },
    }),
  });
  const token = (await authR.json()).access_token;

  const r = await fetch(
    `${baseUrl}/v1/session_state?device_id=mac&workspace_id=personal&session_id=nonexistent`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const j = await r.json();
  assert(r.status === 404, `status 404, got ${r.status}`);
  assert(j.ok === false, `ok=false, got ${j.ok}`);
  assert(j.session.binding_reason === null, `binding_reason is null, got ${j.session.binding_reason}`);
  assert(j.session.remote_session_id === null, `remote_session_id is null`);
}

// --- 3. Full chain: auth → create session → query (200) ---
console.log("\n--- 3. Full chain: auth → create session → session_state ---");
{
  const authR = await fetch(`${baseUrl}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth: { device_key: "test-device-key" },
      routing: {
        runner_key: "xin:mac:personal",
        owner_user_id: "xin",
        device_id: "mac",
        workspace_id: "personal",
      },
    }),
  });
  const auth = await authR.json();
  const token = auth.access_token;
  assert(auth.ok === true, "auth/device ok");

  state.sessions.set("e2e-test-session", {
    sessionId: "e2e-test-session",
    runnerKey: "xin:mac:personal",
    mode: "create",
    routing: {
      owner_user_id: "xin",
      device_id: "mac",
      workspace_id: "personal",
      session_id: "e2e-test-session",
      runner_key: "xin:mac:personal",
    },
    status: "created",
    remoteService: {
      enabled: true,
      runtime_id: "rt-test-1",
      label: "test-runtime",
      remote_session_id: "remote-sess-456",
      response_id: "resp-001",
      reused_remote_session: true,
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      cost_usd: 0.001,
    },
    lastInputAt: new Date().toISOString(),
    lastInputPreview: "hello from test",
    lastOutputAt: new Date().toISOString(),
    lastOutputPreview: "answer from test",
  });

  const r = await fetch(
    `${baseUrl}/v1/session_state?device_id=mac&workspace_id=personal&session_id=e2e-test-session`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const j = await r.json();
  assert(r.status === 200, `status 200, got ${r.status}`);
  assert(j.ok === true, `ok=true, got ${j.ok}`);
  assert(j.session.remote_session_id === "remote-sess-456", `remote_session_id, got ${j.session.remote_session_id}`);
  assert(j.session.runtime_id === "rt-test-1", `runtime_id, got ${j.session.runtime_id}`);
  assert(j.session.binding_reason === "sticky_reuse", `binding_reason=sticky_reuse, got ${j.session.binding_reason}`);
  assert(j.session.last_user_preview === "hello from test", `last_user_preview, got ${j.session.last_user_preview}`);
  assert(j.session.last_answer_preview === "answer from test", `last_answer_preview, got ${j.session.last_answer_preview}`);
}

// --- 4. No auth (401) ---
console.log("\n--- 4. No auth ---");
{
  const r = await fetch(`${baseUrl}/v1/session_state?device_id=mac&workspace_id=personal&session_id=x`);
  assert(r.status === 401, `status 401, got ${r.status}`);
}

await server.close();

console.log(`\n=== ${fail === 0 ? "ALL PASSED" : `${fail} FAILED`} ===`);
process.exit(fail > 0 ? 1 : 0);
