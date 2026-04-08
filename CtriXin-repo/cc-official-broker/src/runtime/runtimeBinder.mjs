/**
 * Runtime Binder
 * Sticky runtime binding decision logic.
 *
 * Bindings are determined by the sticky key:
 *   owner_user_id + device_id + workspace_id + session_id
 *
 * Behavior:
 * - New session (no binding): select a healthy runtime from RuntimePool → create binding.
 * - Existing binding, runtime healthy (can_continue): reuse the same runtime → refresh updated_at.
 * - Existing binding, runtime unhealthy/disabled: Phase 1 → fail-fast (no auto-migration).
 *
 * Phase 1 explicitly does NOT implement:
 * - Automatic session migration to a different healthy runtime
 * - Cross-runtime load balancing or rebinding
 * - TTL / expiration on bindings
 */

import { buildSessionKey } from "../shared/sessionKeys.mjs"

export class RuntimeBinder {
  /**
   * @param {object} options
   * @param {import("./runtimePool.mjs").RuntimePool} options.pool - RuntimePool instance for selection & health checks.
   * @param {import("./runtimeBindingStore.mjs").RuntimeBindingStore} options.store - Binding store instance.
   */
  constructor({ pool, store }) {
    this.pool = pool
    this.store = store
  }

  /**
   * Build a binding key from routing components.
   * @param {object} opts
   * @returns {string}
   */
  buildBindingKey({ ownerUserId, deviceId, workspaceId, sessionId }) {
    return buildSessionKey({ ownerUserId, deviceId, workspaceId, sessionId })
  }

  /**
   * Select (or reuse) a runtime for a session.
   *
   * Returns { runtime, reused, reason } where:
   * - runtime: the selected runtime entry (from RuntimePool) or null
   * - reused: boolean — true if we reused an existing binding
   * - reason: string — human-readable why this runtime was chosen
   *
   * Phase 1 fail-fast: if an existing binding points to an unhealthy/disabled
   * runtime, we return { runtime: null, reused: false, reason: "bound_runtime_unhealthy" }
   * and do NOT automatically rebind.  The caller is responsible for handling
   * this error condition.
   *
   * @param {object} opts
   * @param {string} opts.ownerUserId
   * @param {string} opts.deviceId
   * @param {string} opts.workspaceId
   * @param {string} opts.sessionId
   * @returns {{ runtime: object|null, reused: boolean, reason: string }}
   */
  selectRuntimeForSession({ ownerUserId, deviceId, workspaceId, sessionId }) {
    const bindingKey = this.buildBindingKey({ ownerUserId, deviceId, workspaceId, sessionId })

    // 1. Check for existing binding.
    const existing = this.store.get(bindingKey)
    if (existing) {
      const runtimeId = existing.runtime_id
      const runtime = this.pool.get(runtimeId)

      if (runtime && runtime.can_continue) {
        // Healthy: refresh updated_at and reuse.
        this.store.upsert(bindingKey, runtimeId, {
          source: "reused",
          reason: "resumed_session"
        })
        return { runtime, reused: true, reason: "reused_existing_binding" }
      }

      // Runtime unhealthy/disabled/draining → Phase 1 fail-fast.
      // Do NOT auto-migrate.  Log and return null.
      return {
        runtime: null,
        reused: false,
        reason: existing
          ? "bound_runtime_not_acceptable"
          : "no_binding_exists"
      }
    }

    // 2. No existing binding → select a new runtime from the pool.
    const selected = this.pool.selectForNewSession()
    if (!selected) {
      return { runtime: null, reused: false, reason: "no_healthy_runtime_available" }
    }

    // 3. Persist the new binding.
    this.store.upsert(bindingKey, selected.runtime_id, {
      source: "new",
      reason: "new_session"
    })

    return { runtime: selected, reused: false, reason: "created_new_binding" }
  }

  /**
   * Get the current binding for a session key (read-only, no side-effects).
   * @param {string} bindingKey
   * @returns {object|null}
   */
  getBinding(bindingKey) {
    return this.store.get(bindingKey)
  }

  /**
   * Get current binding + runtime health for a session key.
   * @param {object} opts
   * @returns {{ binding: object|null, runtime: object|null, healthy: boolean }}
   */
  getBindingWithRuntimeHealth({ ownerUserId, deviceId, workspaceId, sessionId }) {
    const bindingKey = this.buildBindingKey({ ownerUserId, deviceId, workspaceId, sessionId })
    const binding = this.store.get(bindingKey)
    if (!binding) {
      return { binding: null, runtime: null, healthy: false }
    }
    const runtime = this.pool.get(binding.runtime_id)
    const healthy = runtime ? runtime.can_continue : false
    return { binding, runtime, healthy }
  }

  /**
   * Remove a binding (e.g., when a session is explicitly terminated).
   * @param {string} bindingKey
   * @returns {boolean}
   */
  removeBinding(bindingKey) {
    return this.store.remove(bindingKey)
  }
}
