import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  closeSync,
  readSync,
  writeFileSync,
  lstatSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { execFileSync, execSync, spawnSync } from 'child_process';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getRealHome } from './env.js';

export type ContinuitySource = 'codex' | 'claude';
export type ContinuityTarget = 'clipboard' | 'mms-codex' | 'mms-claude' | 'codex' | 'claude';
export type ContinuityPreset = 'compact' | 'standard' | 'full';
export type ContinuityOutput = 'clipboard' | 'file';

export interface ContinuitySession {
  id: string;
  source: ContinuitySource;
  cwd: string;
  branch?: string;
  model?: string;
  summary?: string;
  rawPath: string;
  updatedAtMs: number;
  createdAtMs: number;
  bytes: number;
  origin: 'real-home' | 'mms-slot' | 'mms-project' | 'mms-account' | 'env-home';
}

interface ContinuityMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ContinuitySummary {
  at?: string;
  content: string;
}

interface ToolActivity {
  name: string;
  summary: string;
  result?: string;
}

interface ExtractedContext {
  summaries: ContinuitySummary[];
  messages: ContinuityMessage[];
  tools: ToolActivity[];
  files: string[];
}

export interface ContinuityOptions {
  ref?: string;
  to?: ContinuityTarget;
  print?: boolean;
  copy?: boolean;
  launch?: boolean;
  list?: boolean;
  preset?: ContinuityPreset;
  output?: ContinuityOutput;
  limit?: number;
  git?: boolean;
  all?: boolean;
}

interface ParsedArgs extends ContinuityOptions {
  help?: boolean;
}

interface PresetLimits {
  summaries: number;
  summaryChars: number;
  messages: number;
  tools: number;
  messageChars: number;
  resultChars: number;
  includeToolResults: boolean;
}

const DEFAULT_LIMIT = 40;
const HEAD_SCAN_BYTES = 4 * 1024 * 1024;
const TAIL_SCAN_BYTES = 16 * 1024 * 1024;
const CONTINUITY_PACK_HEADER = '# MindKeeper Continuity Pack';
const CONTINUITY_PACK_OMITTED = '[previous MindKeeper Continuity Pack omitted]';
const CONTINUITY_PACK_END_MARKER = '- 不要重复已经完成的探索；从最近未解决点继续。';

const CLIPBOARD_PRESET_LIMITS: Record<ContinuityPreset, PresetLimits> = {
  compact: { summaries: 4, summaryChars: 420, messages: 4, tools: 6, messageChars: 700, resultChars: 0, includeToolResults: false },
  standard: { summaries: 8, summaryChars: 700, messages: 8, tools: 12, messageChars: 1200, resultChars: 0, includeToolResults: false },
  full: { summaries: 20, summaryChars: 1200, messages: 16, tools: 40, messageChars: 5000, resultChars: 1200, includeToolResults: true },
};

const FILE_PRESET_LIMITS: Record<ContinuityPreset, PresetLimits> = {
  compact: { summaries: 10, summaryChars: 900, messages: 12, tools: 20, messageChars: 1800, resultChars: 0, includeToolResults: false },
  standard: { summaries: 30, summaryChars: 1200, messages: 24, tools: 50, messageChars: 4000, resultChars: 0, includeToolResults: false },
  full: { summaries: 100, summaryChars: 2400, messages: 80, tools: 160, messageChars: 20000, resultChars: 8000, includeToolResults: true },
};

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function limitsFor(preset: ContinuityPreset, output: ContinuityOutput): PresetLimits {
  return (output === 'file' ? FILE_PRESET_LIMITS : CLIPBOARD_PRESET_LIMITS)[preset];
}

function realpathish(path: string): string {
  try {
    return resolve(path);
  } catch {
    return path;
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function safeLstat(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function isLikelyMmsSlot(path: string): boolean {
  return path.includes('/.config/mms/') && /\/s\/[^/]+\//.test(path);
}

function isLikelyMmsAccount(path: string): boolean {
  return path.includes('/.config/mms/accounts/');
}

function originForPath(path: string, envHome: string): ContinuitySession['origin'] {
  if (path.includes('/.config/mms/projects/')) return 'mms-project';
  if (isLikelyMmsAccount(path)) return 'mms-account';
  if (isLikelyMmsSlot(path)) return 'mms-slot';
  if (envHome && path.startsWith(envHome + '/')) return 'env-home';
  return 'real-home';
}

function walkFiles(root: string, match: (path: string) => boolean, maxDepth = 8): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === '.DS_Store') continue;
      const path = join(dir, entry);
      const lst = safeLstat(path);
      if (!lst) continue;
      if (lst.isSymbolicLink()) {
        const st = safeStat(path);
        if (st?.isFile() && match(path)) out.push(path);
        continue;
      }
      if (lst.isDirectory()) {
        visit(path, depth + 1);
      } else if (lst.isFile() && match(path)) {
        out.push(path);
      }
    }
  };
  visit(root, 0);
  return out;
}

