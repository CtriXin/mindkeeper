import type { SessionRegistry } from './session-registry.js';
import type { Store, CLISession } from './store.js';
import type { DiscordAdapter, RenderedMessage } from './discord/adapter.js';
import type { IPCServer, EventMsg, PermissionRequestMsg } from './ipc-server.js';
import { type FilterLevel, getAgentBrand } from './config.js';
import { TranscriptWatcher } from './transcript-watcher.js';

interface EventPayload {
  type: string;
  data: unknown;
}

/** Events that always pass through regardless of filter level */
const ALWAYS_FORWARD: Set<string> = new Set([
  'permission_request',
]);

/** Events that pass through in 'summary' mode */
const SUMMARY_EVENTS: Set<string> = new Set([
  'permission_request',
  'error',
  'result',
  'tool_use',
  'tool_result',
  'user_prompt',
  'notification',
]);

/** Per-session context for title generation and cross-folder detection */
interface SessionContext {
  recentPaths: string[];
  latestPrompt: string;
  lastTitleUpdate: number;
  currentTitle: string;
  crossFolderProject: string | null;
}

export class ContentRouter {
  private sessionContext = new Map<string, SessionContext>();
  private transcriptWatcher = new TranscriptWatcher();
  private static readonly TITLE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min (Discord rate limit: 2 per 10 min)

  constructor(
    private registry: SessionRegistry,
    private store: Store,
    private discord: DiscordAdapter,
    private ipc: IPCServer,
  ) {}

  start(): void {
    // CLI → IM: route events from IPC to Discord threads
    this.registry.on('session:event', (session, msg) => {
      this.routeToIM(session, msg).catch(err => {
        console.error(`[router] Error routing to IM:`, err);
      });
    });

    // CLI → IM: permission requests
    this.ipc.on('permission_request', (msg) => {
      this.handlePermissionRequest(msg).catch(err => {
        console.error(`[router] Error handling permission request:`, err);
      });
    });

    // IM → CLI: messages from Discord threads
    this.discord.onInboundMessage = (session, text, userId) => {
      this.routeFromIM(session, text, userId).catch(err => {
        console.error(`[router] Error routing from IM:`, err);
      });
    };

    // IM → CLI: permission decisions from Discord buttons
    this.discord.onPermissionDecision = (permissionId, decision) => {
      this.handlePermissionDecision(permissionId, decision);
    };

    // Transcript watcher: forward Claude's text output to Discord
    this.registry.on('session:registered', (session) => {
      this.transcriptWatcher.startWatching(session.sessionId, session.cwd);
    });
    this.registry.on('session:unregistered', (session) => {
      this.transcriptWatcher.stopWatching(session.sessionId);
    });
    this.registry.on('session:dead', (session) => {
      this.transcriptWatcher.stopWatching(session.sessionId);
    });
    this.transcriptWatcher.on('assistant:text', (sessionId, text) => {
      this.handleAssistantText(sessionId, text).catch(err => {
        console.error('[router] Error sending assistant text:', err);
      });
    });
  }

  stop(): void {
    this.transcriptWatcher.stopAll();
  }

  // ── Transcript → IM (assistant text output) ──

  private async handleAssistantText(sessionId: string, text: string): Promise<void> {
    const session = this.registry.getSession(sessionId);
    if (!session?.threadId) return;
    if (session.filterLevel === 'silent') return;

    const brand = getAgentBrand(session.agent);
    const author = { name: brand.label, ...(brand.iconUrl ? { icon_url: brand.iconUrl } : {}) };

    // Discord embed description limit is 4096 chars
    const truncated = text.length > 3800
      ? text.slice(0, 3800) + `\n*[${text.length} chars total]*`
      : text;

    await this.discord.sendToThread(session.threadId, {
      embed: {
        author,
        description: truncated,
        color: brand.color,
      },
    });
  }

  // ── CLI → IM ──

  private async routeToIM(session: CLISession, msg: EventMsg): Promise<void> {
    if (!session.threadId) return;

    // Track context for title updates (before filter — track all events)
    this.extractContext(session, msg);
    await this.maybeUpdateTitle(session);

    const event = msg.event;
    const level = session.filterLevel;

    // Filter check
    if (!this.shouldForward(event, level)) return;

    const rendered = this.renderEvent(event, msg.data, session.agent);
    await this.discord.sendToThread(session.threadId, rendered);
  }

