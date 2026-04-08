import { createRequestMeta } from "../shared/wireMeta.mjs"

export const TOOL_PROTOCOL_VERSION = "2026-04-05"

function buildEnvelope(type, payload, source) {
  return {
    type,
    protocol_version: TOOL_PROTOCOL_VERSION,
    ...createRequestMeta({ source }),
    payload
  }
}

export function buildToolCallMessage({
  routing,
  toolCallId,
  toolName,
  args = {},
  timeoutMs = 10000,
  source = "cc-official-broker:broker"
}) {
  return buildEnvelope(
    "tool.call",
    {
      routing,
      tool_call: {
        id: toolCallId,
        name: toolName,
        arguments: args,
        timeout_ms: timeoutMs
      }
    },
    source
  )
}

export function buildToolResultMessage({
  routing,
  toolCallId,
  toolName,
  result,
  source = "cc-official-broker:runner"
}) {
  return buildEnvelope(
    "tool.result",
    {
      routing,
      tool_call: {
        id: toolCallId,
        name: toolName
      },
      result
    },
    source
  )
}