function walkDirs(root: string, match: (path: string) => boolean, maxDepth = 8): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      const lst = safeLstat(path);
      if (!lst || lst.isSymbolicLink()) continue;
      if (!lst.isDirectory()) continue;
      if (match(path)) out.push(path);
      visit(path, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function readHeadText(path: string, maxBytes = HEAD_SCAN_BYTES): string {
  const fd = openSync(path, 'r');
  try {
    const st = statSync(path);
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, 0);
    return buf.toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

function readTailText(path: string, maxBytes = TAIL_SCAN_BYTES): string {
  const fd = openSync(path, 'r');
  try {
    const st = statSync(path);
    const len = Math.min(st.size, maxBytes);
    const start = Math.max(0, st.size - len);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    const text = buf.toString('utf-8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

function jsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .flatMap(line => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return [];
      try {
        return [JSON.parse(trimmed)];
      } catch {
        return [];
      }
    });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + `\n[...${text.length - maxChars} chars omitted]`;
}

function cleanText(text: string): string {
  return redactSecrets(stripEmbeddedContinuityPack(text))
    .replace(/\r/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function stripEmbeddedContinuityPack(text: string): string {
  const start = text.indexOf(CONTINUITY_PACK_HEADER);
  if (start === -1) return text;
  const before = text.slice(0, start).trimEnd();
  const endMarker = text.lastIndexOf(CONTINUITY_PACK_END_MARKER);
  let after = '';
  if (endMarker > start) {
    const nextLine = text.indexOf('\n', endMarker + CONTINUITY_PACK_END_MARKER.length);
    after = text.slice(nextLine === -1 ? endMarker + CONTINUITY_PACK_END_MARKER.length : nextLine).trim();
  }
  return [before, CONTINUITY_PACK_OMITTED, after].filter(Boolean).join('\n\n');
}

function oneLine(text: string, maxChars = 90): string {
  return truncate(cleanText(text).replace(/\s+/g, ' '), maxChars).replace(/\n.*/s, '');
}

function redactSecrets(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|token|authorization|password|secret|auth_token)["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_KEY]');
}

function extractRepoName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() || cwd || '-';
}

function parseCodexFilename(path: string): { id: string; createdAtMs: number } | undefined {
  const match = basename(path).match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, id] = match;
  return {
    id,
    createdAtMs: Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`),
  };
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const chunks: string[] = [];
  for (const block of content) {
    const b = record(block);
    if (!b) continue;
    const type = stringValue(b.type) || '';
    if ((type === 'input_text' || type === 'output_text' || type === 'text') && typeof b.text === 'string') {
      chunks.push(b.text);
    } else if (type === 'tool_result') {
      const toolText = extractContent(b.content);
      if (toolText) chunks.push(`[tool_result]\n${toolText}`);
    } else if (type === 'tool_use') {
      const name = stringValue(b.name) || 'tool';
      chunks.push(`[tool_use: ${name}]`);
    }
  }
  return chunks.join('\n\n');
}

function parseCodexSession(path: string, envHome: string): ContinuitySession | undefined {
  const parsed = parseCodexFilename(path);
  if (!parsed) return undefined;
  const st = safeStat(path);
  if (!st) return undefined;

  let cwd = '';
  let branch = '';
  let model = '';
  let firstUser = '';
  let createdAtMs = parsed.createdAtMs;
  for (const entry of jsonLines(readHeadText(path))) {
    const msg = record(entry);
    if (!msg) continue;
    const payload = record(msg.payload);
    if (msg.type === 'session_meta' && payload) {
      const meta = record(payload.payload) || payload;
      cwd ||= stringValue(meta.cwd) || '';
      model ||= stringValue(meta.model) || stringValue(meta.model_provider) || '';
      const timestamp = stringValue(meta.timestamp) || stringValue(payload.timestamp);
      const ts = timestamp ? Date.parse(timestamp) : NaN;
      if (!Number.isNaN(ts)) createdAtMs = ts;
      const git = record(meta.git);
      branch ||= stringValue(git?.branch) || '';
    }
    if (!firstUser && msg.type === 'event_msg' && payload?.type === 'user_message') {
      const candidate = stringValue(payload.message) || '';
      if (isRealUserContent(candidate)) firstUser = candidate;
    }
    if (!firstUser && msg.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') {
      const candidate = extractContent(payload.content);
      if (isRealUserContent(candidate)) firstUser = candidate;
    }
    if (cwd && firstUser) break;
  }

  return {
    id: parsed.id,
    source: 'codex',
    cwd,
    branch: branch || undefined,
    model: model || undefined,
    summary: firstUser ? oneLine(firstUser, 180) : undefined,
    rawPath: path,
    createdAtMs,
    updatedAtMs: st.mtimeMs,
    bytes: st.size,
    origin: originForPath(path, envHome),
  };
}

function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/:/g, '').replace(/[/.]/g, '-');
}

function parseClaudeSession(path: string, envHome: string): ContinuitySession | undefined {
  const st = safeStat(path);
  if (!st || !basename(path).endsWith('.jsonl')) return undefined;
  if (path.includes('/subagents/')) return undefined;

  let sessionId = basename(path, '.jsonl');
  let cwd = '';
  let branch = '';
  let model = '';
  let firstUser = '';
  let latestSummary = '';
  let firstTs = 0;
  let lastTs = 0;
  for (const entry of jsonLines(readHeadText(path))) {
    const msg = record(entry);
    if (!msg) continue;
    sessionId = stringValue(msg.sessionId) || sessionId;
    cwd ||= stringValue(msg.cwd) || '';
    branch ||= stringValue(msg.gitBranch) || '';
    const message = record(msg.message);
    model ||= stringValue(message?.model) || stringValue(msg.model) || '';
    const ts = Date.parse(stringValue(msg.timestamp) || '');
    if (!Number.isNaN(ts)) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
    }
    if (!firstUser && msg.type === 'user') {
      const content = extractClaudeText(msg);
      if (isRealUserContent(content)) firstUser = content;
    }
    if (cwd && firstUser && sessionId) break;
  }
  for (const entry of jsonLines(readTailText(path))) {
    const msg = record(entry);
    if (!msg) continue;
    sessionId = stringValue(msg.sessionId) || sessionId;
    cwd ||= stringValue(msg.cwd) || '';
    branch ||= stringValue(msg.gitBranch) || '';
    const message = record(msg.message);
    model ||= stringValue(message?.model) || stringValue(msg.model) || '';
    const ts = Date.parse(stringValue(msg.timestamp) || '');
    if (!Number.isNaN(ts)) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
    }
    const content = extractClaudeText(msg);
    if (msg.type === 'system' && msg.subtype === 'away_summary' && content) {
      latestSummary = content;
    } else if (msg.type === 'user' && isRealUserContent(content)) {
      latestSummary = content;
    }
  }

  return {
    id: sessionId,
    source: 'claude',
    cwd,
    branch: branch || undefined,
    model: model || undefined,
    summary: (latestSummary || firstUser) ? oneLine(latestSummary || firstUser, 180) : undefined,
    rawPath: path,
    createdAtMs: firstTs || st.birthtimeMs,
    updatedAtMs: lastTs || st.mtimeMs,
    bytes: st.size,
    origin: originForPath(path, envHome),
  };
}

function extractClaudeText(msg: Record<string, unknown>): string {
  const message = record(msg.message);
  const content = typeof msg.content === 'string' ? msg.content : extractContent(message?.content);
  return stripClaudeLocalCommandMarkup(content);
}

function stripClaudeLocalCommandMarkup(text: string): string {
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/giu, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/giu, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/giu, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/giu, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/giu, '')
    .trim();
}

function isRealUserContent(text: string): boolean {
  const cleaned = cleanText(text);
  if (!cleaned) return false;
  if (cleaned === CONTINUITY_PACK_OMITTED) return false;
  if (cleaned.startsWith('CAVEMAN MODE ACTIVE')) return false;
  if (cleaned.startsWith(CONTINUITY_PACK_HEADER)) return false;
  if (cleaned.startsWith('# AGENTS.md instructions')) return false;
  if (cleaned.startsWith('<environment_context>')) return false;
  if (cleaned.startsWith('<permissions instructions>')) return false;
  if (cleaned.includes('<INSTRUCTIONS>') && cleaned.includes('<environment_context>')) return false;
  if (cleaned.startsWith('<system-reminder>')) return false;
  if (cleaned.startsWith('[tool_result]')) return false;
  if (cleaned.startsWith('[tool_use:')) return false;
  return true;
}

function isConversationNoise(role: string, content: string, phase?: string): boolean {
  const cleaned = cleanText(content);
  if (!cleaned) return true;
  if (phase === 'commentary') return true;
  if (role === 'user' && cleaned.startsWith('CAVEMAN MODE ACTIVE')) return true;
  if (!isRealUserContent(cleaned)) return true;
  return false;
}

function codexRoots(realHome: string, envHome: string): string[] {
  return uniq([
    join(realHome, '.codex'),
    envHome ? join(envHome, '.codex') : '',
    join(realHome, '.config/mms/codex-gateway/.codex'),
    ...walkDirs(join(realHome, '.config/mms/codex-gateway/s'), p => basename(p) === '.codex', 3),
    ...walkDirs(join(realHome, '.config/mms/accounts'), p => basename(p) === '.codex', 5),
  ].filter(Boolean));
}

function claudeRoots(realHome: string, envHome: string): string[] {
  return uniq([
    join(realHome, '.claude/projects'),
    envHome ? join(envHome, '.claude/projects') : '',
    join(realHome, '.config/mms/claude-gateway/.claude/projects'),
    ...walkDirs(join(realHome, '.config/mms/claude-gateway/s'), p => p.endsWith('/.claude/projects'), 5),
    ...walkDirs(join(realHome, '.config/mms/accounts'), p => p.endsWith('/.claude/projects'), 7),
    ...walkDirs(join(realHome, '.config/mms/projects'), p => p.endsWith('/claude/raw/projects'), 5),
    ...walkDirs(join(realHome, '.config/mms/projects'), p => p.endsWith('/claude/raw/transcripts'), 5),
  ].filter(Boolean));
}

function findCodexSessionFiles(realHome: string, envHome: string): string[] {
  const files: string[] = [];
  for (const root of codexRoots(realHome, envHome)) {
    files.push(...walkFiles(join(root, 'sessions'), p => basename(p).startsWith('rollout-') && p.endsWith('.jsonl'), 8));
    files.push(...walkFiles(join(root, 'archived_sessions'), p => basename(p).startsWith('rollout-') && p.endsWith('.jsonl'), 8));
  }
  return uniq(files);
}

function findClaudeSessionFiles(realHome: string, envHome: string): string[] {
  const files: string[] = [];
  for (const root of claudeRoots(realHome, envHome)) {
    files.push(...walkFiles(root, p => p.endsWith('.jsonl') && !basename(p).includes('debug') && !p.includes('/subagents/'), 8));
  }
  return uniq(files);
}

export function discoverContinuitySessions(opts: { cwd?: string; limit?: number; all?: boolean } = {}): ContinuitySession[] {
  const realHome = getRealHome();
  const envHome = process.env.HOME || '';
  const sessions: ContinuitySession[] = [];

  for (const file of findCodexSessionFiles(realHome, envHome)) {
    const session = parseCodexSession(file, envHome);
    if (session) sessions.push(session);
  }
  for (const file of findClaudeSessionFiles(realHome, envHome)) {
    const session = parseClaudeSession(file, envHome);
    if (session) sessions.push(session);
  }

  const seen = new Map<string, ContinuitySession>();
  for (const session of sessions) {
    const key = `${session.source}:${session.id}`;
    const existing = seen.get(key);
    if (!existing || existing.updatedAtMs < session.updatedAtMs) seen.set(key, session);
  }

  const cwd = opts.cwd ? realpathish(opts.cwd) : '';
  const currentProject = cwd ? projectScope(cwd) : '';
  const scoped = opts.all || !cwd
    ? [...seen.values()]
    : [...seen.values()].filter(session => session.cwd && matchesProject(session.cwd, cwd, currentProject));
  const sorted = scoped.sort((a, b) => {
    const aLocal = cwd && a.cwd ? Number(matchesProject(a.cwd, cwd, currentProject)) : 0;
    const bLocal = cwd && b.cwd ? Number(matchesProject(b.cwd, cwd, currentProject)) : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;
    return b.updatedAtMs - a.updatedAtMs;
  });

  return sorted.slice(0, opts.limit ?? DEFAULT_LIMIT);
}

function projectScope(cwd: string): string {
  return realpathish(cwd).replace(/\/+$/u, '');
}

function matchesProject(sessionCwd: string, cwd: string, currentProject = projectScope(cwd)): boolean {
  const sessionPath = realpathish(sessionCwd).replace(/\/+$/u, '');
  const currentPath = realpathish(cwd).replace(/\/+$/u, '');
  if (currentProject) return sessionPath === currentProject || sessionPath.startsWith(currentProject + '/');
  return sessionPath === currentPath || sessionPath.startsWith(currentPath + '/');
}

function parseJsonArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return record(parsed) || {};
    } catch {
      return {};
    }
  }
  return record(value) || {};
}

function summarizeTool(name: string, args: Record<string, unknown>): string {
  const command = args.cmd || args.command;
  if (typeof command === 'string') return `$ ${oneLine(command, 220)}`;
  if (Array.isArray(command)) return `$ ${oneLine(command.join(' '), 220)}`;
  const filePath = args.file_path || args.path || args.filePath;
  if (typeof filePath === 'string') return `${name} ${filePath}`;
  const query = args.query || args.pattern || args.search_query;
  if (typeof query === 'string') return `${name} ${oneLine(query, 160)}`;
  return oneLine(JSON.stringify(args), 220) || name;
}

function collectFilesFromTool(name: string, args: Record<string, unknown>, out: Set<string>): void {
  for (const key of ['file_path', 'path', 'filePath', 'workdir']) {
    const value = args[key];
    if (typeof value === 'string' && looksLikePath(value)) out.add(value);
  }
  const cmd = typeof args.cmd === 'string' ? args.cmd : '';
  if (cmd) {
    for (const match of cmd.matchAll(/(?:^|\s)(?:sed\s+-i|tee|cat\s+>|printf\s+.*?>|mv|cp)\s+.*?\s(["']?)([./~][^"'\s;|&]+)\1/g)) {
      out.add(match[2]);
    }
  }
  if (name.includes('apply_patch') && typeof args.patch === 'string') {
    for (const match of args.patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      out.add(match[1].trim());
    }
  }
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

function extractCodexContext(session: ContinuitySession, preset: ContinuityPreset, output: ContinuityOutput): ExtractedContext {
  const limits = limitsFor(preset, output);
  const entries = jsonLines(readTailText(session.rawPath));
  const messages: ContinuityMessage[] = [];
  const tools: ToolActivity[] = [];
  const files = new Set<string>();
  const byCallId = new Map<string, ToolActivity>();

  for (const entry of entries) {
    const msg = record(entry);
    const payload = record(msg?.payload);
    if (!msg || !payload) continue;

    if (msg.type === 'response_item' && payload.type === 'message') {
      const role = payload.role === 'assistant' ? 'assistant' : payload.role === 'system' ? 'system' : 'user';
      const content = cleanText(extractContent(payload.content));
      const phase = stringValue(payload.phase);
      if (!isConversationNoise(role, content, phase)) messages.push({ role, content });
    } else if (msg.type === 'response_item' && payload.type === 'function_call') {
      const name = stringValue(payload.name) || 'tool';
      const args = parseJsonArgs(payload.arguments);
      const item = { name, summary: summarizeTool(name, args) };
      tools.push(item);
      const callId = stringValue(payload.call_id);
      if (callId) byCallId.set(callId, item);
      collectFilesFromTool(name, args, files);
    } else if (msg.type === 'response_item' && payload.type === 'function_call_output') {
      const callId = stringValue(payload.call_id);
      const item = callId ? byCallId.get(callId) : undefined;
      const outputText = stringValue(payload.output);
      if (item && outputText && limits.includeToolResults && limits.resultChars > 0) {
        item.result = truncate(cleanText(outputText), limits.resultChars);
      }
    }
  }

  return {
    summaries: [],
    messages: dedupeMessages(messages).slice(-limits.messages),
    tools: dedupeTools(tools).slice(-limits.tools),
    files: [...files].slice(0, 80),
  };
}

function extractClaudeContext(session: ContinuitySession, preset: ContinuityPreset, output: ContinuityOutput): ExtractedContext {
  const limits = limitsFor(preset, output);
  const entries = jsonLines(readTailText(session.rawPath));
  const summaries: ContinuitySummary[] = [];
  const messages: ContinuityMessage[] = [];
  const tools: ToolActivity[] = [];
  const files = new Set<string>();

  for (const entry of entries) {
    const msg = record(entry);
    if (!msg) continue;
    const message = record(msg.message);
    const role = msg.type === 'assistant' ? 'assistant' : msg.type === 'system' ? 'system' : 'user';
    const content = cleanText(extractClaudeText(msg));
    if (msg.type === 'system' && msg.subtype === 'away_summary') {
      if (content) summaries.push({ at: stringValue(msg.timestamp), content });
      continue;
    }
    const contentBlocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of contentBlocks) {
      const b = record(block);
      if (!b || b.type !== 'tool_use') continue;
      const name = stringValue(b.name) || 'tool';
      const args = record(b.input) || {};
      tools.push({ name, summary: summarizeTool(name, args) });
      collectFilesFromTool(name, args, files);
    }
    if (!isConversationNoise(role, content)) messages.push({ role, content });
  }

  return {
    summaries: dedupeSummaries(summaries).slice(-limits.summaries),
    messages: dedupeMessages(messages).slice(-limits.messages),
    tools: dedupeTools(tools).slice(-limits.tools),
    files: [...files].slice(0, 80),
  };
}

function dedupeMessages(messages: ContinuityMessage[]): ContinuityMessage[] {
  const out: ContinuityMessage[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role && last.content === msg.content) continue;
    out.push(msg);
  }
  return out;
}

function dedupeSummaries(summaries: ContinuitySummary[]): ContinuitySummary[] {
  const out: ContinuitySummary[] = [];
  const seen = new Set<string>();
  for (const summary of summaries) {
    const key = cleanText(summary.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(summary);
  }
  return out;
}

function dedupeTools(tools: ToolActivity[]): ToolActivity[] {
  const out: ToolActivity[] = [];
  for (const tool of tools) {
    const last = out[out.length - 1];
    if (last && last.name === tool.name && last.summary === tool.summary) {
      if (!last.result && tool.result) last.result = tool.result;
      continue;
    }
    out.push(tool);
  }
  return out;
}

function extractSessionContext(session: ContinuitySession, preset: ContinuityPreset, output: ContinuityOutput): ExtractedContext {
  return session.source === 'codex' ? extractCodexContext(session, preset, output) : extractClaudeContext(session, preset, output);
}

function gitState(cwd: string, preset: ContinuityPreset): string[] {
  if (!cwd || !existsSync(cwd)) return [];
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const lines: string[] = [];
  const root = run('git rev-parse --show-toplevel');
  if (!root) return [];
  lines.push(`- repo: \`${root}\``);
  const branch = run('git branch --show-current') || run('git rev-parse --short HEAD');
  if (branch) lines.push(`- branch: \`${branch}\``);
  const last = run('git log -1 --oneline');
  if (last) lines.push(`- last commit: \`${last.replace(/`/g, '\\`')}\``);
  const stat = run('git diff --stat');
  if (stat) lines.push(`- diff stat: ${stat.split('\n').slice(-1)[0]}`);
  const status = run('git status --short');
  if (status) {
    const statusLines = status.split('\n').filter(Boolean);
    lines.push(`- working tree: dirty (${statusLines.length} changed files)`);
    if (preset === 'full') {
      lines.push('- changed files:');
      for (const line of statusLines.slice(0, 80)) lines.push(`  - \`${line.replace(/`/g, '\\`')}\``);
    }
  }
  return lines;
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC');
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function paint(code: keyof typeof ansi, text: string): string {
  if (!useColor || code === 'reset') return text;
  return `${ansi[code]}${text}${ansi.reset}`;
}

