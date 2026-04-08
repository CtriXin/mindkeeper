/**
 * IP Allowlist Utilities
 * Minimal IP parsing and validation for source IP allowlist
 * Adapted from cc-mcp-bridge Python implementation
 */

import net from "net"

/**
 * Parse IP allowlist from string or array
 * Supports IPv4 and IPv6, with CIDR notation
 * @param {string|string[]} value - CSV string or array of IP/CIDR
 * @returns {string[]} Array of normalized CIDR strings
 */
export function parseIpAllowlist(value) {
  const items = Array.isArray(value)
    ? value.map(item => String(item || "").trim())
    : String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean)

  const normalized = []
  for (const item of items) {
    if (!item) continue

    try {
      const cidr = normalizeToCidr(item)
      if (cidr) normalized.push(cidr)
    } catch {
      // Skip invalid IPs
      continue
    }
  }
  return normalized
}

/**
 * Normalize IP or CIDR to canonical CIDR string
 * @param {string} item - IP address or CIDR
 * @returns {string|null} Normalized CIDR or null if invalid
 */
function normalizeToCidr(item) {
  const trimmed = String(item).trim()
  if (!trimmed) return null

  // Already has CIDR notation
  if (trimmed.includes("/")) {
    const [ip, prefix] = trimmed.split("/")
    const prefixNum = parseInt(prefix, 10)

    if (net.isIPv4(ip)) {
      if (prefixNum < 0 || prefixNum > 32) return null
      return `${ip}/${prefixNum}`
    }
    if (net.isIPv6(ip)) {
      if (prefixNum < 0 || prefixNum > 128) return null
      return `${ip}/${prefixNum}`
    }
    return null
  }

  // Single IP - convert to /32 or /128
  if (net.isIPv4(trimmed)) {
    return `${trimmed}/32`
  }
  if (net.isIPv6(trimmed)) {
    return `${trimmed}/128`
  }

  return null
}

/**
 * Check if an IP address is in the allowlist
 * @param {string} clientIp - Client IP address
 * @param {string[]} allowlist - Array of CIDR strings
 * @returns {boolean} True if allowed or allowlist is empty
 */
export function isIpAllowed(clientIp, allowlist) {
  const ipText = String(clientIp || "").trim()

  // Empty allowlist = allow all (backward compatible)
  if (!allowlist || allowlist.length === 0) {
    return true
  }

  // No client IP provided but allowlist is configured = deny
  if (!ipText) {
    return false
  }

  // Check if IP is in any of the allowed CIDRs
  for (const cidr of allowlist) {
    if (ipInCidr(ipText, cidr)) {
      return true
    }
  }

  return false
}

/**
 * Check if IP is within a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR range (e.g., "192.168.1.0/24")
 * @returns {boolean}
 */
function ipInCidr(ip, cidr) {
  try {
    const [networkIp, prefixStr] = cidr.split("/")
    const prefix = parseInt(prefixStr, 10)

    if (net.isIPv4(ip) && net.isIPv4(networkIp)) {
      return ipv4InCidr(ip, networkIp, prefix)
    }

    if (net.isIPv6(ip) && net.isIPv6(networkIp)) {
      return ipv6InCidr(ip, networkIp, prefix)
    }

    return false
  } catch {
    return false
  }
}

/**
 * Check IPv4 address against CIDR
 * @param {string} ip - IPv4 address
 * @param {string} networkIp - Network address
 * @param {number} prefix - CIDR prefix (0-32)
 * @returns {boolean}
 */
function ipv4InCidr(ip, networkIp, prefix) {
  const ipNum = ipv4ToNumber(ip)
  const networkNum = ipv4ToNumber(networkIp)
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0)

  return (ipNum & mask) === (networkNum & mask)
}

/**
 * Convert IPv4 to 32-bit number
 * @param {string} ip - IPv4 address
 * @returns {number}
 */
function ipv4ToNumber(ip) {
  const parts = ip.split(".").map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/**
 * Check IPv6 address against CIDR
 * @param {string} ip - IPv6 address
 * @param {string} networkIp - Network address
 * @param {number} prefix - CIDR prefix (0-128)
 * @returns {boolean}
 */
function ipv6InCidr(ip, networkIp, prefix) {
  const ipBytes = ipv6ToBytes(ip)
  const networkBytes = ipv6ToBytes(networkIp)

  // Compare full bytes first
  const fullBytes = Math.floor(prefix / 8)
  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== networkBytes[i]) return false
  }

  // Check remaining bits
  const remainingBits = prefix % 8
  if (remainingBits > 0) {
    const mask = (0xff << (8 - remainingBits)) & 0xff
    if ((ipBytes[fullBytes] & mask) !== (networkBytes[fullBytes] & mask)) {
      return false
    }
  }

  return true
}

/**
 * Convert IPv6 to byte array
 * @param {string} ip - IPv6 address
 * @returns {number[]} 16-byte array
 */
function ipv6ToBytes(ip) {
  // Expand compressed notation
  const expanded = expandIPv6(ip)
  const parts = expanded.split(":")
  const bytes = []

  for (const part of parts) {
    const num = parseInt(part, 16)
    bytes.push((num >> 8) & 0xff, num & 0xff)
  }

  return bytes
}

/**
 * Expand compressed IPv6 notation
 * @param {string} ip - IPv6 address (may be compressed)
 * @returns {string} Expanded form
 */
function expandIPv6(ip) {
  if (!ip.includes("::")) {
    return ip
  }

  const [left, right] = ip.split("::")
  const leftParts = left ? left.split(":") : []
  const rightParts = right ? right.split(":") : []
  const missing = 8 - leftParts.length - rightParts.length

  const middle = Array(missing).fill("0000")
  const allParts = [...leftParts, ...middle, ...rightParts]

  return allParts.map(p => p.padStart(4, "0")).join(":")
}

/**
 * Extract client IP from request
 * @param {object} req - HTTP request object (Node.js IncomingMessage style)
 * @param {boolean} trustXForwardedFor - Whether to trust X-Forwarded-For header
 * @returns {string|null} Client IP or null
 */
export function getClientIp(req, trustXForwardedFor = false) {
  // Check X-Forwarded-For if trusted (e.g., behind trusted proxy)
  if (trustXForwardedFor) {
    const forwarded = req.headers?.["x-forwarded-for"]
    if (forwarded) {
      // Take the first IP in the chain (closest to original client)
      const ips = String(forwarded).split(",").map(ip => ip.trim())
      const firstIp = ips[0]
      if (firstIp && (net.isIPv4(firstIp) || net.isIPv6(firstIp))) {
        return firstIp
      }
    }
  }

  // Fall back to connection remote address
  const remoteAddr = req.socket?.remoteAddress || req.connection?.remoteAddress
  if (remoteAddr) {
    // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
    const ipv4Mapped = remoteAddr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (ipv4Mapped) {
      return ipv4Mapped[1]
    }
    return remoteAddr
  }

  return null
}

/**
 * Build source IP info for logging/audit
 * @param {object} req - HTTP request object
 * @param {boolean} trustXForwardedFor - Whether X-Forwarded-For is trusted
 * @returns {object} Source IP info
 */
export function buildSourceIpInfo(req, trustXForwardedFor = false) {
  const clientIp = getClientIp(req, trustXForwardedFor)
  const rawForwarded = req.headers?.["x-forwarded-for"]
  const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress

  return {
    clientIp: clientIp || "unknown",
    remoteAddress: remoteAddress || "unknown",
    xForwardedFor: rawForwarded ? String(rawForwarded) : undefined,
    trustXForwardedFor
  }
}
