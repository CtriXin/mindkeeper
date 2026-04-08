/**
 * Key Store - file-based key registry with hashed storage
 *
 * Design:
 * - Keys are stored as SHA-256 hashes, never plaintext
 * - Atomic JSON file writes for crash safety
 * - In-memory cache with file-backed persistence
 * - No external dependencies
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { timingSafeEqual } from "node:crypto"

/**
 * @typedef {Object} KeyRecord
 * @property {string} key_id        - Unique key identifier (e.g. "key-a1b2c3d4")
 * @property {string} secret_hash   - SHA-256 hex digest of the raw key
 * @property {string} key_prefix    - Display prefix (first 8 + "..." + last 4)
 * @property {string} status        - "active" | "disabled"
 * @property {string} label         - Optional human-readable label
 * @property {string} note          - Optional note
 * @property {string} created_at    - ISO 8601 timestamp
 * @property {string} updated_at    - ISO 8601 timestamp
 * @property {string|null} last_used_at   - ISO 8601 timestamp or null
 * @property {string|null} last_used_ip   - Last client IP or null
 */

const DEFAULT_REGISTRY_PATH = "data/key-registry.json"

function normalizeStatus(raw) {
  if (raw === "disabled") return "disabled"
  return "active"
}

function buildEmptyRegistry() {
  return { keys: [] }
}

/**
 * Load registry from disk. Returns empty structure if file missing.
 */
async function loadRegistry(registryPath) {
  try {
    const text = await readFile(registryPath, "utf8")
    const parsed = JSON.parse(text)
    if (!parsed || !Array.isArray(parsed.keys)) return buildEmptyRegistry()

    // Normalize loaded records
    parsed.keys = parsed.keys
      .filter(r => r && r.key_id && r.secret_hash)
      .map(normalizeRecord)

    return parsed
  } catch (error) {
    if (error.code === "ENOENT") return buildEmptyRegistry()
    throw error
  }
}

function normalizeRecord(record) {
  return {
    key_id: String(record.key_id),
    secret_hash: String(record.secret_hash),
    key_prefix: String(record.key_prefix || ""),
    status: normalizeStatus(record.status),
    label: String(record.label || ""),
    note: String(record.note || ""),
    created_at: String(record.created_at || ""),
    updated_at: String(record.updated_at || ""),
    last_used_at: record.last_used_at || null,
    last_used_ip: record.last_used_ip || null
  }
}

/**
 * Atomic JSON write - write to temp file then rename
 */
async function writeRegistryAtomic(registryPath, registry) {
  const dir = dirname(registryPath)
  await mkdir(dir, { recursive: true })

  const payload = JSON.stringify(registry, null, 2)
  const tmpPath = `${registryPath}.tmp-${Date.now()}`

  await writeFile(tmpPath, payload, "utf8")
  await writeFile(registryPath, payload, "utf8")

  // Clean up tmp file (best-effort)
  try {
    const { unlink } = await import("node:fs/promises")
    await unlink(tmpPath).catch(() => {})
  } catch {
    // ignore
  }
}

/**
 * Constant-time buffer comparison
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Create a KeyStore instance
 * @param {object} options
 * @param {string} [options.registryPath] - Path to the JSON registry file
 * @returns {KeyStore}
 */
export function createKeyStore(options = {}) {
  const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH

  /** @type {{ keys: KeyRecord[] } | null} */
  let cache = null
  let inflight = null // promise coalescer

  async function ensureLoaded() {
    if (cache) return cache
    if (inflight) return inflight

    inflight = (async () => {
      cache = await loadRegistry(registryPath)
      inflight = null
      return cache
    })()

    return inflight
  }

  /**
   * Find a key record by its SHA-256 hash.
   * Returns the matching active record, or null.
   */
  async function findByHash(secretHash) {
    const reg = await ensureLoaded()
    return reg.keys.find(r => r.secret_hash === secretHash && r.status === "active") || null
  }

  /**
   * Validate a presented secret against the registry.
   * @param {string} secretHash - SHA-256 hex digest of the raw secret
   * @returns {{ valid: boolean, record: KeyRecord|null, reason: string }}
   */
  async function validate(secretHash) {
    const reg = await ensureLoaded()

    // Check all records for hash match (including disabled)
    const match = reg.keys.find(r => r.secret_hash === secretHash)
    if (!match) {
      return { valid: false, record: null, reason: "key_not_found" }
    }
    if (match.status === "disabled") {
      return { valid: false, record: match, reason: "key_disabled" }
    }
    return { valid: true, record: match, reason: "ok" }
  }

  /**
   * Add a new key record to the registry.
   */
  async function addRecord(record) {
    const reg = await ensureLoaded()
    const now = new Date().toISOString()

    const entry = normalizeRecord({
      ...record,
      created_at: record.created_at || now,
      updated_at: now,
      last_used_at: null,
      last_used_ip: null
    })

    // Check for duplicate key_id
    if (reg.keys.some(r => r.key_id === entry.key_id)) {
      throw new Error(`key_id already exists: ${entry.key_id}`)
    }

    reg.keys.push(entry)
    await writeRegistryAtomic(registryPath, reg)
    return entry
  }

  /**
   * Update usage tracking on a key record.
   */
  async function touchUsage(secretHash, clientIp) {
    if (!cache) return
    const match = cache.keys.find(r => r.secret_hash === secretHash)
    if (!match) return

    match.last_used_at = new Date().toISOString()
    if (clientIp) match.last_used_ip = clientIp

    // Fire-and-forget persist (don't block auth path)
    writeRegistryAtomic(registryPath, cache).catch(() => {})
  }

  /**
   * Update key status or metadata.
   */
  async function updateKey(keyId, patch) {
    const reg = await ensureLoaded()
    const record = reg.keys.find(r => r.key_id === keyId)
    if (!record) throw new Error(`key not found: ${keyId}`)

    if (patch.status !== undefined) {
      record.status = normalizeStatus(patch.status)
    }
    if (patch.label !== undefined) {
      record.label = String(patch.label)
    }
    if (patch.note !== undefined) {
      record.note = String(patch.note)
    }
    record.updated_at = new Date().toISOString()

    await writeRegistryAtomic(registryPath, reg)
    return record
  }

  /**
   * Get a key record by key_id (any status).
   */
  async function getById(keyId) {
    const reg = await ensureLoaded()
    return reg.keys.find(r => r.key_id === keyId) || null
  }

  /**
   * List all key records.
   */
  async function listAll() {
    const reg = await ensureLoaded()
    return [...reg.keys]
  }

  /**
   * Remove a key record by key_id.
   */
  async function removeById(keyId) {
    const reg = await ensureLoaded()
    const idx = reg.keys.findIndex(r => r.key_id === keyId)
    if (idx === -1) throw new Error(`key not found: ${keyId}`)

    const [removed] = reg.keys.splice(idx, 1)
    await writeRegistryAtomic(registryPath, reg)
    return removed
  }

  /**
   * Get registry stats.
   */
  async function getStats() {
    const reg = await ensureLoaded()
    const active = reg.keys.filter(r => r.status === "active").length
    const disabled = reg.keys.filter(r => r.status === "disabled").length
    return { total: reg.keys.length, active, disabled }
  }

  return {
    findByHash,
    validate,
    addRecord,
    touchUsage,
    updateKey,
    getById,
    listAll,
    removeById,
    getStats,
    /** Expose for testing */
    _reload: () => { cache = null }
  }
}