function terminalWidth(): number {
  return Math.min(Math.max(process.stdout.columns || 100, 82), 132);
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) || 0;
  return code > 0x7f ? 2 : 1;
}

function visibleWidth(text: string): number {
  return [...stripAnsi(text)].reduce((sum, char) => sum + charWidth(char), 0);
}

function padVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

function clipVisible(text: string, width: number): string {
  const raw = stripAnsi(text).replace(/\s+/g, ' ').trim();
  if (visibleWidth(raw) <= width) return raw;
  let out = '';
  let used = 0;
  for (const char of raw) {
    const w = charWidth(char);
    if (used + w > width - 1) break;
    out += char;
    used += w;
  }
  return out.trimEnd() + '…';
}

function box(title: string, body: string[], width = terminalWidth()): string {
  const inner = width - 4;
  const topTitle = ` ${title} `;
  const topFill = Math.max(0, inner - visibleWidth(topTitle));
  const lines = [`╭─${paint('bold', topTitle)}${'─'.repeat(topFill)}─╮`];
  for (const line of body) {
    const bodyLine = visibleWidth(line) > inner ? clipVisible(line, inner) : line;
    lines.push(`│ ${padVisible(bodyLine, inner)} │`);
  }
  lines.push(`╰${'─'.repeat(inner + 2)}╯`);
  return lines.join('\n');
}