  private async handlePermissionRequest(msg: PermissionRequestMsg): Promise<void> {
    const session = this.registry.getSession(msg.sessionId);
    if (!session?.threadId) {
      // No thread bound — auto-deny
      this.ipc.resolvePermission(msg.permissionId, 'deny', 'No IM thread bound');
      return;
    }

    // Store pending permission
    this.store.setPendingPermission({
      permissionId: msg.permissionId,
      sessionId: msg.sessionId,
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      createdAt: new Date().toISOString(),
    });

    // Send buttons to Discord thread
    const discordMsgId = await this.discord.sendPermissionButtons(
      session.threadId,
      msg.permissionId,
      msg.toolName,
      msg.toolInput,
    );

    if (discordMsgId) {
      const perm = this.store.getPendingPermission(msg.permissionId);
      if (perm) {
        perm.discordMessageId = discordMsgId;
        this.store.setPendingPermission(perm);
      }
    }
  }

  private handlePermissionDecision(permissionId: string, decision: 'allow' | 'deny'): void {
    // Resolve the IPC socket (send response to waiting hook script)
    const resolved = this.ipc.resolvePermission(permissionId, decision);
    if (resolved) {
      this.store.deletePendingPermission(permissionId);
      console.log(`[router] Permission ${permissionId.slice(0, 8)} ${decision}`);
    } else {
      console.warn(`[router] No waiting socket for permission ${permissionId.slice(0, 8)}`);
    }
  }

  // ── IM → CLI ──

  private async routeFromIM(session: CLISession, text: string, _userId: string): Promise<void> {
    const trimmed = text.trim();

    // Thread-level commands
    if (trimmed.startsWith('/')) {
      await this.handleThreadCommand(session, trimmed);
      return;
    }

    // Numeric permission shortcut
    if (/^[123]$/.test(trimmed)) {
      const pending = this.store.getPendingBySession(session.sessionId);
      if (pending.length > 0) {
        const latest = pending[pending.length - 1];
        const decision = trimmed === '3' ? 'deny' : 'allow';
        this.handlePermissionDecision(latest.permissionId, decision);
        return;
      }
    }

    // Regular message — log it for now
    // TODO Phase 2: inject into CLI session via Agent SDK resume
    console.log(`[router] IM → CLI [${session.sessionId.slice(0, 8)}]: ${trimmed}`);
    if (session.threadId) {
      await this.discord.sendToThread(
        session.threadId,
        `📝 *Message queued for CLI session (injection not yet implemented)*`,
      );
    }
  }

