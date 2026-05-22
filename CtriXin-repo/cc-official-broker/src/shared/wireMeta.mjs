import { randomUUID } from "node:crypto"

export function createRequestMeta({ source = "cc-official-broker" } = {}) {
  return {
    request_id: randomUUID(),
    requested_at: new Date().toISOString(),
    source
  }
}