function sourceBadge(source: ContinuitySource): string {
  return source === 'codex' ? paint('cyan', 'codex ') : paint('magenta', 'claude');
}

function originBadge(origin: ContinuitySession['origin']): string {
  const text = origin === 'real-home' ? 'home'
    : origin === 'mms-slot' ? 'mms-slot'
      : origin === 'mms-account' ? 'oauth'
        : origin === 'mms-project' ? 'mms-proj'
          : 'env';
  return origin === 'mms-account' ? paint('yellow', text)
    : origin.startsWith('mms') ? paint('blue', text)
      : paint('gray', text);
}

function targetText(target: ContinuityTarget | undefined): string {
  if (!target || target === 'clipboard') return 'clipboard';
  if (target === 'mms-codex') return 'mms codex';
  if (target === 'mms-claude') return 'mms claude';
  return target;
}

function outputText(output: ContinuityOutput | undefined): string {
  return output === 'file' ? paint('yellow', 'file') : paint('green', 'clipboard');
}

function presetText(preset: ContinuityPreset | undefined): string {
  const p = preset || 'standard';
  if (p === 'full') return paint('yellow', p);
  if (p === 'compact') return paint('green', p);
  return paint('cyan', p);
}

function formatBytes(chars: number): string {
  if (chars < 1000) return `${chars} chars`;
  return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k chars`;
}

function formatSessionRow(session: ContinuitySession, index: number): string {
  const age = formatAge(session.updatedAtMs);
  const repo = extractRepoName(session.cwd);
  const summaryWidth = Math.max(24, terminalWidth() - 74);
  const summary = clipVisible(oneLine(session.summary || '(no summary)', 220), summaryWidth);
  return [
    paint('bold', String(index).padStart(2, ' ')),
    sourceBadge(session.source),
    padVisible(paint('gray', age), 6),
    padVisible(clipVisible(repo, 18), 18),
    paint('bold', session.id.slice(0, 8)),
    padVisible(originBadge(session.origin), 8),
    summary,
  ].join('  ');
}

function formatAge(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function renderContinuityMarkdown(
  session: ContinuitySession,
  context: ExtractedContext,
  preset: ContinuityPreset,
  target: ContinuityTarget,
  output: ContinuityOutput,
  includeGit: boolean,
): string {
  const limits = limitsFor(preset, output);
  const lines: string[] = [
    '# MindKeeper Continuity Pack',
    '',
    '你正在接手一个已有 coding session。先读取这份上下文，然后继续推进，不要从零开始。',
    '',
    '## Session',
    '',
    `- source: \`${session.source}\``,
    `- session id: \`${session.id}\``,
    `- target: \`${target}\``,
    `- output: \`${output}\``,
    `- cwd: \`${session.cwd || process.cwd()}\``,
  ];
  if (session.branch) lines.push(`- branch: \`${session.branch}\``);
  if (session.model) lines.push(`- model: \`${session.model}\``);
  lines.push(
    `- last active: ${formatTime(session.updatedAtMs)}`,
    `- raw transcript: \`${session.rawPath}\``,
    `- origin: \`${session.origin}\``,
    '',
  );

  if (session.summary) {
    lines.push('## Current Goal', '', session.summary, '');
  }

  const git = includeGit ? gitState(session.cwd || process.cwd(), preset) : [];
  if (git.length > 0) {
    lines.push('## Git State', '', ...git, '');
  }

  if (context.summaries.length > 0) {
    lines.push('## Session Summaries', '');
    for (const summary of context.summaries) {
      const ts = summary.at ? Date.parse(summary.at) : NaN;
      const when = Number.isNaN(ts) ? '' : ` (${formatTime(ts)})`;
      lines.push(`- ${truncate(cleanText(summary.content), limits.summaryChars)}${when}`);
    }
    lines.push('');
  }

  if (context.messages.length > 0) {
    lines.push('## Recent Conversation', '');
    for (const message of context.messages) {
      lines.push(`### ${message.role}`);
      lines.push('');
      lines.push(truncate(cleanText(message.content), limits.messageChars));
      lines.push('');
    }
  }

  if (context.tools.length > 0) {
    lines.push('## Tool Activity', '');
    for (const tool of context.tools) {
      lines.push(`- **${tool.name}**: ${tool.summary}`);
      if (limits.includeToolResults && tool.result) {
        lines.push('');
        lines.push('```text');
        lines.push(tool.result);
        lines.push('```');
      }
    }
    lines.push('');
  }

  const files = uniq(context.files).filter(Boolean);
  if (files.length > 0) {
    lines.push('## Files Mentioned Or Touched', '');
    for (const file of files) lines.push(`- \`${file.replace(/`/g, '\\`')}\``);
    lines.push('');
  }

  lines.push(
    '## Continue Instructions',
    '',
    '- 保持当前 repo 和任务方向。',
    '- 先检查 `git status` 和关键文件，再继续动手。',
    '- 如果上下文不足，优先读取 raw transcript 路径或相关文件。',
    '- 不要重复已经完成的探索；从最近未解决点继续。',
    '',
  );

  return lines.join('\n');
}

