/**
 * Source IP Allowlist Middleware
 * Minimal middleware for gateway-level IP filtering
 * Place before auth middleware in request pipeline
 */

import { getClientIp, isIpAllowed, buildSourceIpInfo } from "../shared/ipUtils.mjs"

/**
 * Create IP allowlist middleware
 * @param {object} config - Configuration object
 * @param {string[]} config.allowedSourceIps - Array of allowed CIDRs
 * @param {boolean} config.trustXForwardedFor - Whether to trust X-Forwarded-For
 * @param {object} options - Optional settings
 * @param {function} options.onReject - Callback when IP is rejected: (req, res, ipInfo) => void
 * @param {function} options.onAllow - Callback when IP is allowed: (req, ipInfo) => void
 * @returns {function} Express/Connect-style middleware (req, res, next) => void
 */
export function createIpAllowlistMiddleware(config, options = {}) {
  const allowlist = config.allowedSourceIps || []
  const trustXForwardedFor = config.trustXForwardedFor || false

  // Pre-check: if no allowlist configured, middleware is a no-op (backward compatible)
  const hasAllowlist = allowlist.length > 0

  return function ipAllowlistMiddleware(req, res, next) {
    // No allowlist configured = allow all
    if (!hasAllowlist) {
      return next()
    }

    const clientIp = getClientIp(req, trustXForwardedFor)
    const ipInfo = buildSourceIpInfo(req, trustXForwardedFor)

    // Attach IP info to request for downstream use
    req.sourceIpInfo = ipInfo

    // Check if allowed
    const allowed = isIpAllowed(clientIp, allowlist)

    if (!allowed) {
      // Call reject handler if provided
      if (options.onReject) {
        try {
          options.onReject(req, res, ipInfo)
        } catch {
          // Ignore handler errors
        }
      }

      // Return 403 Forbidden
      res.statusCode = 403
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        error: "source_ip_not_allowed",
        message: "Request source IP is not in the allowlist",
        client_ip: clientIp || "unknown",
        timestamp: new Date().toISOString()
      }))
      return
    }

    // Call allow handler if provided
    if (options.onAllow) {
      try {
        options.onAllow(req, ipInfo)
      } catch {
        // Ignore handler errors
      }
    }

    next()
  }
}

/**
 * Create IP allowlist guard function for non-middleware usage
 * @param {object} config - Configuration object
 * @returns {function} Guard function: (req) => { allowed: boolean, ipInfo: object }
 */
export function createIpAllowlistGuard(config) {
  const allowlist = config.allowedSourceIps || []
  const trustXForwardedFor = config.trustXForwardedFor || false
  const hasAllowlist = allowlist.length > 0

  return function guard(req) {
    // No allowlist = always allow
    if (!hasAllowlist) {
      return { allowed: true, ipInfo: buildSourceIpInfo(req, trustXForwardedFor) }
    }

    const clientIp = getClientIp(req, trustXForwardedFor)
    const ipInfo = buildSourceIpInfo(req, trustXForwardedFor)
    const allowed = isIpAllowed(clientIp, allowlist)

    return { allowed, ipInfo }
  }
}

/**
 * Build allowlist status summary for health checks / diagnostics
 * @param {object} config - Configuration object
 * @returns {object} Status summary
 */
export function buildAllowlistStatus(config) {
  const allowlist = config.allowedSourceIps || []

  return {
    enabled: allowlist.length > 0,
    rule_count: allowlist.length,
    trust_x_forwarded_for: config.trustXForwardedFor || false,
    // Don't expose actual IPs in status for security
    has_rules: allowlist.length > 0
  }
}
