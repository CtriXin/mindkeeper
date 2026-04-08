import http from "node:http"
import { randomUUID } from "node:crypto"

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", chunk => chunks.push(chunk))
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8")
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

function buildSessionKey({ deviceId = "", workspaceId = "", sessionId = "" }) {
  return `${deviceId}::${workspaceId}::${sessionId}`
}

function buildUsageFromText(text = "") {
  const normalized = String(text || "")
  const inputTokens = Math.max(8, Math.ceil(normalized.length / 4))
  const outputTokens = Math.max(12, Math.ceil((normalized.length + 20) / 5))
  return {
    supported: true,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cache_hit: false
  }
}

function buildAnswerText(input = "", sessionState = null) {
  const text = String(input || "").trim() || "hello"
  const turn = (sessionState?.turn_count || 0) + 1
  return [
    `mock remote turn ${turn}`,
    `you said: ${text}`,
    "this is a fake remote official runtime wired through the broker"
  ].join("\n")
}

export async function startMockRemoteService({ host = "127.0.0.1", port = 0 } = {}) {
  const sessionState = new Map()

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`)

      if (req.method === "GET" && url.pathname === "/healthz") {
        jsonResponse(res, 200, { ok: true, service: "cc-official-broker-mock-remote" })
        return
      }

      if (req.method === "GET" && url.pathname === "/v1/session_state") {
        const deviceId = url.searchParams.get("device_id") || ""
        const workspaceId = url.searchParams.get("workspace_id") || ""
        const sessionId = url.searchParams.get("session_id") || ""
        const key = buildSessionKey({ deviceId, workspaceId, sessionId })
        const existing = sessionState.get(key)

        jsonResponse(res, 200, {
          ok: true,
          session: existing
            ? {
                remote_session_id: existing.remote_session_id,
                session_summary_items: existing.turn_count,
                last_user_preview: existing.last_input,
                last_answer_preview: existing.last_output
              }
            : {
                remote_session_id: null,
                session_summary_items: 0
              }
        })
        return
      }

      if (
        req.method === "POST" &&
        (url.pathname === "/v1/responses" || url.pathname === "/v1/chat/completions")
      ) {
        const body = await readJsonBody(req).catch(() => null)
        if (!body) {
          jsonResponse(res, 400, { ok: false, error: "invalid json body" })
          return
        }

        const metadata = body.metadata || {}
        const input =
          url.pathname === "/v1/chat/completions"
            ? body.messages?.map(message => message?.content || "").join("\n")
            : body.input

        const key = buildSessionKey({
          deviceId: metadata.device_id,
          workspaceId: metadata.workspace_id,
          sessionId: metadata.session_id
        })
        const previous = sessionState.get(key) || null
        const remoteSessionId = previous?.remote_session_id || `mock-remote-${randomUUID().slice(0, 8)}`
        const answer = buildAnswerText(input, previous)
        const usage = buildUsageFromText(String(input || ""))
        const next = {
          remote_session_id: remoteSessionId,
          turn_count: (previous?.turn_count || 0) + 1,
          last_input: String(input || "").slice(0, 120),
          last_output: answer.slice(0, 120)
        }
        sessionState.set(key, next)

        if (url.pathname === "/v1/chat/completions") {
          jsonResponse(res, 200, {
            id: `chatcmpl-${randomUUID().slice(0, 8)}`,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: answer
                },
                finish_reason: "stop"
              }
            ],
            cc_meta: {
              meta: {
                remote_session_id: remoteSessionId,
                reused_remote_session: Boolean(previous)
              },
              usage,
              cost_usd: Number((usage.total_tokens * 0.00001).toFixed(6))
            }
          })
          return
        }

        jsonResponse(res, 200, {
          id: `resp-${randomUUID().slice(0, 8)}`,
          object: "response",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: answer
                }
              ]
            }
          ],
          cc_meta: {
            meta: {
              remote_session_id: remoteSessionId,
              reused_remote_session: Boolean(previous)
            },
            usage,
            cost_usd: Number((usage.total_tokens * 0.00001).toFixed(6))
          }
        })
        return
      }

      jsonResponse(res, 404, { ok: false, error: "not found" })
    } catch (error) {
      jsonResponse(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  await new Promise(resolve => server.listen(port, host, resolve))

  return {
    baseUrl: `http://${host}:${server.address().port}`,
    close: async () =>
      new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}
