import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Store, CLISession } from './store.js';
import type { FilterLevel } from './config.js';
import type { RegisterMsg, UnregisterMsg, EventMsg } from './ipc-server.js';

export interface SessionRegistryEvents {
  'session:registered': [CLISession];
  'session:unregistered': [CLISession];
  'session:event': [CLISession, EventMsg];
  'session:dead': [CLISession];
}

export class SessionRegistry extends EventEmitter<SessionRegistryEvents> {
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private store: Store,
    private defaultFilter: FilterLevel,
    private heartbeatIntervalMs: number,
  ) {
    super();
  }

  start(): void {
    // Periodic cleanup of dead sessions
    this.cleanupTimer = setInterval(
      () => this.cleanupDeadSessions(),
      this.heartbeatIntervalMs,
    );
    // On daemon restart, mark truly stale sessions from previous run as dead
    // (only if inactive > 5 min AND PID dead — avoids killing sessions during daemon restart)
    const now = Date.now();
    for (const session of this.store.listSessions({ status: 'active' })) {
      const lastActivity = new Date(session.lastActivityAt).getTime();
      const stale = (now - lastActivity) > 15 * 60 * 1000;
      if (stale && !this.isProcessAlive(session.pid)) {
        session.status = 'dead';
        this.store.setSession(session);
        this.emit('session:dead', session);
      }
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  handleRegister(msg: RegisterMsg): CLISession {
    const existing = this.store.getSession(msg.sessionId);
    if (existing && existing.status === 'active') {
      // Re-register (e.g., hook fired again) — update activity
      existing.lastActivityAt = new Date().toISOString();
      existing.pid = msg.pid;
      this.store.setSession(existing);
      return existing;
    }

    const session: CLISession = {
      sessionId: msg.sessionId,
      cwd: msg.cwd,
      project: msg.project || this.extractProjectName(msg.cwd),
      branch: msg.branch || this.detectBranch(msg.cwd),
      pid: msg.pid,
      filterLevel: this.defaultFilter,
      registeredAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: 'active',
    };

    this.store.setSession(session);
    this.emit('session:registered', session);
    console.log(`[registry] Session registered: ${session.project}/${session.branch} [${session.sessionId.slice(0, 8)}]`);
    return session;
  }

  handleUnregister(msg: UnregisterMsg): void {
    const session = this.store.getSession(msg.sessionId);
    if (!session) return;
    session.status = 'dead';
    session.lastActivityAt = new Date().toISOString();
    this.store.setSession(session);
    this.emit('session:unregistered', session);
    console.log(`[registry] Session unregistered: ${session.project}/${session.branch} [${session.sessionId.slice(0, 8)}]`);
  }

  handleEvent(msg: EventMsg): void {
    const session = this.store.getSession(msg.sessionId);
    if (!session) {
      console.warn(`[registry] Event for unknown session: ${msg.sessionId.slice(0, 8)}`);
      return;
    }
    session.lastActivityAt = new Date().toISOString();
    session.status = 'active';
    this.store.setSession(session);
    this.emit('session:event', session, msg);
  }

  getSession(sessionId: string): CLISession | undefined {
    return this.store.getSession(sessionId);
  }

  getByThreadId(threadId: string): CLISession | undefined {
    return this.store.getSessionByThreadId(threadId);
  }

  listActive(): CLISession[] {
    return this.store.listSessions({ status: 'active' });
  }

  listAll(): CLISession[] {
    return this.store.listSessions();
  }

  bindThread(sessionId: string, threadId: string, hubMessageId?: string): void {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    session.threadId = threadId;
    if (hubMessageId) session.hubMessageId = hubMessageId;
    this.store.setSession(session);
  }

  setFilterLevel(sessionId: string, level: FilterLevel): void {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    session.filterLevel = level;
    this.store.setSession(session);
  }

  private cleanupDeadSessions(): void {
    const now = Date.now();
    // Only mark as dead if BOTH: PID is gone AND no activity for 2 minutes
    // This prevents false positives when PPID detection is unreliable
    const INACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;

    for (const session of this.store.listSessions({ status: 'active' })) {
      const lastActivity = new Date(session.lastActivityAt).getTime();
      const inactive = (now - lastActivity) > INACTIVITY_THRESHOLD_MS;
      const pidDead = !this.isProcessAlive(session.pid);

      if (pidDead && inactive) {
        session.status = 'dead';
        this.store.setSession(session);
        this.emit('session:dead', session);
        console.log(`[registry] Dead session detected: ${session.project} [${session.sessionId.slice(0, 8)}] (PID ${session.pid}, inactive ${Math.round((now - lastActivity) / 1000)}s)`);
      }
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private extractProjectName(cwd: string): string {
    return cwd.split('/').pop() || 'unknown';
  }

  private detectBranch(cwd: string): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return 'none';
    }
  }
}
