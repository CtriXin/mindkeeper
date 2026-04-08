/**
 * Runtime Registry and State Management
 * Minimal runtime lifecycle for native gateway
 *
 * State model:
 * - enabled: bool (can accept new sessions)
 * - draining: bool (no new sessions, existing continue)
 * - unhealthy: bool (marked unhealthy, won't be selected)
 *
 * Derived routing_status:
 * - "enabled" -> accepting new sessions
 * - "disabled" -> not accepting, no active sessions
 * - "draining" -> not accepting new, existing continue
 * - "unhealthy" -> failed health check, won't be selected
 *
 * Phase 1 scope:
 * - Local state management (file-based)
 * - Health tracking (consecutive failures, auto-unhealthy)
 * - Selection guard (won't select disabled/unhealthy/draining for new)
 * - No real server runtime pool integration yet
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"

const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_AUTO_UNHEALTHY_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Normalize runtime ID
 * @param {string} runtimeId
 * @returns {string}
 */
export function normalizeRuntimeId(runtimeId) {
  const normalized = String(runtimeId || "").trim().toLowerCase()
  // Allow alphanumeric, hyphen, underscore
  return normalized.replace(/[^a-z0-9_-]/g, "")
}

/**
 * Build empty runtime registry
 * @returns {object}
 */
export function buildEmptyRegistry() {
  return {
    version: 1,
    default_runtime_id: "",
    runtimes: []
  }
}

/**
 * Build empty runtime state
 * @returns {object}
 */
export function buildEmptyState() {
  return {
    version: 1,
    runtimes: {}
  }
}

/**
 * Runtime registry manager
 * Manages the static configuration of runtimes
 */
export class RuntimeRegistry {
  constructor(registryPath) {
    this.registryPath = registryPath
    this.ensureDir()
  }

  ensureDir() {
    const dir = dirname(this.registryPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  read() {
    try {
      if (!existsSync(this.registryPath)) {
        return buildEmptyRegistry()
      }
      const content = readFileSync(this.registryPath, "utf-8")
      return JSON.parse(content)
    } catch {
      return buildEmptyRegistry()
    }
  }

  write(registry) {
    this.ensureDir()
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2))
  }

  /**
   * Add or update a runtime in registry
   * @param {object} runtimeConfig
   * @param {string} runtimeConfig.runtime_id
   * @param {string} runtimeConfig.base_url
   * @param {string} runtimeConfig.label
   * @param {boolean} runtimeConfig.enabled
   */
  upsert(runtimeConfig) {
    const registry = this.read()
    const runtimeId = normalizeRuntimeId(runtimeConfig.runtime_id)

    const existingIndex = registry.runtimes.findIndex(
      r => normalizeRuntimeId(r.runtime_id) === runtimeId
    )

    const normalized = {
      runtime_id: runtimeId,
      base_url: String(runtimeConfig.base_url || "").trim(),
      label: String(runtimeConfig.label || runtimeId).trim(),
      enabled: runtimeConfig.enabled !== false, // default true
      created_at: existingIndex >= 0
        ? registry.runtimes[existingIndex].created_at
        : Date.now()
    }

    if (existingIndex >= 0) {
      registry.runtimes[existingIndex] = normalized
    } else {
      registry.runtimes.push(normalized)
    }

    // Set as default if first runtime
    if (!registry.default_runtime_id && registry.runtimes.length === 1) {
      registry.default_runtime_id = runtimeId
    }

    this.write(registry)
    return normalized
  }

  /**
   * Get runtime by ID
   * @param {string} runtimeId
   * @returns {object|null}
   */
  get(runtimeId) {
    const registry = this.read()
    const normalized = normalizeRuntimeId(runtimeId)
    return registry.runtimes.find(
      r => normalizeRuntimeId(r.runtime_id) === normalized
    ) || null
  }

  /**
   * List all runtimes
   * @returns {object[]}
   */
  list() {
    return this.read().runtimes
  }

  /**
   * Set default runtime
   * @param {string} runtimeId
   */
  setDefault(runtimeId) {
    const registry = this.read()
    const normalized = normalizeRuntimeId(runtimeId)
    const exists = registry.runtimes.some(
      r => normalizeRuntimeId(r.runtime_id) === normalized
    )
    if (!exists) {
      throw new Error(`Runtime ${runtimeId} not found`)
    }
    registry.default_runtime_id = normalized
    this.write(registry)
  }

