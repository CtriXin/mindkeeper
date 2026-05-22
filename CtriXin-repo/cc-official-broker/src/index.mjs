import {
  getConfiguredAuthModes,
  getMissingRequiredConfig,
  getPreferredAuthMode,
  getSafeConfigView,
  loadConfig
} from "./config.mjs"
import {
  buildDeviceAuthPayload,
  buildDeviceAuthRequestSample,
  buildDeviceAuthResponseSample
} from "./contracts/authDevice.mjs"
import { startBrokerStub } from "./broker/stubServer.mjs"
import { runLocalBrokerDemo } from "./demo/localBrokerDemo.mjs"
import { runMmsLiveDemo } from "./demo/runMmsLiveDemo.mjs"
import { runMmsMockDemo } from "./demo/runMmsMockDemo.mjs"
import {
  buildRunnerHeartbeatMessage,
  buildRunnerRegisterMessage,
  buildRunnerRegisteredAckSample
} from "./contracts/runnerProtocol.mjs"
import { runRunnerService } from "./runner/serveRunner.mjs"
import {
  buildCreateSessionRequest,
  buildMmsFlowSummary,
  buildResumeSessionRequest
} from "./mms/entryRequests.mjs"
import { buildDemoFlow } from "./mms/demoFlow.mjs"
import { buildBrokerProfileSample } from "./mms/brokerProfile.mjs"
import { runSessionShell } from "./mms/runSessionShell.mjs"
import { buildProfileInstallGuide, installBrokerProfile } from "./mms/installBrokerProfile.mjs"
import { resolveLiveBrokerProfile } from "./mms/liveBrokerProfile.mjs"
import { buildOfficialDoctorReport } from "./official/claudeBinary.mjs"
import { runOfficialAttach } from "./official/attachOfficialSession.mjs"
import { runOfficialConnect } from "./official/directConnect.mjs"
import { runOfficialBrokerDemo } from "./official/runOfficialBrokerDemo.mjs"
import { runOfficialMockDemo } from "./official/mockSdkHost.mjs"
import { runRemoteDoctor } from "./remote/doctorRemoteService.mjs"
import { buildDeviceContext } from "./runner/deviceContext.mjs"
import { inspectSession } from "./session/inspectSession.mjs"
import { getLocalSessionRegistryPath, loadLastSessionRecord } from "./session/localSessionRegistry.mjs"
import { runSessionPrompt } from "./session/promptSession.mjs"
import { buildRoutingFields, buildSessionKey, toWireRouting } from "./shared/sessionKeys.mjs"

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
}

function enableWorkerV1(baseConfig) {
  const mergedTools = Array.from(
    new Set([
      ...(Array.isArray(baseConfig.runnerTools) ? baseConfig.runnerTools : []),
      "bash",
      "write_file",
      "apply_patch"
    ])
  )

  return {
    ...baseConfig,
    runnerTools: mergedTools,
    runnerWritableScope:
      String(baseConfig.runnerWritableScope || "none").trim() === "none"
        ? "workspace"
        : baseConfig.runnerWritableScope
  }
}

function buildWorkerProfileOverrides(baseConfig, overrides = {}) {
  const workerConfig = enableWorkerV1(baseConfig)
  const defaultWorkerBrokerBaseUrl = (() => {
    try {
      const parsed = new URL(workerConfig.brokerBaseUrl || "http://127.0.0.1:8787")
      if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
        parsed.port = "8789"
      }
      return parsed.toString().replace(/\/+$/, "")
    } catch {
      return "http://127.0.0.1:8789"
    }
  })()

  return {
    ...overrides,
    profileId: overrides.profileId || `official-broker-worker-${workerConfig.workspaceId}`,
    profileName:
      overrides.profileName ||
      `Official Broker Worker ${
        workerConfig.workspaceId.charAt(0).toUpperCase() + workerConfig.workspaceId.slice(1)
      }`,
    brokerBaseUrl: overrides.brokerBaseUrl || defaultWorkerBrokerBaseUrl,
    entryMode: overrides.entryMode || "shell",
    fallbackEntryMode: overrides.fallbackEntryMode || "",
    runnerTools: workerConfig.runnerTools,
    runnerWritableScope: workerConfig.runnerWritableScope
  }
}

async function resolveOfficialConnectConfig(baseConfig) {
  const profileId = process.env.CC_BROKER_PROFILE_ID || "official-broker-personal"
  const needsLiveProfile = Boolean(process.env.CC_BROKER_PROFILE_ID) ||
    !baseConfig.brokerBaseUrl ||
    !baseConfig.deviceKey ||
    !baseConfig.remoteServiceBaseUrl

  if (!needsLiveProfile) {
    return baseConfig
  }

  try {
    const resolved = await resolveLiveBrokerProfile(baseConfig, { profileId })
    return resolved.config
  } catch {
    return baseConfig
  }
}

