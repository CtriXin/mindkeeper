import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

/** Codex thread from state_5.sqlite */
interface CodexThread {
  id: string;
  cwd: string;
  gitBranch: string;
  rolloutPath: string;
  title: string;
  updatedAt: number;
}

export interface CodexWatcherEvents {
  /** New Codex thread detected — register as session */
  'session:new': [thread: CodexThread];
  /** Codex thread archived/gone — unregister */
  'session:ended': [threadId: string];
  /** Assistant text output */
  'assistant:text': [threadId: string, text: string];
  /** Tool call (exec_command, apply_patch, etc.) */
  'tool:call': [threadId: string, name: string, args: string];
  /** User message */
  'user:message': [threadId: string, text: string];
}

/**
 * Auto-discovers Codex CLI sessions by polling ~/.codex/state_5.sqlite,
 * then tails each session's rollout JSONL for events.
 *
 * No wrapper script needed — just run `codex` normally.
 */
export class CodexWatcher extends EventEmitter<CodexWatcherEvents> {
  private threads = new Map<string, {
    rolloutPath: string;
    offset: number;
  }>();

  private detectTimer: NodeJS.Timeout | null = null;
  private rolloutTimer: NodeJS.Timeout | null = null;
  private startTime: number; // unix seconds — only detect threads updated after daemon start

  private static readonly STATE_DB = path.join(os.homedir(), '.codex', 'state_5.sqlite');
  private static readonly DETECT_MS = 5000; // poll SQLite every 5s
  private static readonly ROLLOUT_MS = 2000; // poll rollout files every 2s

  constructor() {
    super();
    this.startTime = Math.floor(Date.now() / 1000);
  }

  /** Start auto-detecting Codex sessions */
  start(): void {
    if (!fs.existsSync(CodexWatcher.STATE_DB)) {
      console.log('[codex-watcher] Codex not installed (no state DB), skipping');
      return;
    }
    this.detectTimer = setInterval(() => this.detectThreads(), CodexWatcher.DETECT_MS);
    this.rolloutTimer = setInterval(() => this.pollAllRollouts(), CodexWatcher.ROLLOUT_MS);
    console.log('[codex-watcher] Auto-detection started');
  }

  stop(): void {
    if (this.detectTimer) clearInterval(this.detectTimer);
    if (this.rolloutTimer) clearInterval(this.rolloutTimer);
    this.threads.clear();
  }

  // ── Thread detection from SQLite ──

  private detectThreads(): void {
    const active = this.queryActiveThreads();
    const activeIds = new Set<string>();

    for (const t of active) {
      activeIds.add(t.id);
      if (!this.threads.has(t.id)) {
        // New thread discovered
        let offset = 0;
        try { offset = fs.statSync(t.rolloutPath).size; } catch { /* ok */ }
        this.threads.set(t.id, { rolloutPath: t.rolloutPath, offset });
        this.emit('session:new', t);
        console.log(`[codex-watcher] New thread: ${path.basename(t.cwd)} / ${t.gitBranch} [${t.id.slice(0, 8)}]`);
      }
    }

    // Detect archived/removed threads
    for (const [id] of this.threads) {
      if (!activeIds.has(id)) {
        this.threads.delete(id);
        this.emit('session:ended', id);
        console.log(`[codex-watcher] Thread ended: ${id.slice(0, 8)}`);
      }
    }
  }

  private queryActiveThreads(): CodexThread[] {
    try {
      // Tab-separated output for reliable parsing
      const raw = execSync(
        `sqlite3 -separator '\t' "${CodexWatcher.STATE_DB}" ` +
        `"SELECT id, cwd, COALESCE(git_branch,'none'), rollout_path, COALESCE(title,''), updated_at ` +
        `FROM threads WHERE archived = 0 AND updated_at > ${this.startTime} ` +
        `ORDER BY updated_at DESC LIMIT 20"`,
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      if (!raw) return [];

      return raw.split('\n').map(line => {
        const [id, cwd, gitBranch, rolloutPath, title, updatedAt] = line.split('\t');
        return { id, cwd, gitBranch, rolloutPath, title, updatedAt: parseInt(updatedAt, 10) };
      }).filter(t => t.id && t.rolloutPath);
    } catch {
      return [];
    }
  }

  // ── Rollout JSONL polling ──

  private pollAllRollouts(): void {
    for (const [threadId, state] of this.threads) {
      this.pollRollout(threadId, state);
    }
  }

  private pollRollout(threadId: string, state: { rolloutPath: string; offset: number }): void {
    let size: number;
    try { size = fs.statSync(state.rolloutPath).size; } catch { return; }
    if (size <= state.offset) return;

    try {
      const fd = fs.openSync(state.rolloutPath, 'r');
      const buf = Buffer.alloc(size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      fs.closeSync(fd);
      state.offset = size;

      for (const line of buf.toString('utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.processEntry(threadId, JSON.parse(trimmed));
        } catch { /* partial or invalid JSON */ }
      }
    } catch { /* read error */ }
  }

  private processEntry(threadId: string, entry: unknown): void {
    if (!entry || typeof entry !== 'object') return;
    const e = entry as Record<string, unknown>;
    const payload = e.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    // Assistant text output
    if (e.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const content = payload.content;
      if (!Array.isArray(content)) return;
      const texts: string[] = [];
      for (const block of content) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (b.type === 'output_text' && typeof b.text === 'string' && b.text.trim()) {
            texts.push(b.text);
          }
        }
      }
      const fullText = texts.join('\n').trim();
      if (fullText) this.emit('assistant:text', threadId, fullText);
    }

    // Tool calls
    if (e.type === 'response_item' && payload.type === 'function_call') {
      const name = String(payload.name || 'unknown');
      const args = String(payload.arguments || '');
      this.emit('tool:call', threadId, name, args);
    }

    // User messages
    if (e.type === 'event_msg' && payload.type === 'user_message') {
      const text = String(payload.message || payload.text || '');
      if (text.trim()) this.emit('user:message', threadId, text);
    }
  }
}