  /**
   * Get default runtime ID
   * @returns {string}
   */
  getDefault() {
    const registry = this.read()
    return registry.default_runtime_id || ""
  }
}

/**
 * Runtime state manager
 * Manages dynamic runtime state (health, selection count, etc.)
 */
export class RuntimeState {
  constructor(statePath, options = {}) {
    this.statePath = statePath
    this.failureThreshold = options.failureThreshold || DEFAULT_FAILURE_THRESHOLD
    this.autoUnhealthyCooldownMs = options.autoUnhealthyCooldownMs || DEFAULT_AUTO_UNHEALTHY_COOLDOWN_MS
    this.ensureDir()
  }

  ensureDir() {
    const dir = dirname(this.statePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  read() {
    try {
      if (!existsSync(this.statePath)) {
        return buildEmptyState()
      }
      const content = readFileSync(this.statePath, "utf-8")
      return JSON.parse(content)
    } catch {
      return buildEmptyState()
    }
  }

  write(state) {
    this.ensureDir()
    writeFileSync(this.statePath, JSON.stringify(state, null, 2))
  }

  /**
   * Get or create runtime state entry
   * @param {string} runtimeId
   * @returns {object}
   */
  getEntry(runtimeId) {
    const state = this.read()
    const normalized = normalizeRuntimeId(runtimeId)

    if (!state.runtimes[normalized]) {
      state.runtimes[normalized] = this.buildEmptyEntry()
      this.write(state)
    }

    return state.runtimes[normalized]
  }

  buildEmptyEntry() {
    return {
      enabled: null, // null = use registry default
      draining: false,
      unhealthy: false,
      last_error: "",
      last_selected_at: 0,
      selected_count: 0,
      health_state: {
        consecutive_failures: 0,
        last_failure_at: 0,
        last_success_at: 0,
        auto_unhealthy_until_ts: 0,
        auto_unhealthy_reason: ""
      }
    }
  }

  /**
   * Update runtime state
   * @param {string} runtimeId
   * @param {object} updates
   */
  update(runtimeId, updates) {
    const state = this.read()
    const normalized = normalizeRuntimeId(runtimeId)

    const current = state.runtimes[normalized] || this.buildEmptyEntry()
    state.runtimes[normalized] = { ...current, ...updates }

    this.write(state)
    return state.runtimes[normalized]
  }

  /**
   * Record successful request
   * @param {string} runtimeId
   */
  recordSuccess(runtimeId) {
    const now = Date.now()
    return this.update(runtimeId, {
      last_error: "",
      health_state: {
        consecutive_failures: 0,
        last_failure_at: 0,
        last_success_at: now,
        auto_unhealthy_until_ts: 0,
        auto_unhealthy_reason: ""
      }
    })
  }

  /**
   * Record failed request
   * @param {string} runtimeId
   * @param {Error} error
   * @param {boolean} hasOtherHealthyCandidate - Whether other healthy runtimes exist (for auto-unhealthy guard)
   */
  recordFailure(runtimeId, error, hasOtherHealthyCandidate = false) {
    const entry = this.getEntry(runtimeId)
    const healthState = entry.health_state || {}
    const now = Date.now()

    const consecutiveFailures = (healthState.consecutive_failures || 0) + 1
    let autoUnhealthyUntilTs = healthState.auto_unhealthy_until_ts || 0
    let autoUnhealthyReason = healthState.auto_unhealthy_reason || ""

    // Auto-mark unhealthy if threshold reached AND there's another healthy candidate
    // This prevents the last healthy runtime from being auto-marked unhealthy
    if (this.autoUnhealthyCooldownMs > 0 &&
        consecutiveFailures >= this.failureThreshold &&
        hasOtherHealthyCandidate) {
      autoUnhealthyUntilTs = now + this.autoUnhealthyCooldownMs
      autoUnhealthyReason = "auto_runtime_failure_threshold"
    }

    return this.update(runtimeId, {
      last_error: String(error?.message || error).slice(0, 160),
      health_state: {
        consecutive_failures: consecutiveFailures,
        last_failure_at: now,
        last_success_at: healthState.last_success_at || 0,
        auto_unhealthy_until_ts: autoUnhealthyUntilTs,
        auto_unhealthy_reason: autoUnhealthyReason
      }
    })
  }

  /**
   * Record runtime selection
   * @param {string} runtimeId
   */
  recordSelection(runtimeId) {
    const entry = this.getEntry(runtimeId)
    return this.update(runtimeId, {
      last_selected_at: Date.now(),
      selected_count: (entry.selected_count || 0) + 1
    })
  }

  /**
   * Set runtime enabled/disabled
   * @param {string} runtimeId
   * @param {boolean} enabled
   */
  setEnabled(runtimeId, enabled) {
    return this.update(runtimeId, { enabled })
  }

  /**
   * Set runtime draining state
   * @param {string} runtimeId
   * @param {boolean} draining
   */
  setDraining(runtimeId, draining) {
    return this.update(runtimeId, { draining })
  }

  /**
   * Set runtime unhealthy state
   * @param {string} runtimeId
   * @param {boolean} unhealthy
   * @param {string} reason
   */
  setUnhealthy(runtimeId, unhealthy, reason = "") {
    const updates = { unhealthy }
    if (reason) {
      updates.last_error = String(reason).slice(0, 160)
    }
    return this.update(runtimeId, updates)
  }

  /**
   * Clear error and reset health
   * @param {string} runtimeId
   */
  clearError(runtimeId) {
    const entry = this.getEntry(runtimeId)
    const healthState = entry.health_state || {}

    return this.update(runtimeId, {
      last_error: "",
      unhealthy: false,
      health_state: {
        consecutive_failures: 0,
        last_failure_at: 0,
        last_success_at: healthState.last_success_at || Date.now(),
        auto_unhealthy_until_ts: 0,
        auto_unhealthy_reason: ""
      }
    })
  }
}

/**
 * Compute effective routing status
 * @param {object} configEntry - From registry
 * @param {object} stateEntry - From state
 * @returns {string} routing_status
 */
export function computeRoutingStatus(configEntry, stateEntry) {
  const configEnabled = configEntry?.enabled !== false // default true
  const stateEnabled = stateEntry?.enabled

  // State overrides config if explicitly set
  const effectiveEnabled = stateEnabled !== null && stateEnabled !== undefined
    ? stateEnabled
    : configEnabled

  const effectiveDraining = stateEntry?.draining || false
  const effectiveUnhealthy = stateEntry?.unhealthy || false

  // Check auto-unhealthy
  const healthState = stateEntry?.health_state || {}
  const autoUnhealthyUntil = healthState.auto_unhealthy_until_ts || 0
  const autoUnhealthyActive = autoUnhealthyUntil > Date.now()

  if (!effectiveEnabled) {
    return "disabled"
  }
  if (effectiveUnhealthy || autoUnhealthyActive) {
    return "unhealthy"
  }
  if (effectiveDraining) {
    return "draining"
  }
  return "enabled"
}

/**
 * Check if runtime can accept new sessions
 * @param {object} configEntry
 * @param {object} stateEntry
 * @returns {boolean}
 */
export function canAcceptNewSessions(configEntry, stateEntry) {
  const status = computeRoutingStatus(configEntry, stateEntry)
  return status === "enabled"
}

/**
 * Check if runtime can continue existing sessions
 * @param {object} configEntry
 * @param {object} stateEntry
 * @returns {boolean}
 */
export function canContinueSessions(configEntry, stateEntry) {
  const status = computeRoutingStatus(configEntry, stateEntry)
  // draining and enabled can continue; disabled and unhealthy cannot
  return status === "enabled" || status === "draining"
}

/**
 * Build runtime pool entry with derived state
 * @param {object} configEntry
 * @param {object} stateEntry
 * @returns {object}
 */
export function buildRuntimePoolEntry(configEntry, stateEntry) {
  const routingStatus = computeRoutingStatus(configEntry, stateEntry)
  const healthState = stateEntry?.health_state || {}
  const autoUnhealthyActive = (healthState.auto_unhealthy_until_ts || 0) > Date.now()

  // Compute effective enabled state (state overrides config)
  const configEnabled = configEntry?.enabled !== false
  const stateEnabled = stateEntry?.enabled
  const effectiveEnabled = stateEnabled !== null && stateEnabled !== undefined
    ? stateEnabled
    : configEnabled

  return {
    ...configEntry,
    // Effective state (state overrides config)
    enabled: effectiveEnabled,
    draining: stateEntry?.draining || false,
    unhealthy: (stateEntry?.unhealthy || false) || autoUnhealthyActive,
    routing_status: routingStatus,
    can_accept_new: routingStatus === "enabled",
    can_continue: routingStatus === "enabled" || routingStatus === "draining",

    // Operational metrics
    last_error: stateEntry?.last_error || "",
    last_selected_at: stateEntry?.last_selected_at || 0,
    selected_count: stateEntry?.selected_count || 0,

    // Health details
    health_state: {
      consecutive_failures: healthState.consecutive_failures || 0,
      last_failure_at: healthState.last_failure_at || 0,
      last_success_at: healthState.last_success_at || 0,
      auto_unhealthy_until_ts: healthState.auto_unhealthy_until_ts || 0,
      auto_unhealthy_active: autoUnhealthyActive,
      auto_unhealthy_reason: healthState.auto_unhealthy_reason || ""
    }
  }
}

/**
 * Runtime pool manager
 * Combines registry and state for high-level operations
 */
export class RuntimePool {
  constructor(registryPath, statePath, options = {}) {
    this.registry = new RuntimeRegistry(registryPath)
    this.state = new RuntimeState(statePath, options)
  }

  /**
   * Get full runtime entry with derived state
   * @param {string} runtimeId
   * @returns {object|null}
   */
  get(runtimeId) {
    const config = this.registry.get(runtimeId)
    if (!config) return null

    const stateEntry = this.state.getEntry(runtimeId)
    return buildRuntimePoolEntry(config, stateEntry)
  }

  /**
   * List all runtimes with derived state
   * @returns {object[]}
   */
  list() {
    const configs = this.registry.list()
    return configs.map(config => {
      const stateEntry = this.state.getEntry(config.runtime_id)
      return buildRuntimePoolEntry(config, stateEntry)
    })
  }

  /**
   * Select runtime for new session
   * Returns first enabled runtime, or null if none available
   * Phase 1: Simple first-match (no sophisticated load balancing)
   * @returns {object|null}
   */
  selectForNewSession() {
    const entries = this.list()

    for (const entry of entries) {
      if (entry.can_accept_new) {
        this.state.recordSelection(entry.runtime_id)
        return entry
      }
    }

    return null
  }

  /**
   * Check if pool has any healthy runtime accepting new sessions
   * @returns {boolean}
   */
  hasHealthyRuntime() {
    return this.list().some(entry => entry.can_accept_new)
  }

  /**
   * Set runtime state with guard (prevent disabling all runtimes)
   * @param {string} runtimeId
   * @param {object} updates
   * @param {boolean} updates.enabled
   * @param {boolean} updates.draining
   * @param {boolean} updates.unhealthy
   */
  setRuntimeState(runtimeId, updates) {
    const normalized = normalizeRuntimeId(runtimeId)
    const current = this.get(normalized)

    if (!current) {
      throw new Error(`Runtime ${runtimeId} not found`)
    }

    // Guard: prevent disabling/draining all runtimes
    if (updates.enabled === false || updates.unhealthy === true) {
      const otherHealthy = this.list().some(
        e => e.runtime_id !== normalized && e.can_accept_new
      )
      if (!otherHealthy) {
        throw new Error("At least one enabled healthy runtime must remain")
      }
    }

    // Apply updates
    if (updates.enabled !== undefined) {
      this.state.setEnabled(normalized, updates.enabled)
    }
    if (updates.draining !== undefined) {
      this.state.setDraining(normalized, updates.draining)
    }
    if (updates.unhealthy !== undefined) {
      this.state.setUnhealthy(normalized, updates.unhealthy, updates.reason)
    }
    if (updates.clear_error) {
      this.state.clearError(normalized)
    }

    return this.get(normalized)
  }

  /**
   * Record request outcome
   * @param {string} runtimeId
   * @param {boolean} success
   * @param {Error} error
   */
  recordOutcome(runtimeId, success, error = null) {
    if (success) {
      return this.state.recordSuccess(runtimeId)
    } else {
      // Check if there are other healthy runtimes before allowing auto-unhealthy
      const otherHealthy = this.list().some(
        e => e.runtime_id !== normalizeRuntimeId(runtimeId) && e.can_accept_new
      )
      return this.state.recordFailure(runtimeId, error, otherHealthy)
    }
  }
}