function buildAuthSummary(config) {
  const preferredMode = getPreferredAuthMode(config)
  const sampleHeaders = {}

  if (config.bearerToken) {
    sampleHeaders.Authorization = "Bearer <redacted>"
  } else if (config.compatApiKey) {
    sampleHeaders["x-api-key"] = "<redacted>"
  }

  return {
    configuredModes: getConfiguredAuthModes(config),
    preferredMode,
    sampleHeaders,
    bootstrap: config.deviceKey ? "device-key available for POST /auth/device bootstrap" : "device-key not configured",
    notes: [
      "Bearer is the preferred steady-state auth mode",
      "x-api-key is compatibility-only when Bearer is unavailable",
      "request logs must not store prompt body, file content, or secrets"
    ]
  }
}

function buildRequestLogShape(config, routing) {
  return {
    logged_at: "iso8601",
    request_id: "uuid",
    mode: "remote",
    source: config.requestSource,
    target_model: config.remoteModel,
    duration_ms: 12,
    ok: true,
    status: 200,
    error: null,
    routing
  }
}

function buildCoordinationNotes(config) {
  const notes = [
    "Keep routing keys aligned with owner_user_id/device_id/workspace_id/session_id/runner_key/session_key",
    "Reuse the shared auth/logging/redaction baseline instead of rebuilding another service-side variant",
    "Treat server-side official cc baseline as shared infrastructure, not this project's private fork",
    "Broker owns session truth; cc-mcp-bridge is the remote official runtime service plane"
  ]

  if (config.workspaceId === "personal") {
    notes.push(
      "Current local default workspace_id is personal; when coordinating with company-side services, set CC_BROKER_WORKSPACE_ID explicitly"
    )
  }

  return notes
}

const config = loadConfig()
const [cmd = "help", ...rest] = process.argv.slice(2)

if (cmd === "help") {
  printJson({
    commands: {
      "auth:device": "print MMS bootstrap request/response sample for POST /auth/device",
      "broker:profile": "print a proposed MMS broker profile snippet",
      "broker:serve": "run a persistent local broker stub for manual curl/websocket testing",
      "broker:live": "start the local broker stub from a real MMS broker_profile plus credentials.sh",
      "demo:flow": "print an end-to-end MMS -> Broker -> Runner demo flow",
      "demo:local": "run a local broker stub and print a concise end-to-end result",
      "demo:mms:mock": "launch a temporary MMS config plus mock remote service so you can try the broker flow end-to-end",
      "demo:mms:live": "launch a temporary MMS config wired to the configured live remote service",
      "demo:mms:worker": "launch a temporary MMS mock demo with worker v1 write tools enabled for the current workspace",
      "demo:mms:worker-live": "launch a temporary MMS live demo with worker v1 write tools enabled for the current workspace",
      "demo:tool": "run a local broker demo that routes a read-only tool call through the runner",
      help: "show help",
      config: "print resolved config with secrets redacted",
      doctor: "print missing env plus auth/logging/routing contract",
      "mms:profile:print": "print a ready-to-install persistent MMS broker profile for the current live setup",
      "mms:profile:install": "write/update a persistent MMS broker profile into a target config.toml",
      "mms:profile:print-worker": "print a worker-enabled MMS broker profile with local write tools turned on",
      "mms:profile:install-worker": "write/update a worker-enabled MMS broker profile into a target config.toml",
      "mms:run": "run an interactive broker session shell intended to be launched from MMS",
      "official:doctor": "inspect the local official claude binary and print the reusable headless launch contract",
      "official:broker": "run a local broker stub, create a session, and connect the real local official claude child to the broker session-ingress path",
      "official:attach": "attach the real local official claude child to the currently configured broker via device auth + session create",
      "official:connect": "launch the real local official claude TUI against the configured broker direct-connect endpoint",
      "official:mock": "launch the local official claude binary against a local mock sdk host and print the transcript",
      "remote:doctor": "probe the configured remote service with base_url + API key and verify sticky behavior",
      "device:context": "print device context from args: device workspace session",
      "runner:heartbeat": "print sample WS runner.heartbeat message",
      "runner:register": "print sample WS runner.register message",
      "runner:serve": "connect to a broker and keep a local runner alive for tool callbacks",
      routing: "print broker-facing routing payload from args: device workspace session",
      "session:create": "print sample MMS POST /sessions create request",
      "session:inspect": "auth to a broker and fetch the current session state snapshot",
      "session:last": "print the last locally remembered session for the current device/workspace/project scope",
      "session:prompt": "auth to a broker, create/resume a session, send one prompt, and print the output",
      "session:resume": "print sample MMS POST /sessions resume request",
      session: "build example runner/session keys from args: device workspace session"
    },
    config: getSafeConfigView(config)
  })
  process.exit(0)
}

