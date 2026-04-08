#!/usr/bin/env node
/**
 * C4 Sticky Binding Fail-Fast Verification
 *
 * Validates:
 *   1. Healthy runtime: create → resume works normally
 *   2. Unhealthy bound runtime: resume returns 503, session not overwritten
 *   3. No healthy runtime: create returns 503, session not created
 *
 * Usage: node scripts/verify-c4-fail-fast.mjs
 */

import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"

const DATA_DIR = join(import.meta.dirname, "..", "data", "verify-c4-test")

// Clean up previous test data
if (existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true })
}
mkdirSync(DATA_DIR, { recursive: true })

// Dynamic import to use the project modules
const { RuntimePool } = await import("../src/runtime/runtimePool.mjs")
const { RuntimeBindingStore } = await import("../src/runtime/runtimeBindingStore.mjs")
const { RuntimeBinder } = await import("../src/runtime/runtimeBinder.mjs")

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`)
    passed++
  } else {
    console.log(`  FAIL: ${message}`)
    failed++
  }
}

const registryPath = join(DATA_DIR, "runtime-registry.json")
const statePath = join(DATA_DIR, "runtime-state.json")
const bindingPath = join(DATA_DIR, "runtime-binding-store.json")

const pool = new RuntimePool(registryPath, statePath)
const store = new RuntimeBindingStore(bindingPath)
const binder = new RuntimeBinder({ pool, store })

// Register test runtimes (need 2 so we can mark one unhealthy without the guard blocking it)
pool.registry.upsert({ runtime_id: "cc-test-1", base_url: "http://localhost:3001", enabled: true })
pool.registry.upsert({ runtime_id: "cc-test-2", base_url: "http://localhost:3002", enabled: true })

console.log("\n=== Test 1: Healthy runtime — create then resume ===")
{
  const r1 = binder.selectRuntimeForSession({
    ownerUserId: "test-user", deviceId: "mac", workspaceId: "ws1", sessionId: "sess-001"
  })
  assert(r1.runtime !== null, "create: runtime is not null")
  assert(r1.runtime.runtime_id === "cc-test-1", "create: runtime_id is cc-test-1")
  assert(r1.reused === false, "create: reused is false")
  assert(r1.reason === "created_new_binding", "create: reason is created_new_binding")

  const r2 = binder.selectRuntimeForSession({
    ownerUserId: "test-user", deviceId: "mac", workspaceId: "ws1", sessionId: "sess-001"
  })
  assert(r2.runtime !== null, "resume: runtime is not null")
  assert(r2.reused === true, "resume: reused is true")
  assert(r2.reason === "reused_existing_binding", "resume: reason is reused_existing_binding")
}

console.log("\n=== Test 2: Bound runtime becomes unhealthy — resume must fail ===")
{
  // sess-001 already bound to cc-test-1; mark it unhealthy
  pool.setRuntimeState("cc-test-1", { unhealthy: true })

  const r3 = binder.selectRuntimeForSession({
    ownerUserId: "test-user", deviceId: "mac", workspaceId: "ws1", sessionId: "sess-001"
  })
  assert(r3.runtime === null, "resume unhealthy: runtime is null")
  assert(r3.reason === "bound_runtime_not_acceptable", "resume unhealthy: reason is bound_runtime_not_acceptable")
  assert(r3.reused === false, "resume unhealthy: reused is false")
}

console.log("\n=== Test 3: No healthy runtime — new session must fail ===")
{
  // Bypass the safety guard to simulate all runtimes going unhealthy at once
  // (valid real-world scenario: network partition, upstream outage)
  pool.state.setUnhealthy("cc-test-2", true, "test: simulate total outage")
  // cc-test-1 is still unhealthy from test 2

  const r4 = binder.selectRuntimeForSession({
    ownerUserId: "test-user", deviceId: "mac", workspaceId: "ws1", sessionId: "sess-new-002"
  })
  assert(r4.runtime === null, "no healthy: runtime is null")
  assert(r4.reason === "no_healthy_runtime_available", "no healthy: reason is no_healthy_runtime_available")
  assert(r4.reused === false, "no healthy: reused is false")
}

console.log("\n=== Test 4: Binding store not polluted after failed create ===")
{
  const binding = store.get("test-user:mac:ws1:sess-new-002")
  assert(binding === null, "no binding record created for failed session")
}

console.log("\n=== Test 5: Original binding preserved after failed resume ===")
{
  const binding = store.get("test-user:mac:ws1:sess-001")
  assert(binding !== null, "original binding still exists")
  assert(binding.runtime_id === "cc-test-1", "original binding runtime_id unchanged")
}

// Cleanup
rmSync(DATA_DIR, { recursive: true })

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