function continuityDir(cwd: string): string {
  return join(cwd, '.ai', 'continuity');
}

function writeContinuityFile(session: ContinuitySession, markdown: string, cwd: string): string {
  const dir = continuityDir(cwd);
  mkdirSync(dir, { recursive: true });
  const fileName = `${session.source}-${session.id.slice(0, 12)}.md`;
  const path = join(dir, fileName);
  writeFileSync(path, markdown, 'utf-8');
  return path;
}

function copyToClipboard(text: string): boolean {
  const commands =
    process.platform === 'darwin'
      ? [['pbcopy']]
      : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']];
  for (const command of commands) {
    const result = spawnSync(command[0], command.slice(1), { input: text, encoding: 'utf-8' });
    if (result.status === 0) return true;
  }
  return false;
}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = { copy: true };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--print') opts.print = true;
    else if (arg === '--no-copy') {
      opts.copy = false;
      opts.output = opts.output || 'file';
    }
    else if (arg === '--file') {
      opts.output = 'file';
      opts.copy = false;
    }
    else if (arg === '--clipboard' || arg === '--paste') {
      opts.output = 'clipboard';
      opts.copy = true;
    }
    else if (arg === '--output' || arg === '--mode') opts.output = normalizeOutput(argv[++i]);
    else if (arg.startsWith('--output=')) opts.output = normalizeOutput(arg.slice('--output='.length));
    else if (arg.startsWith('--mode=')) opts.output = normalizeOutput(arg.slice('--mode='.length));
    else if (arg === '--no-git') opts.git = false;
    else if (arg === '--launch') opts.launch = true;
    else if (arg === '--list' || arg === '-l') opts.list = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--to') opts.to = normalizeTarget(argv[++i]);
    else if (arg.startsWith('--to=')) opts.to = normalizeTarget(arg.slice('--to='.length));
    else if (arg === '--preset') opts.preset = normalizePreset(argv[++i]);
    else if (arg.startsWith('--preset=')) opts.preset = normalizePreset(arg.slice('--preset='.length));
    else if (arg === '--limit') opts.limit = Number(argv[++i]) || DEFAULT_LIMIT;
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length)) || DEFAULT_LIMIT;
    else if (!arg.startsWith('--')) positional.push(arg);
  }
  opts.ref = positional[0];
  return opts;
}