  private async handleThreadCommand(session: CLISession, command: string): Promise<void> {
    const parts = command.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/filter': {
        const level = parts[1] as FilterLevel;
        if (!['full', 'summary', 'silent'].includes(level)) {
          if (session.threadId) {
            await this.discord.sendToThread(session.threadId, 'Usage: `/filter full|summary|silent`');
          }
          return;
        }
        this.registry.setFilterLevel(session.sessionId, level);
        if (session.threadId) {
          await this.discord.sendToThread(session.threadId, `Filter set to **${level}**`);
        }
        break;
      }
      case '/info': {
        if (session.threadId) {
          await this.discord.sendToThread(session.threadId, [
            `**Session:** \`${session.sessionId.slice(0, 8)}\``,
            `**Project:** ${session.project}`,
            `**Branch:** ${session.branch}`,
            `**Directory:** \`${session.cwd}\``,
            `**Filter:** ${session.filterLevel}`,
            `**Status:** ${session.status}`,
            `**PID:** ${session.pid}`,
          ].join('\n'));
        }
        break;
      }
      default:
        if (session.threadId) {
          await this.discord.sendToThread(
            session.threadId,
            `Unknown command: \`${cmd}\`. Available: \`/filter\`, \`/info\``,
          );
        }
    }
  }

  // ── Helpers ──

  private shouldForward(eventType: string, level: FilterLevel): boolean {
    if (ALWAYS_FORWARD.has(eventType)) return true;
    if (level === 'full') return true;
    if (level === 'summary') return SUMMARY_EVENTS.has(eventType);
    return false; // silent
  }

  // ── Title & Context ──

  private getOrCreateContext(sessionId: string): SessionContext {
    let ctx = this.sessionContext.get(sessionId);
    if (!ctx) {
      ctx = { recentPaths: [], latestPrompt: '', lastTitleUpdate: 0, currentTitle: '', crossFolderProject: null };
      this.sessionContext.set(sessionId, ctx);
    }
    return ctx;
  }

  private extractContext(session: CLISession, msg: EventMsg): void {
    const ctx = this.getOrCreateContext(session.sessionId);

    if (msg.event === 'user_prompt') {
      const d = msg.data as { prompt?: string };
      if (d.prompt) ctx.latestPrompt = d.prompt;
    }

    if (msg.event === 'tool_result' || msg.event === 'tool_use') {
      const d = msg.data as { input?: unknown };
      const inp = this.parseInput(d.input);
      const filePath = inp.file_path as string | undefined;
      if (filePath && filePath.startsWith('/')) {
        ctx.recentPaths.push(filePath);
        if (ctx.recentPaths.length > 30) ctx.recentPaths = ctx.recentPaths.slice(-30);
      }
    }
  }

  private async maybeUpdateTitle(session: CLISession): Promise<void> {
    if (!session.threadId) return;
    const ctx = this.getOrCreateContext(session.sessionId);
    const now = Date.now();

    // Rate limit: 5 min cooldown
    if (now - ctx.lastTitleUpdate < ContentRouter.TITLE_COOLDOWN_MS) return;
    // Need a user prompt for meaningful title context (don't waste the first update on tool-only events)
    if (!ctx.latestPrompt) return;

    const newTitle = this.generateTitle(session);
    if (newTitle === ctx.currentTitle) return;

    ctx.currentTitle = newTitle;
    ctx.lastTitleUpdate = now;
    await this.discord.updateThreadTitle(session.threadId, newTitle);
    console.log(`[router] Title updated: ${newTitle}`);
  }

  private generateTitle(session: CLISession): string {
    const sctx = this.sessionContext.get(session.sessionId);
    const shortId = session.sessionId.slice(0, 6);

    // Folder indicator — detect cross-folder work
    let folderPart = session.project;
    if (sctx && sctx.recentPaths.length >= 3) {
      const effective = this.detectEffectiveProject(session.cwd, sctx.recentPaths);
      if (effective && effective !== session.project) {
        folderPart = `${session.project} \u2194 ${effective}`;
        sctx.crossFolderProject = effective;
      }
    }

    // Base: "project ↔ target / branch"
    let title = `${folderPart} / ${session.branch}`;

    // Context from latest prompt
    if (sctx?.latestPrompt) {
      let prompt = sctx.latestPrompt.split('\n')[0].trim();
      // Trim common prefixes
      prompt = prompt.replace(/^(please|help me|can you|I want to|I need to|请|帮我|帮忙)\s*/i, '');
      const maxLen = 100 - title.length - shortId.length - 7; // 7 = " — " + " [" + "]"
      if (prompt && maxLen > 10) {
        const truncated = prompt.length > maxLen ? prompt.slice(0, maxLen - 1) + '\u2026' : prompt;
        title += ` \u2014 ${truncated}`;
      }
    }

    title += ` [${shortId}]`;
    return title.length > 100 ? title.slice(0, 97) + '...' : title;
  }

  /** Detect if tool activity targets a different project than session cwd */
  private detectEffectiveProject(sessionCwd: string, paths: string[]): string | null {
    if (paths.length < 3) return null;
    const cwdNorm = sessionCwd.endsWith('/') ? sessionCwd : sessionCwd + '/';

    // Find paths outside session cwd
    const outsidePaths = paths.filter(p => p.startsWith('/') && !p.startsWith(cwdNorm));
    if (outsidePaths.length < 3 || outsidePaths.length / paths.length < 0.3) return null;

    // Extract project name at the path divergence point
    const cwdParts = sessionCwd.split('/');
    const projects = new Map<string, number>();

    for (const p of outsidePaths) {
      const parts = p.split('/');
      let divergeAt = 0;
      for (let i = 0; i < Math.min(parts.length, cwdParts.length); i++) {
        if (parts[i] !== cwdParts[i]) { divergeAt = i; break; }
        divergeAt = i + 1;
      }
      const name = parts[divergeAt];
      if (name) projects.set(name, (projects.get(name) || 0) + 1);
    }

    let dominant: string | null = null;
    let maxCount = 0;
    for (const [name, count] of projects) {
      if (count > maxCount) { maxCount = count; dominant = name; }
    }
    return dominant;
  }

  // ── Rendering ──

  private parseInput(input: unknown): Record<string, unknown> {
    if (input !== null && typeof input === 'object') return input as Record<string, unknown>;
    if (typeof input === 'string') {
      try { return JSON.parse(input); } catch { return {}; }
    }
    return {};
  }

  /** Extract readable text from Claude Code's various tool output formats */
  private extractOutputText(output: unknown): string {
    if (typeof output === 'string') return output;
    if (output === null || output === undefined) return '';
    if (Array.isArray(output)) {
      // [{type:"text", text:"..."}, ...] — Claude API content blocks
      const texts = output
        .filter((b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
        .map((b) => String((b as Record<string, unknown>).text || ''));
      return texts.length > 0 ? texts.join('\n') : JSON.stringify(output, null, 2);
    }
    if (typeof output === 'object') {
      const o = output as Record<string, unknown>;
      // Bash: {stdout, stderr, interrupted, ...}
      if (typeof o.stdout === 'string') {
        let text = o.stdout;
        if (typeof o.stderr === 'string' && o.stderr) text += `\n[stderr] ${o.stderr}`;
        return text;
      }
      if (typeof o.content === 'string') return o.content;                      // {content:"text"}
      if (Array.isArray(o.content)) return this.extractOutputText(o.content);   // {type:"tool_result",content:[...]}
      if (typeof o.output === 'string') return o.output;                        // {output:"text"}
      if (typeof o.text === 'string') return o.text;                            // {text:"..."}
      if (typeof o.result === 'string') return o.result;                        // {result:"text"}
      // Edit/Write: {filePath, success}
      if (typeof o.filePath === 'string' && typeof o.success === 'boolean') {
        return o.success ? `\u2713 ${o.filePath}` : `\u2717 ${o.filePath}`;
      }
      return JSON.stringify(output, null, 2);
    }
    return String(output);
  }

  private renderEvent(eventType: string, data: unknown, agent?: string): RenderedMessage {
    const brand = getAgentBrand(agent || 'unknown');
    const author = { name: brand.label, ...(brand.iconUrl ? { icon_url: brand.iconUrl } : {}) };
    switch (eventType) {
      case 'text':
        return { text: String(data) };

      case 'user_prompt': {
        const d = data as { prompt?: string };
        const prompt = d.prompt || String(data);
        const truncated = prompt.length > 500 ? prompt.slice(0, 500) + '...' : prompt;
        return { text: `**User:** ${truncated}` };
      }

      case 'tool_use': {
        const d = data as { name?: string; input?: unknown };
        const inp = this.parseInput(d.input);
        let summary = '';
        if (inp.command) summary = `\`${String(inp.command).slice(0, 100)}\``;
        else if (inp.file_path) summary = `\`${String(inp.file_path)}\``;
        else if (inp.pattern) summary = `\`${String(inp.pattern)}\``;
        return { text: `**${d.name || 'unknown'}** ${summary}`.trim() };
      }

      case 'tool_result': {
        const d = data as { tool?: string; input?: unknown; output?: unknown; content?: string; is_error?: boolean };
        const tool = d.tool || 'unknown';
        const isError = d.is_error === true;

        // Parse input (may be JSON string from hook's jq -c)
        const inp = this.parseInput(d.input);
        let inputSummary = '';
        if (inp.command) inputSummary = String(inp.command).slice(0, 100);
        else if (inp.file_path) inputSummary = String(inp.file_path);
        else if (inp.pattern) inputSummary = String(inp.pattern);
        else if (inp.query) inputSummary = String(inp.query).slice(0, 100);

        // Extract readable text from output (handles string, content-block arrays, and wrapped objects)
        let output = this.extractOutputText(d.output);
        if (!output && d.content) output = d.content;

        // Build embed with description (renders with visible colored side bar)
        const titleLine = `${isError ? '\u274c' : '\ud83d\udd27'} ${tool}${inputSummary ? ` \u2014 ${inputSummary}` : ''}`;
        let description: string | undefined;
        if (output) {
          const truncated = output.length > 800
            ? output.slice(0, 800) + `\n[truncated, ${output.length} chars total]`
            : output;
          description = `\`\`\`\n${truncated}\n\`\`\``;
        }

        return {
          embed: {
            author,
            title: titleLine.length > 256 ? titleLine.slice(0, 253) + '...' : titleLine,
            description,
            color: isError ? 0xED4245 : 0x57F287,
            timestamp: new Date().toISOString(),
          },
        };
      }

      case 'error':
        return {
          embed: {
            author,
            title: '\ud83d\udea8 Error',
            description: String(data),
            color: 0xED4245,
          },
        };

      case 'result': {
        const d = data as { usage?: { cost_usd?: number; input_tokens?: number; output_tokens?: number } };
        const usage = d.usage;
        return {
          embed: {
            author,
            title: '\u2705 Done',
            color: 0x57F287,
            ...(usage ? {
              footer: {
                text: `Cost: $${(usage.cost_usd || 0).toFixed(4)} | In: ${usage.input_tokens} | Out: ${usage.output_tokens}`,
              },
            } : {}),
          },
        };
      }

      case 'notification': {
        if (typeof data === 'string') return { text: data };
        const nd = data as Record<string, unknown>;
        const raw = nd.message ?? nd.title ?? nd.summary;
        // Ensure we always produce a string — nd.message may be an object in some Claude Code versions
        const summary = typeof raw === 'string'
          ? raw
          : (raw != null ? JSON.stringify(raw, null, 2) : JSON.stringify(data, null, 2));
        if (!summary) return { text: '' };
        const truncated = summary.length > 500 ? summary.slice(0, 500) + '...' : summary;
        return { text: truncated };
      }

      default:
        return { text: `[${eventType}] ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}` };
    }
  }
}
