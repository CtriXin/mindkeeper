import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface CodexWatcherEvents {
  'assistant:text': [sessionId: string, text: string];
  'tool:call': [sessionId: string, name: string, args: string];
  'user:message': [sessionId: string, text: string];
}

/**
 * Watches Codex CLI rollout JSONL files for assistant text, tool calls, and user messages.
 *
 * Codex stores conversations at paths like:
 *   ~/.codex/sessions/2026/03/12/rollout-{date}T{time}-{thread-id}.jsonl
 *
 * The rollout_path is stored in ~/.codex/state_5.sqlite → threads table.
 * We look up the rollout path by matching cwd + git branch from the wrapper script.
 */
export class CodexWatcher extends EventEmitter<CodexWatcherEvents> {
  private sessions = new Map<string, {
    rolloutPath: string;
    offset: number;
    timer: ReturnType<typeof setInterval>;
  }>();

  private static readonly STATE_DB = path.join(os.homedir(), '.codex', 'state_5.sqlite');
  private static readonly POLL_MS = 2000;

  /**
   * Start watching a Codex session.
   * Finds the latest active Codex thread matching the given cwd, then tails the rollout JSONL.
   */
  startWatching(sessionId: string, cwd: string): void {
    if (this.sessions.has(sessionId)) return;

    const rolloutPath = this.findRolloutPath(cwd);
    if (!rolloutPath) {
      console.log(`[codex-watcher] No active Codex thread found for ${cwd}`);
      return;
    }

    // Start at current file size — don't replay history
    let offset = 0;
    try { offset = fs.statSync(rolloutPath).size; } catch { /* ok */ }

    const timer = setInterval(() => this.poll(sessionId), CodexWatcher.POLL_MS);
    this.sessions.set(sessionId, { rolloutPath, offset, timer });
    console.log(`[codex-watcher] Watching: ${rolloutPath}`);
  }

  stopWatching(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    clearInterval(s.timer);
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const [id] of this.sessions) this.stopWatching(id);
  }

  /**
   * Find the most recently updated Codex thread rollout_path matching a CWD.
   * Uses sqlite3 CLI since we can't bundle a native SQLite driver easily.
   */
  private findRolloutPath(cwd: string): string | null {
    try {
      const result = execSync(
        `sqlite3 "${CodexWatcher.STATE_DB}" "SELECT rollout_path FROM threads WHERE cwd = '${cwd.replace(/'/g, "''")}' AND archived = 0 ORDER BY updated_at DESC LIMIT 1"`,
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  private poll(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    let size: number;
    try { size = fs.statSync(s.rolloutPath).size; } catch { return; }
    if (size <= s.offset) return;

    try {
      const fd = fs.openSync(s.rolloutPath, 'r');
      const buf = Buffer.alloc(size - s.offset);
      fs.readSync(fd, buf, 0, buf.length, s.offset);
      fs.closeSync(fd);
      s.offset = size;

      for (const line of buf.toString('utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.processEntry(sessionId, JSON.parse(trimmed));
        } catch { /* partial or invalid JSON */ }
      }
    } catch { /* read error */ }
  }

  private processEntry(sessionId: string, entry: unknown): void {
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
      if (fullText) this.emit('assistant:text', sessionId, fullText);
    }

    // Tool calls (function_call)
    if (e.type === 'response_item' && payload.type === 'function_call') {
      const name = String(payload.name || 'unknown');
      const args = String(payload.arguments || '');
      this.emit('tool:call', sessionId, name, args);
    }

    // User messages
    if (e.type === 'event_msg' && payload.type === 'user_message') {
      const text = String(payload.message || payload.text || '');
      if (text.trim()) this.emit('user:message', sessionId, text);
    }
  }
}