function normalizeOutput(value: string | undefined): ContinuityOutput {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'file' || v === 'files' || v === 'disk' || v === 'write') return 'file';
  return 'clipboard';
}

function resolveOutput(opts: ParsedArgs): ContinuityOutput {
  if (opts.output) return opts.output;
  return opts.copy === false ? 'file' : 'clipboard';
}

function normalizeTarget(value: string | undefined): ContinuityTarget | undefined {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'clip' || v === 'clipboard' || v === 'copy') return 'clipboard';
  if (v === 'mms-codex' || v === 'mms:codex') return 'mms-codex';
  if (v === 'mms-claude' || v === 'mms:claude') return 'mms-claude';
  if (v === 'codex') return 'codex';
  if (v === 'claude') return 'claude';
  return undefined;
}

function normalizePreset(value: string | undefined): ContinuityPreset {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'compact' || v === 'minimal') return 'compact';
  if (v === 'full' || v === 'verbose') return 'full';
  return 'standard';
}

function findByRef(sessions: ContinuitySession[], ref: string): ContinuitySession | undefined {
  if (/^\d+$/u.test(ref)) {
    const index = Number(ref);
    return index > 0 ? sessions[index - 1] : undefined;
  }
  const [maybeSource, maybeId] = ref.includes(':') ? ref.split(':', 2) : ['', ref];
  const source = maybeSource === 'codex' || maybeSource === 'claude' ? maybeSource : '';
  const id = source ? maybeId : ref;
  const exact = sessions.find(s => (!source || s.source === source) && s.id === id);
  if (exact) return exact;
  return sessions.find(s => (!source || s.source === source) && (s.id.startsWith(id) || basename(s.rawPath).includes(id)));
}

