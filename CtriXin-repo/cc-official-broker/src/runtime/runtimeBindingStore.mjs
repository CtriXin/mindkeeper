/**
 * Runtime Binding Store
 * Minimal file-based store for sticky session -> runtime bindings.
 *
 * Binding key is NOT stored as part of the key itself — the caller builds
 * the key from owner_user_id + device_id + workspace_id + session_id
 * using buildSessionKey() from ../shared/sessionKeys.mjs.
 *
 * This store does NOT implement sticky semantics — it only persists the
 * binding records.  The actual binding decision logic lives in runtimeBinder.mjs.
 *
 * Phase 1 scope:
 * - File-based JSON storage (no external DB)
 * - No TTL / expiration (binding lives until explicitly overwritten or cleared)
 * - No migration / rebinding orchestration (that is out of scope for Phase 1)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "path"

export function buildBindingKey({ ownerUserId, deviceId, workspaceId, sessionId }) {
  // Delegates to sessionKeys normalization so we use the same logic everywhere.
  // Lazy import to avoid circular deps at module load time.
  return buildSessionKeyInner(
    String(ownerUserId || "unknown-owner"),
    String(deviceId || "unknown-device"),
    String(workspaceId || "default-workspace"),
    String(sessionId || "default-session")
  )
}

function buildSessionKeyInner(owner, device, workspace, session) {
  function normalizePart(v, fallback) {
    return String(v || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback
  }
  const runnerKey = [normalizePart(owner, "unknown-owner"), normalizePart(device, "unknown-device"), normalizePart(workspace, "default-workspace")].join(":")
  return `${runnerKey}:${normalizePart(session, "default-session")}`
}

function buildEmptyStore() {
  return {
    version: 1,
    bindings: {} // keyed by binding key string
  }
}

export class RuntimeBindingStore {
  /**
   * @param {string} storePath - Path to the JSON file backing this store.
   */
  constructor(storePath) {
    this.storePath = storePath
    this.ensureDir()
  }

  ensureDir() {
    const dir = dirname(this.storePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  /** Read the store file, returning an empty store on first access or error. */
  _read() {
    try {
      if (!existsSync(this.storePath)) {
        return buildEmptyStore()
      }
      const content = readFileSync(this.storePath, "utf-8")
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== "object" || typeof parsed.bindings !== "object") {
        return buildEmptyStore()
      }
      return parsed
    } catch {
      return buildEmptyStore()
    }
  }

  /** Atomically write the store file. */
  _write(store) {
    this.ensureDir()
    writeFileSync(this.storePath, JSON.stringify(store, null, 2))
  }

  /**
   * Get a binding record by binding key.
   * @param {string} bindingKey
   * @returns {{ runtime_id: string, created_at: number, updated_at: number, source: string, reason: string } | null}
   */
  get(bindingKey) {
    const store = this._read()
    return store.bindings[bindingKey] || null
  }

  /**
   * Upsert a binding: creates or overwrites the runtime_id for a given binding key.
   * @param {string} bindingKey
   * @param {string} runtimeId
   * @param {{ source?: string, reason?: string }} [meta]
   */
  upsert(bindingKey, runtimeId, meta = {}) {
    const store = this._read()
    const now = Date.now()
    const existing = store.bindings[bindingKey] || null

    store.bindings[bindingKey] = {
      runtime_id: runtimeId,
      created_at: existing?.created_at || now,
      updated_at: now,
      source: meta.source || (existing ? "reused" : "new"),
      reason: meta.reason || (existing ? "resumed_session" : "new_session")
    }

    this._write(store)
    return store.bindings[bindingKey]
  }

  /**
   * Remove a binding record.
   * @param {string} bindingKey
   */
  remove(bindingKey) {
    const store = this._read()
    if (!store.bindings[bindingKey]) {
      return false
    }
    delete store.bindings[bindingKey]
    this._write(store)
    return true
  }

  /**
   * List all binding records.
   * @returns {Array}
   */
  list() {
    const store = this._read()
    return Object.entries(store.bindings).map(([key, record]) => ({ key, ...record }))
  }

  /**
   * Check whether a binding exists for a given key.
   * @param {string} bindingKey
   * @returns {boolean}
   */
  has(bindingKey) {
    return this.get(bindingKey) !== null
  }

  /**
   * Clear all bindings (use with care — primarily for testing).
   */
  clear() {
    this._write(buildEmptyStore())
  }
}