if (cmd === "config") {
  printJson(getSafeConfigView(config))
  process.exit(0)
}

if (cmd === "doctor") {
  const missing = getMissingRequiredConfig(config)
  const sampleSessionId = "demo-session"
  const deviceContext = buildDeviceContext({
    ownerUserId: config.ownerUserId,
    deviceId: config.deviceId,
    workspaceId: config.workspaceId,
    sessionId: sampleSessionId
  })
  const routing = toWireRouting(deviceContext)

  printJson({
    ok: missing.length === 0,
    missing,
    config: getSafeConfigView(config),
    auth: buildAuthSummary(config),
    logging: {
      enabled: config.requestLogEnabled,
      path: config.requestLogPath,
      redacts: [
        "question",
        "context_summary",
        "goal",
        "files[].content",
        "response_body",
        "bearer_token",
        "x-api-key",
        "device_key"
      ]
    },
    mms: buildMmsFlowSummary(config),
    remoteService: {
      enabled: Boolean(config.remoteServiceBaseUrl),
      base_url: config.remoteServiceBaseUrl || "<not-configured>",
      endpoint: config.remoteServiceEndpoint,
      model: config.remoteServiceModel,
      timeout_ms: config.remoteServiceTimeoutMs,
      auth_mode: config.remoteServiceBearerToken
        ? "bearer"
        : config.remoteServiceApiKey
          ? "x-api-key"
          : "missing"
    },
    coordination: {
      notes: buildCoordinationNotes(config)
    },
    sample: {
      authBootstrap: buildDeviceAuthRequestSample(config),
      createSession: buildCreateSessionRequest(config),
      deviceContext,
      runnerRegister: buildRunnerRegisterMessage(config),
      routing,
      requestLogShape: buildRequestLogShape(config, routing),
      sessionKey: buildSessionKey(deviceContext)
    }
  })
  process.exit(missing.length === 0 ? 0 : 2)
}

if (cmd === "official:doctor") {
  const [sessionId = "session_local_demo", sdkUrl = "", mode = "v1", workerEpoch = "1"] = rest
  const officialConfig = await resolveOfficialConnectConfig(config)
  const report = buildOfficialDoctorReport(officialConfig, {
    sessionId,
    sdkUrl,
    mode,
    workerEpoch: Number(workerEpoch) || 1
  })
  printJson(report)
  process.exit(report.ok ? 0 : 1)
}

