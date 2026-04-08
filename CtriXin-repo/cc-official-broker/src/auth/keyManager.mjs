/**
 * Key Manager - key lifecycle and validation
 *
 * Responsibilities:
 * - Generate new API keys (crypto.randomBytes)
 * - Hash keys for storage (SHA-256)
 * - Validate presented keys against the registry
 * - Manage key lifecycle (create, disable, update)
 *
 * NOT responsible for:
 * - OAuth / official auth (this is gateway access auth only)
 * - Session sticky primary key
 * - Routing decisions
 */

import { createHash, randomBytes } from "node:crypto"
import { createKeyStore } from "./keyStore.mjs"

const KEY_PREFIX = "sk_live_"

/**
 * Generate a new API key string.
 * Uses crypto.randomBytes for 192 bits of entropy.
 */
export function generateKey() {
  const bytes = randomBytes(24) // 192 bits
  return `${KEY_PREFIX}${bytes.toString("base64url")}`
}

/**
 * Compute SHA-256 hex digest of a key string.
 */
export function hashKey(key) {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

/**
 * Build display prefix for a key (first 8 chars + "..." + last 4).
 */
export function maskKeyPrefix(key) {
  if (!key) return ""
  if (key.length <= 14) return key
  return `${key.slice(0, 10)}...${key.slice(-4)}`
}

/**
 * Extract auth token from request headers or query params.
 * Supports: Authorization: Bearer <token>, x-api-key header, ?access_token= query
 */
export function extractToken(req) {
  // Authorization: Bearer <token>
  const auth = req.headers?.authorization || ""
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim()
  }

  // x-api-key header
  const apiKey = req.headers?.["x-api-key"] || ""
  if (apiKey.trim()) {
    return apiKey.trim()
  }

  // Query param fallback
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const token = url.searchParams.get("access_token")
    if (token) return token.trim()
  } catch {
    // ignore URL parse errors
  }

  return ""
}

/**
 * Create a KeyManager instance.
 * @param {object} options
 * @param {string} [options.registryPath] - Path to key registry JSON file
 * @returns {KeyManager}
 */
export function createKeyManager(options = {}) {
  const store = createKeyStore({ registryPath: options.registryPath })

  /**
   * Create a new API key.
   * Returns the raw key ONCE (for display to user) and the stored record.
   * The raw key is never persisted.
   *
   * @param {object} opts
   * @param {string} [opts.label] - Human-readable label
   * @param {string} [opts.note] - Optional note
   * @returns {{ rawKey: string, record: KeyRecord }}
   */
  async function createKey(opts = {}) {
    const rawKey = generateKey()
    const secretHash = hashKey(rawKey)
    const keyPrefix = maskKeyPrefix(rawKey)

    const record = await store.addRecord({
      key_id: `key-${randomBytes(6).toString("hex")}`,
      secret_hash: secretHash,
      key_prefix: keyPrefix,
      status: "active",
      label: opts.label || "",
      note: opts.note || ""
    })

    return { rawKey, record }
  }

  /**
   * Validate a presented token against the key registry.
   *
   * @param {string} token - The raw token from the request
   * @returns {{ valid: boolean, record: KeyRecord|null, reason: string }}
   */
  async function validateToken(token) {
    if (!token) {
      return { valid: false, record: null, reason: "no_token" }
    }

    const secretHash = hashKey(token)
    return store.validate(secretHash)
  }

  /**
   * Authenticate a request. Combines token extraction and validation.
   *
   * @param {object} req - HTTP request object
   * @returns {{ ok: boolean, record: KeyRecord|null, error: string|null, statusCode: number }}
   */
  async function authenticateRequest(req) {
    const token = extractToken(req)
    if (!token) {
      return { ok: false, record: null, error: "missing_api_key", statusCode: 401 }
    }

    const result = await validateToken(token)

    if (result.reason === "key_not_found") {
      return { ok: false, record: null, error: "invalid_api_key", statusCode: 401 }
    }

    if (result.reason === "key_disabled") {
      return { ok: false, record: result.record, error: "api_key_disabled", statusCode: 403 }
    }

    // Track usage (fire-and-forget)
    const clientIp = req.socket?.remoteAddress || ""
    store.touchUsage(hashKey(token), clientIp).catch(() => {})

    return { ok: true, record: result.record, error: null, statusCode: 200 }
  }

  /**
   * Disable a key by key_id.
   */
  async function disableKey(keyId) {
    return store.updateKey(keyId, { status: "disabled" })
  }

  /**
   * Re-enable a key by key_id.
   */
  async function enableKey(keyId) {
    return store.updateKey(keyId, { status: "active" })
  }

  /**
   * Update key metadata (label, note).
   */
  async function updateKey(keyId, patch) {
    return store.updateKey(keyId, patch)
  }

  /**
   * Get a key record by key_id.
   */
  async function getKey(keyId) {
    return store.getById(keyId)
  }

  /**
   * List all keys.
   */
  async function listKeys() {
    return store.listAll()
  }

  /**
   * Delete a key permanently.
   */
  async function deleteKey(keyId) {
    return store.removeById(keyId)
  }

  /**
   * Get registry statistics.
   */
  async function getStats() {
    return store.getStats()
  }

  return {
    createKey,
    validateToken,
    authenticateRequest,
    disableKey,
    enableKey,
    updateKey,
    getKey,
    listKeys,
    deleteKey,
    getStats
  }
}