async function chooseSession(
  sessions: ContinuitySession[],
  ref?: string,
  opts: ParsedArgs = { copy: true, preset: 'standard' },
  searchAll = false,
): Promise<ContinuitySession | undefined> {
  if (ref) return findByRef(sessions, ref);
  if (!process.stdin.isTTY || !process.stdout.isTTY) return sessions[0];

  printSessionList(sessions.slice(0, 20), opts, searchAll);
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`\n${paint('bold', 'Pick session')} ${paint('gray', '[1]')} › `)).trim();
    const index = answer ? Number(answer) : 1;
    return sessions[index - 1] || sessions[0];
  } finally {
    rl.close();
  }
}

async function chooseOutput(opts: ParsedArgs): Promise<ContinuityOutput> {
  if (opts.output || opts.copy === false) return resolveOutput(opts);
  if (!process.stdin.isTTY || !process.stdout.isTTY) return resolveOutput(opts);
  const rl = createInterface({ input, output });
  try {
    console.log('');
    console.log(box('Output Mode', [
      `${paint('bold', '1')} clipboard  ${paint('gray', 'paste-sized, auto-copy, best for immediate resume')}`,
      `${paint('bold', '2')} file       ${paint('gray', 'larger pack, writes .ai/continuity/*.md, no auto-copy')}`,
    ], Math.min(terminalWidth(), 92)));
    const answer = (await rl.question(`${paint('bold', 'Pick output')} ${paint('gray', '[1]')} › `)).trim();
    if (answer === '2' || answer.toLowerCase() === 'file') {
      opts.output = 'file';
      opts.copy = false;
      return 'file';
    }
    opts.output = 'clipboard';
    opts.copy = true;
    return 'clipboard';
  } finally {
    rl.close();
  }
}

async function choosePreset(existing: ContinuityPreset | undefined, outputMode: ContinuityOutput): Promise<ContinuityPreset> {
  if (existing) return existing;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'standard';
  const rl = createInterface({ input, output });
  const fileMode = outputMode === 'file';
  try {
    console.log('');
    console.log(box('Fidelity', [
      `${paint('bold', '1')} compact   ${paint('gray', fileMode ? 'small file, still has summaries' : 'short paste, fastest')}`,
      `${paint('bold', '2')} standard  ${paint('green', 'recommended')} ${paint('gray', fileMode ? 'larger handoff, balanced' : 'paste-sized, balanced')}`,
      `${paint('bold', '3')} full      ${paint('gray', fileMode ? 'max context, big file' : 'large paste, high fidelity')}`,
    ], Math.min(terminalWidth(), 92)));
    const answer = (await rl.question(`${paint('bold', 'Pick fidelity')} ${paint('gray', '[2]')} › `)).trim();
    if (answer === '1' || answer.toLowerCase() === 'compact') return 'compact';
    if (answer === '3' || answer.toLowerCase() === 'full') return 'full';
    return 'standard';
  } finally {
    rl.close();
  }
}

function launchTarget(target: ContinuityTarget): void {
  if (target === 'mms-codex') {
    execFileSync('mms', ['codex'], { stdio: 'inherit' });
  } else if (target === 'mms-claude') {
    execFileSync('mms', ['claude'], { stdio: 'inherit' });
  } else if (target === 'codex') {
    execFileSync('codex', [], { stdio: 'inherit' });
  } else if (target === 'claude') {
    execFileSync('claude', [], { stdio: 'inherit' });
  }
}

function printSessionList(sessions: ContinuitySession[], opts: ParsedArgs, searchAll: boolean): void {
  const scope = searchAll ? 'all projects' : `current dir: ${process.cwd()}`;
  const output = resolveOutput(opts);
  console.log(box('MindKeeper Continuity', [
    `${paint('cyan', 'continuity')} sits between native resume and distill.`,
    `scope ${paint('bold', scope)}`,
    `output ${outputText(output)}  preset ${presetText(opts.preset)}  target ${paint('bold', targetText(opts.to))}  limit ${opts.limit ?? DEFAULT_LIMIT}`,
  ]));
  console.log('');
  console.log([
    padVisible('#', 2),
    padVisible('cli', 6),
    padVisible('age', 6),
    padVisible('project', 18),
    padVisible('hash', 8),
    padVisible('origin', 8),
    'signal',
  ].join('  '));
  console.log(paint('gray', '─'.repeat(Math.min(terminalWidth(), 132))));
  sessions.forEach((session, index) => console.log(formatSessionRow(session, index + 1)));
}

