import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';

export interface TranscriptWatcherEvents {
  'assistant:text': [sessionId: string, text: string];
}

/**
 * Watches Claude Code conversation JSONL files for new assistant text output.
 * Path convention: ~/.claude/projects/-{CWD with / → -}/{sessionId}.jsonl
 */
export class TranscriptWatcher extends EventEmitter<TranscriptWatcherEvents> {
  private sessions = new Map<string, {
    filePath: string;
    offset: number;
    timer: ReturnType<typeof setInterval>;
  }>();

  private static readonly CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
  private static readonly POLL_MS = 2000;

  startWatching(sessionId: string, cwd: string): void {
    if (this.sessions.has(sessionId)) return;

    const dirName = cwd.replace(/\//g, '-');
    const filePath = path.join(TranscriptWatcher.CLAUDE_DIR, dirName, `${sessionId}.jsonl`);

    // Start at current file size — don't replay history
    let offset = 0;
    try { offset = fs.statSync(filePath).size; } catch { /* file may not exist yet */ }

    const timer = setInterval(() => this.poll(sessionId), TranscriptWatcher.POLL_MS);
    this.sessions.set(sessionId, { filePath, offset, timer });
    console.log(`[transcript] Watching: ${filePath}`);
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

  private poll(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    let size: number;
    try { size = fs.statSync(s.filePath).size; } catch { return; }
    if (size <= s.offset) return;

    try {
      const fd = fs.openSync(s.filePath, 'r');
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

    // Only assistant messages
    if (e.type !== 'assistant') return;

    const msg = e.message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) return;

    // Extract text blocks only (skip thinking, tool_use, etc.)
    const texts: string[] = [];
    for (const block of msg.content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          texts.push(b.text);
        }
      }
    }

    const fullText = texts.join('\n').trim();
    if (fullText) {
      this.emit('assistant:text', sessionId, fullText);
    }
  }
}
