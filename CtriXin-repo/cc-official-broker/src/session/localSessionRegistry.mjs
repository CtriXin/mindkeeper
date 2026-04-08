import os from "node:os"
import path from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"

function defaultRegistryPath() {
  return path.join(os.homedir(), ".config", "cc-official-broker", "session-registry.json")
}

function normalizeProjectRoot(projectRoot = process.cwd()) {
  return path.resolve(projectRoot || process.cwd())
}

function buildScopeKey({ ownerUserId, deviceId, workspaceId, projectRoot }) {
  return [ownerUserId || "unknown-owner", deviceId || "unknown-device", workspaceId || "default", normalizeProjectRoot(projectRoot)].join("::")
}

function emptyRegistry() {
  return {
    version: 1,
    sessions: {}
  }
}

function normalizeRecordTimestamp(value = "") {
  const text = String(value || "").trim()
  return text || new Date(0).toISOString()
}

function buildOfficialProxyConversationKey(record = {}) {
  if (!record || typeof record !== "object") {
    return ""
  }
  return String(
    record.remote_session_id ||
      record.proxy_session_id ||
      record.session_id ||
      ""
  ).trim()
}

function normalizeOfficialProxySessions(items = []) {
  if (!Array.isArray(items)) {
    return []
  }

  const deduped = new Map()
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue
    }
    const normalized = { ...item }
    const key = buildOfficialProxyConversationKey(normalized)
    if (!key) {
      continue
    }
    normalized.updated_at = normalizeRecordTimestamp(normalized.updated_at)
    deduped.set(key, normalized)
  }

  return [...deduped.values()].sort(
    (left, right) =>
      new Date(normalizeRecordTimestamp(right.updated_at)).getTime() -
      new Date(normalizeRecordTimestamp(left.updated_at)).getTime()
  )
}

function upsertOfficialProxySessionHistory(previousRecord = {}, nextOfficialProxy = null) {
  const priorLatest =
    previousRecord?.official_proxy && typeof previousRecord.official_proxy === "object"
      ? previousRecord.official_proxy
      : null
  const existingItems = normalizeOfficialProxySessions([
    ...(Array.isArray(previousRecord?.official_proxy_sessions)
      ? previousRecord.official_proxy_sessions
      : []),
    ...(priorLatest ? [priorLatest] : [])
  ])

  if (!nextOfficialProxy || typeof nextOfficialProxy !== "object") {
    return {
      latest: priorLatest,
      latestKey:
        String(previousRecord?.official_proxy_latest_key || "").trim() ||
        buildOfficialProxyConversationKey(priorLatest || {}),
      sessions: existingItems
    }
  }

  const normalizedLatest = {
    ...(priorLatest && typeof priorLatest === "object" ? priorLatest : {}),
    ...nextOfficialProxy,
    updated_at: normalizeRecordTimestamp(nextOfficialProxy.updated_at)
  }
  const latestKey = buildOfficialProxyConversationKey(normalizedLatest)
  const merged = new Map(
    existingItems.map(item => [buildOfficialProxyConversationKey(item), item])
  )

  if (latestKey) {
    merged.set(latestKey, normalizedLatest)
  }

  const sessions = normalizeOfficialProxySessions([...merged.values()]).slice(0, 20)
  return {
    latest: normalizedLatest,
    latestKey,
    sessions
  }
}

export function getLocalSessionRegistryPath(config = {}) {
  const configured = String(config.localStatePath || "").trim()
  return configured ? path.resolve(configured) : defaultRegistryPath()
}

async function readRegistry(config) {
  const registryPath = getLocalSessionRegistryPath(config)

  try {
    const raw = await readFile(registryPath, "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || typeof parsed.sessions !== "object") {
      return emptyRegistry()
    }
    return {
      version: 1,
      sessions: parsed.sessions || {}
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyRegistry()
    }
    return emptyRegistry()
  }
}

async function writeRegistry(config, registry) {
  const registryPath = getLocalSessionRegistryPath(config)
  await mkdir(path.dirname(registryPath), { recursive: true })
  const tempPath = `${registryPath}.tmp`
  await writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8")
  await rename(tempPath, registryPath)
}

export async function loadLastSessionRecord(config, { projectRoot = process.cwd() } = {}) {
  const registry = await readRegistry(config)
  const key = buildScopeKey({
    ownerUserId: config.ownerUserId,
    deviceId: config.deviceId,
    workspaceId: config.workspaceId,
    projectRoot
  })
  return registry.sessions[key] || null
}

export async function listOfficialProxySessionRecords(config, { projectRoot = process.cwd() } = {}) {
  const record = await loadLastSessionRecord(config, { projectRoot })
  if (!record || typeof record !== "object") {
    return []
  }

  return normalizeOfficialProxySessions([
    ...(Array.isArray(record.official_proxy_sessions) ? record.official_proxy_sessions : []),
    ...(record.official_proxy && typeof record.official_proxy === "object" ? [record.official_proxy] : [])
  ])
}

function officialProxyRecordMatchesQuery(record = {}, query = "") {
  const normalizedQuery = String(query || "").trim()
  if (!normalizedQuery) {
    return false
  }

  const candidates = [
    record.session_id,
    record.remote_session_id,
    record.proxy_session_id,
    buildOfficialProxyConversationKey(record)
  ]

  return candidates.some(value => String(value || "").trim() === normalizedQuery)
}

export async function findOfficialProxySessionRecord(
  config,
  {
    projectRoot = process.cwd(),
    query = ""
  } = {}
) {
  const normalizedQuery = String(query || "").trim()
  if (!normalizedQuery) {
    return null
  }

  const sessions = await listOfficialProxySessionRecords(config, { projectRoot })
  return sessions.find(item => officialProxyRecordMatchesQuery(item, normalizedQuery)) || null
}

export async function saveLastSessionRecord(
  config,
  {
    projectRoot = process.cwd(),
    sessionId,
    runnerKey,
    brokerBaseUrl = "",
    remoteService = null,
    officialProxy = null
  } = {}
) {
  if (!sessionId && !officialProxy) {
    return null
  }

  const registry = await readRegistry(config)
  const resolvedProjectRoot = normalizeProjectRoot(projectRoot)
  const key = buildScopeKey({
    ownerUserId: config.ownerUserId,
    deviceId: config.deviceId,
    workspaceId: config.workspaceId,
    projectRoot: resolvedProjectRoot
  })

  const previous = registry.sessions[key] || {}
  const officialProxyState = upsertOfficialProxySessionHistory(previous, officialProxy)
  registry.sessions[key] = {
    ...previous,
    owner_user_id: config.ownerUserId,
    device_id: config.deviceId,
    workspace_id: config.workspaceId,
    project_root: resolvedProjectRoot,
    session_id: sessionId || previous.session_id || "",
    runner_key: runnerKey !== undefined ? runnerKey || "" : previous.runner_key || "",
    broker_base_url:
      brokerBaseUrl !== undefined ? brokerBaseUrl || config.brokerBaseUrl || "" : previous.broker_base_url || "",
    remote_service: remoteService !== null ? remoteService : previous.remote_service || null,
    official_proxy: officialProxyState.latest || null,
    official_proxy_latest_key: officialProxyState.latestKey || "",
    official_proxy_sessions: officialProxyState.sessions,
    updated_at: new Date().toISOString()
  }

  await writeRegistry(config, registry)
  return registry.sessions[key]
}
