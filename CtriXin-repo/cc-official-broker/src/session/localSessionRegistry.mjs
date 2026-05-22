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

export async function saveLastSessionRecord(
  config,
  { projectRoot = process.cwd(), sessionId, runnerKey, brokerBaseUrl = "", remoteService = null } = {}
) {
  if (!sessionId) {
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

  registry.sessions[key] = {
    owner_user_id: config.ownerUserId,
    device_id: config.deviceId,
    workspace_id: config.workspaceId,
    project_root: resolvedProjectRoot,
    session_id: sessionId,
    runner_key: runnerKey || "",
    broker_base_url: brokerBaseUrl || config.brokerBaseUrl || "",
    remote_service: remoteService || null,
    updated_at: new Date().toISOString()
  }

  await writeRegistry(config, registry)
  return registry.sessions[key]
}
