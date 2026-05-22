import { randomUUID } from "node:crypto"

import {
  fetchRemoteModels,
  fetchRemoteSessionState,
  fetchRemoteStats,
  promptRemoteService
} from "../broker/remoteServiceClient.mjs"
import { buildDeviceContext } from "../runner/deviceContext.mjs"

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function previewText(value = "", limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function buildRemoteAuthMode(config) {
  if (config.remoteServiceBearerToken) {
    return "bearer"
  }
  if (config.remoteServiceApiKey) {
    return "x-api-key"
  }
  return "missing"
}

function buildHealthUrl(baseUrl = "") {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/healthz`
}

async function probeHealthz(config) {
  const response = await fetch(buildHealthUrl(config.remoteServiceBaseUrl))
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    throw new Error(payload?.error || `remote healthz failed: ${response.status}`)
  }

  return {
    status: response.status,
    payload
  }
}

async function captureProbe(fn) {
  try {
    return {
      ok: true,
      ...(await fn())
    }
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error)
    }
  }
}

export async function runRemoteDoctor(config, { sessionId = "", promptPrefix = "remote-doctor" } = {}) {
  if (!config.remoteServiceBaseUrl) {
    throw new Error("CC_BROKER_REMOTE_SERVICE_BASE_URL is required")
  }
  if (!config.remoteServiceBearerToken && !config.remoteServiceApiKey) {
    throw new Error(
      "one of CC_BROKER_REMOTE_SERVICE_BEARER_TOKEN / CC_BROKER_REMOTE_SERVICE_X_API_KEY is required"
    )
  }

  const effectiveSessionId = sessionId || `doctor-${randomUUID().slice(0, 8)}`
  const deviceContext = buildDeviceContext({
    ownerUserId: config.ownerUserId,
    deviceId: config.deviceId,
    workspaceId: config.workspaceId,
    sessionId: effectiveSessionId
  })
  const routing = deviceContext.wireRouting

  const report = {
    ok: false,
    remote_service: {
      base_url: config.remoteServiceBaseUrl,
      auth_mode: buildRemoteAuthMode(config),
      endpoint: config.remoteServiceEndpoint,
      model: config.remoteServiceModel,
      label: config.remoteServiceLabel || ""
    },
    routing,
    probes: {},
    sticky: {
      ok: false,
      same_remote_session_id: false,
      second_turn_reused: false,
      remote_session_id_1: "",
      remote_session_id_2: "",
      session_state_remote_session_id: ""
    },
    notes: []
  }

  report.probes.healthz = await captureProbe(async () => {
    const result = await probeHealthz(config)
    return {
      status: result.status,
      service: result.payload.service || "",
      payload: result.payload
    }
  })

  report.probes.models = await captureProbe(async () => {
    const payload = await fetchRemoteModels({ config })
    return {
      count: Array.isArray(payload.data) ? payload.data.length : 0,
      ids: Array.isArray(payload.data) ? payload.data.map(item => item?.id).filter(Boolean).slice(0, 8) : []
    }
  })

  const firstTurn = await captureProbe(async () => {
    const result = await promptRemoteService({
      config,
      routing,
      input: `${promptPrefix} turn-1`,
      source: "cc-official-broker:remote-doctor"
    })

    return {
      endpoint: result.endpoint,
      response_id: result.responseId || "",
      previous_response_id: result.previousResponseId || "",
      remote_session_id: result.remoteSessionId || "",
      reused_remote_session: Boolean(result.reusedRemoteSession),
      output_preview: previewText(result.output),
      usage: result.usage || null,
      cost_usd: result.costUsd ?? null
    }
  })
  report.probes.first_turn = firstTurn

  const secondTurn = await captureProbe(async () => {
    const result = await promptRemoteService({
      config,
      routing,
      input: `${promptPrefix} turn-2`,
      previousResponseId: firstTurn.ok ? firstTurn.response_id || "" : "",
      source: "cc-official-broker:remote-doctor"
    })

    return {
      endpoint: result.endpoint,
      response_id: result.responseId || "",
      previous_response_id: result.previousResponseId || "",
      remote_session_id: result.remoteSessionId || "",
      reused_remote_session: Boolean(result.reusedRemoteSession),
      output_preview: previewText(result.output),
      usage: result.usage || null,
      cost_usd: result.costUsd ?? null
    }
  })
  report.probes.second_turn = secondTurn

  report.probes.session_state = await captureProbe(async () => {
    const payload = await fetchRemoteSessionState({
      config,
      routing
    })
    const session = payload.session || {}
    return {
      remote_session_id: session.remote_session_id || "",
      session_summary_items: session.session_summary_items ?? null,
      last_user_preview: previewText(session.last_user_preview || ""),
      last_answer_preview: previewText(session.last_answer_preview || "")
    }
  })

  report.probes.stats = await captureProbe(async () => {
    const payload = await fetchRemoteStats({
      config,
      window: "24h",
      limit: 3,
      endpoint: config.remoteServiceEndpoint
    })

    return {
      request_count: payload.request_count ?? payload.requests?.length ?? null,
      ok_rate: payload.ok_rate ?? null,
      available_keys: Object.keys(payload).slice(0, 12)
    }
  })

  const remoteSessionId1 = firstTurn.ok ? firstTurn.remote_session_id || "" : ""
  const remoteSessionId2 = secondTurn.ok ? secondTurn.remote_session_id || "" : ""
  const remoteSessionIdFromState = report.probes.session_state.ok
    ? report.probes.session_state.remote_session_id || ""
    : ""

  report.sticky = {
    ok: Boolean(
      firstTurn.ok &&
        secondTurn.ok &&
        report.probes.session_state.ok &&
        remoteSessionId1 &&
        remoteSessionId1 === remoteSessionId2 &&
        remoteSessionId1 === remoteSessionIdFromState
    ),
    same_remote_session_id: Boolean(remoteSessionId1 && remoteSessionId1 === remoteSessionId2),
    second_turn_reused: Boolean(secondTurn.ok && secondTurn.reused_remote_session),
    remote_session_id_1: remoteSessionId1,
    remote_session_id_2: remoteSessionId2,
    session_state_remote_session_id: remoteSessionIdFromState
  }

  if (!report.probes.healthz.ok) {
    report.notes.push("`/healthz` 不通；如果主接口能通，可先不阻塞 broker 接线。")
  }
  if (!report.probes.models.ok) {
    report.notes.push("`/v1/models` 当前不可用；首轮联调可先不阻塞。")
  }
  if (!report.probes.stats.ok) {
    report.notes.push("`/v1/stats` 当前不可用；主链路先以 prompt + session_state 为准。")
  }
  if (firstTurn.ok && secondTurn.ok && !report.sticky.same_remote_session_id) {
    report.notes.push("两次 prompt 没落到同一个 remote_session_id，sticky 还没成立。")
  }
  if (secondTurn.ok && !report.sticky.second_turn_reused) {
    report.notes.push("第二次 prompt 没显式标记 `reused_remote_session=true`；如果 remote_session_id 一致，可先继续。")
  }

  report.ok = Boolean(
    firstTurn.ok && secondTurn.ok && report.probes.session_state.ok && report.sticky.same_remote_session_id
  )

  return report
}