if (cmd === "official:mock") {
  try {
    const prompt = rest.length ? rest.join(" ") : undefined
    printJson(
      await runOfficialMockDemo(config, {
        prompt
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "official:broker") {
  try {
    const prompt = rest.length ? rest.join(" ") : undefined
    printJson(
      await runOfficialBrokerDemo(config, {
        prompt
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "official:attach") {
  try {
    const prompt = rest.length ? rest.join(" ") : undefined
    printJson(
      await runOfficialAttach(config, {
        prompt
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "official:connect") {
  try {
    const printFlagIndex = rest.indexOf("--print")
    const printPrompt =
      printFlagIndex >= 0 ? rest.slice(printFlagIndex + 1).join(" ").trim() : ""
    const officialConfig = await resolveOfficialConnectConfig(config)
    const result = await runOfficialConnect(officialConfig, { printPrompt })
    process.exit(result.code)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "remote:doctor") {
  const [sessionId = "", ...promptPrefixParts] = rest
  try {
    const result = await runRemoteDoctor(config, {
      sessionId,
      promptPrefix: promptPrefixParts.length ? promptPrefixParts.join(" ") : undefined
    })
    printJson(result)
    process.exit(result.ok ? 0 : 1)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "auth:device") {
  printJson({
    request: buildDeviceAuthRequestSample(config),
    response: buildDeviceAuthResponseSample(config)
  })
  process.exit(0)
}

if (cmd === "device:context") {
  const [deviceId = config.deviceId, workspaceId = config.workspaceId, sessionId = "demo"] = rest
  printJson(buildDeviceContext({ ownerUserId: config.ownerUserId, deviceId, workspaceId, sessionId }))
  process.exit(0)
}

if (cmd === "broker:profile") {
  printJson(buildBrokerProfileSample(config))
  process.exit(0)
}

if (cmd === "mms:profile:print") {
  const [profileId = "", brokerBaseUrl = "", configPath = ""] = rest
  printJson(
    buildProfileInstallGuide(config, {
      profileId: profileId || undefined,
      brokerBaseUrl: brokerBaseUrl || undefined,
      configPath: configPath || undefined
    })
  )
  process.exit(0)
}

if (cmd === "mms:profile:print-worker") {
  const [profileId = "", brokerBaseUrl = "", configPath = ""] = rest
  printJson(
    buildProfileInstallGuide(
      enableWorkerV1(config),
      buildWorkerProfileOverrides(config, {
        profileId: profileId || undefined,
        brokerBaseUrl: brokerBaseUrl || undefined,
        configPath: configPath || undefined
      })
    )
  )
  process.exit(0)
}

if (cmd === "mms:profile:install") {
  const [profileId = "", brokerBaseUrl = "", configPath = ""] = rest
  try {
    printJson(
      await installBrokerProfile(config, {
        profileId: profileId || undefined,
        brokerBaseUrl: brokerBaseUrl || undefined,
        configPath: configPath || undefined
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "mms:profile:install-worker") {
  const [profileId = "", brokerBaseUrl = "", configPath = ""] = rest
  try {
    printJson(
      await installBrokerProfile(
        enableWorkerV1(config),
        buildWorkerProfileOverrides(config, {
          profileId: profileId || undefined,
          brokerBaseUrl: brokerBaseUrl || undefined,
          configPath: configPath || undefined
        })
      )
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "demo:flow") {
  const [sessionId = "demo-session", mode = "create"] = rest
  printJson(buildDemoFlow(config, { sessionId, mode }))
  process.exit(0)
}

if (cmd === "demo:local") {
  const [sessionId = "demo-session", mode = "create", ...promptParts] = rest
  try {
    printJson(
      await runLocalBrokerDemo(config, {
        sessionId,
        mode,
        prompt: promptParts.length ? promptParts.join(" ") : undefined
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "demo:tool") {
  const [sessionId = "demo-session", toolName = "pwd", ...toolArgParts] = rest
  const prompt = `/tool ${[toolName, ...toolArgParts].join(" ").trim()}`
  try {
    printJson(await runLocalBrokerDemo(config, { sessionId, mode: "create", prompt }))
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "demo:mms:mock") {
  const [mode = "create"] = rest
  try {
    printJson(
      await runMmsMockDemo(config, {
        resumeLast: mode === "resume-last"
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "demo:mms:worker") {
  const [mode = "create"] = rest
  try {
    printJson(
      await runMmsMockDemo(enableWorkerV1(config), {
        resumeLast: mode === "resume-last"
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "demo:mms:live") {
  const [mode = "create"] = rest
  try {
    printJson(
      await runMmsLiveDemo(config, {
        resumeLast: mode === "resume-last"
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "demo:mms:worker-live") {
  const [mode = "create"] = rest
  try {
    printJson(
      await runMmsLiveDemo(enableWorkerV1(config), {
        resumeLast: mode === "resume-last"
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "broker:serve") {
  const [host = "127.0.0.1", portArg = "8787"] = rest
  const port = Number.parseInt(portArg, 10)
  if (!Number.isInteger(port) || port < 0) {
    printJson({ ok: false, error: `invalid port: ${portArg}` })
    process.exit(1)
  }

  const stub = await startBrokerStub({ config, host, port })
  printJson({
    ok: true,
    answer: "broker stub is running",
    broker: {
      base_url: stub.baseUrl,
      ws_url: `${stub.wsBaseUrl}/runner/connect`
    },
    healthz: `${stub.baseUrl}/healthz`,
    note: "Press Ctrl+C to stop the local stub server."
  })

  await new Promise(resolve => {
    let closed = false
    const shutdown = async signal => {
      if (closed) return
      closed = true
      try {
        await stub.close()
      } finally {
        resolve(signal)
      }
    }

    process.on("SIGINT", () => {
      void shutdown("SIGINT")
    })
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM")
    })
  })
  process.exit(0)
}

if (cmd === "broker:live") {
  const [profileId = "official-broker-personal", configPath = "", credentialsPath = ""] = rest

  try {
    const resolved = await resolveLiveBrokerProfile(config, {
      profileId,
      configPath: configPath || undefined,
      credentialsPath: credentialsPath || undefined
    })
    const brokerUrl = new URL(resolved.config.brokerBaseUrl)
    const port = Number.parseInt(
      brokerUrl.port || (brokerUrl.protocol === "https:" ? "443" : "80"),
      10
    )

    const stub = await startBrokerStub({
      config: resolved.config,
      host: brokerUrl.hostname,
      port
    })
    printJson({
      ok: true,
      answer: "live broker is running",
      profile_id: resolved.profileId,
      profile_name: resolved.profile.name || resolved.profileId,
      config_path: resolved.configPath,
      credentials_path: resolved.credentialsPath,
      broker: {
        base_url: stub.baseUrl,
        ws_url: `${stub.wsBaseUrl}/runner/connect`
      },
      remote_service: {
        label: resolved.config.remoteServiceLabel || resolved.config.remoteServiceBaseUrl,
        base_url: resolved.config.remoteServiceBaseUrl,
        endpoint: resolved.config.remoteServiceEndpoint,
        model: resolved.config.remoteServiceModel
      },
      next: `在另一个终端运行: mms broker run ${resolved.profileId}`
    })

    await new Promise(resolve => {
      let closed = false
      const shutdown = async signal => {
        if (closed) return
        closed = true
        try {
          await stub.close()
        } finally {
          resolve(signal)
        }
      }

      process.on("SIGINT", () => {
        void shutdown("SIGINT")
      })
      process.on("SIGTERM", () => {
        void shutdown("SIGTERM")
      })
    })
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "runner:register") {
  const [activeSessionId = "demo-session"] = rest
  printJson({
    request: buildRunnerRegisterMessage(config, { activeSessionId }),
    response: buildRunnerRegisteredAckSample(config)
  })
  process.exit(0)
}

if (cmd === "runner:heartbeat") {
  const [activeSessionId = "demo-session"] = rest
  printJson(buildRunnerHeartbeatMessage(config, { activeSessionIds: [activeSessionId] }))
  process.exit(0)
}

if (cmd === "runner:serve") {
  const [activeSessionId = "", workspaceRoot = config.workspaceRoot] = rest
  try {
    const result = await runRunnerService(config, {
      activeSessionId: activeSessionId || null,
      workspaceRoot
    })
    printJson(result)
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "routing") {
  const [deviceId = config.deviceId, workspaceId = config.workspaceId, sessionId = "demo"] = rest
  const routing = buildRoutingFields({
    ownerUserId: config.ownerUserId,
    deviceId,
    workspaceId,
    sessionId
  })
  printJson(toWireRouting(routing))
  process.exit(0)
}

if (cmd === "session:create") {
  const [clientSessionId = "draft-session"] = rest
  printJson(buildCreateSessionRequest(config, { clientSessionId }))
  process.exit(0)
}

if (cmd === "session:inspect") {
  const [sessionId = "demo-session"] = rest
  try {
    printJson(await inspectSession(config, { sessionId }))
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "session:last") {
  try {
    printJson({
      ok: true,
      answer: "loaded local remembered session",
      state_path: getLocalSessionRegistryPath(config),
      session: await loadLastSessionRecord(config, {
        projectRoot: config.workspaceRoot
      })
    })
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "session:prompt") {
  const [sessionId = "demo-session", mode = "create", ...promptParts] = rest
  try {
    printJson(
      await runSessionPrompt(config, {
        sessionId,
        mode,
        prompt: promptParts.length ? promptParts.join(" ") : "ping broker session"
      })
    )
    process.exit(0)
  } catch (error) {
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }
}

if (cmd === "mms:run") {
  const modes = new Set(["create", "resume", "resume-last"])
  const first = rest[0] || ""
  const sessionId = modes.has(first) ? "" : first
  const mode = modes.has(first) ? first : rest[1] || "create"
  try {
    await runSessionShell(config, {
      sessionId: sessionId || undefined,
      mode
    })
    process.exit(0)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

if (cmd === "session:resume") {
  const [sessionId = "existing-session-id"] = rest
  printJson(buildResumeSessionRequest(config, { sessionId }))
  process.exit(0)
}

if (cmd === "session") {
  const [deviceId = config.deviceId, workspaceId = config.workspaceId, sessionId = "demo"] = rest
  const routing = buildRoutingFields({
    ownerUserId: config.ownerUserId,
    deviceId,
    workspaceId,
    sessionId
  })
  printJson({
    runnerKey: routing.runnerKey,
    sessionKey: routing.sessionKey
  })
  process.exit(0)
}

printJson({ error: `unknown command: ${cmd}` })
process.exit(1)
