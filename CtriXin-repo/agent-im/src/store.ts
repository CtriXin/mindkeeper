import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export interface CLISession {
  sessionId: string;
  cwd: string;
  project: string;
  branch: string;
  pid: number;
  threadId?: string;
  hubMessageId?: string;
  filterLevel: 'full' | 'summary' | 'silent';
  registeredAt: string;
  lastActivityAt: string;
  status: 'active' | 'idle' | 'dead';
}

export interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  discordMessageId?: string;
  createdAt: string;
}

export class Store {
  private sessions = new Map<string, CLISession>();
  private permissions = new Map<string, PendingPermission>();
  private sessionsFile: string;
  private permissionsFile: string;

  constructor() {
    ensureDir(DATA_DIR);
    this.sessionsFile = path.join(DATA_DIR, 'sessions.json');
    this.permissionsFile = path.join(DATA_DIR, 'permissions.json');
    this.load();
  }

  private load(): void {
    const sessions = readJson<Record<string, CLISession>>(this.sessionsFile, {});
    for (const [id, s] of Object.entries(sessions)) {
      this.sessions.set(id, s);
    }
    const perms = readJson<Record<string, PendingPermission>>(this.permissionsFile, {});
    for (const [id, p] of Object.entries(perms)) {
      this.permissions.set(id, p);
    }
  }

  private persistSessions(): void {
    atomicWrite(this.sessionsFile, JSON.stringify(
      Object.fromEntries(this.sessions), null, 2,
    ));
  }

  private persistPermissions(): void {
    atomicWrite(this.permissionsFile, JSON.stringify(
      Object.fromEntries(this.permissions), null, 2,
    ));
  }

  // ── Sessions ──

  getSession(sessionId: string): CLISession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByThreadId(threadId: string): CLISession | undefined {
    for (const s of this.sessions.values()) {
      if (s.threadId === threadId) return s;
    }
    return undefined;
  }

  setSession(session: CLISession): void {
    this.sessions.set(session.sessionId, session);
    this.persistSessions();
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.persistSessions();
  }

  listSessions(filter?: { status?: CLISession['status'] }): CLISession[] {
    const all = Array.from(this.sessions.values());
    if (filter?.status) return all.filter(s => s.status === filter.status);
    return all;
  }

  // ── Permissions ──

  getPendingPermission(permissionId: string): PendingPermission | undefined {
    return this.permissions.get(permissionId);
  }

  getPendingBySession(sessionId: string): PendingPermission[] {
    return Array.from(this.permissions.values())
      .filter(p => p.sessionId === sessionId);
  }

  setPendingPermission(perm: PendingPermission): void {
    this.permissions.set(perm.permissionId, perm);
    this.persistPermissions();
  }

  deletePendingPermission(permissionId: string): void {
    this.permissions.delete(permissionId);
    this.persistPermissions();
  }
}