function printActionHint(): void {
  console.log('');
  console.log(paint('gray', 'Examples'));
  console.log(`  ${paint('bold', 'mk c 2')} ${paint('gray', '继续第 2 条')}`);
  console.log(`  ${paint('bold', 'mk c 2 --output file --preset full')} ${paint('gray', '写大文件，高保真')}`);
  console.log(`  ${paint('bold', 'mk c claude:<id> --to mms-codex --preset full')} ${paint('gray', '剪贴板续接')}`);
  console.log(`  ${paint('bold', 'mk c --all --list')} ${paint('gray', '查看所有项目')}`);
}

function printContinuityHelp(): void {
  console.log(box('MindKeeper Continuity', [
    'Cross-CLI resume pack: native resume < continuity < distill.',
    'Reads local Claude/Codex/MMS transcripts; writes .ai/continuity/*.md.',
  ]));
  console.log(`
${paint('bold', 'Usage')}
  mk c                              interactive picker, copy pack
  mk c 2                            pick row 2 from current-dir sessions
  mk c codex:<hash>                 resolve Codex session by hash/prefix
  mk c claude:<session-id>          resolve Claude session by id/prefix

${paint('bold', 'Scope')}
  -l, --list                        list current-dir sessions
  --all --list                      list all discoverable projects
  --limit <n>                       list/search limit, default ${DEFAULT_LIMIT}

${paint('bold', 'Output')}
  --to clipboard|mms-codex|mms-claude|codex|claude
  --output clipboard|file           clipboard=paste-sized, file=larger handoff file
  --clipboard / --paste             alias: --output clipboard
  --file                            alias: --output file --no-copy
  --preset compact|standard|full    compact=short, standard=default, full=high fidelity
  --print                           print generated Markdown
  --no-copy                         do not copy to clipboard
  --no-git                          omit Git State
  --launch                          launch target CLI after copy
  -h, --help                        show this help

Interactive mode asks for only: session -> output -> fidelity.
Destination / no-git / print / launch stay as command flags to avoid noisy prompts.
`);
}

function printResultCard(args: {
  session: ContinuitySession;
  target: ContinuityTarget;
  preset: ContinuityPreset;
  output: ContinuityOutput;
  filePath: string;
  chars: number;
  copied: boolean;
  copyRequested: boolean;
}): void {
  const copyLine = args.copyRequested
    ? args.copied ? paint('green', 'copied to clipboard') : paint('red', 'copy failed')
    : args.output === 'file' ? paint('gray', 'disabled in file mode') : paint('gray', 'copy skipped');
  const launch = args.target === 'mms-codex' ? 'mms codex'
    : args.target === 'mms-claude' ? 'mms claude'
      : args.target === 'codex' ? 'codex'
        : args.target === 'claude' ? 'claude'
          : '';
  const next = args.output === 'file'
    ? launch
      ? `next ${paint('bold', launch)} ${paint('gray', 'then paste file path or ask it to read the file')}`
      : 'next ask any CLI to read this file'
    : launch
      ? `next ${paint('bold', launch)} ${paint('gray', 'then paste clipboard')}`
      : 'next paste into any CLI';
  console.log(box('Continuity Pack Ready', [
    `session ${sourceBadge(args.session.source)} ${paint('bold', args.session.id.slice(0, 12))}  ${paint('gray', args.session.origin)}`,
    `output ${outputText(args.output)}  preset ${presetText(args.preset)}  size ${paint('bold', formatBytes(args.chars))}`,
    `target ${paint('bold', targetText(args.target))}`,
    `file ${args.filePath}`,
    `clipboard ${copyLine}`,
    next,
  ]));
}

export async function cmdContinuity(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.help) {
    printContinuityHelp();
    return;
  }

  const searchAll = opts.all || Boolean(opts.ref);
  const sessions = discoverContinuitySessions({ cwd: process.cwd(), limit: opts.limit ?? DEFAULT_LIMIT, all: searchAll });
  if (opts.list) {
    if (sessions.length === 0) {
      console.log('没有发现可续聊 session');
      return;
    }
    printSessionList(sessions, opts, searchAll);
    printActionHint();
    return;
  }

  if (sessions.length === 0) {
    console.log('没有发现可续聊 session');
    return;
  }

  const session = await chooseSession(sessions, opts.ref, opts, searchAll);
  if (!session) {
    console.log(opts.ref ? `找不到 session: ${opts.ref}` : '未选择 session');
    return;
  }

  const outputMode = await chooseOutput(opts);
  const preset = await choosePreset(opts.preset, outputMode);
  const target = opts.to || 'clipboard';
  const context = extractSessionContext(session, preset, outputMode);
  const markdown = renderContinuityMarkdown(session, context, preset, target, outputMode, opts.git !== false);
  const filePath = writeContinuityFile(session, markdown, process.cwd());
  const shouldCopy = outputMode === 'clipboard' && opts.copy !== false;
  const copied = shouldCopy ? copyToClipboard(markdown) : false;

  printResultCard({
    session,
    target,
    preset,
    output: outputMode,
    filePath,
    chars: markdown.length,
    copied,
    copyRequested: shouldCopy,
  });
  if (opts.print) console.log('\n' + markdown);
  if (opts.launch && target !== 'clipboard') launchTarget(target);
}
