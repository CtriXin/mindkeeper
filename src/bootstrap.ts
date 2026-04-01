/**
 * brain_bootstrap v2 — 任务启动入口
 *
 * v1 → v2 改进：
 * 1. 读真实 Git 上下文（branch, status, recent commits）
 * 2. 读项目规则文件（CLAUDE.md, AGENT.md, .ai/plan/）
 * 3. 任务分类（bugfix, refactor, doc, setup）
 * 4. 精准推荐 3 个文件（带理由）
 * 5. 真实 thread/TODO 恢复信息
 * 6. 只推荐最相关的 1-2 个 procedure
 * 7. 更具体的 next action（不是泛文案）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { getRealHome } from './env.js';
import { extractKeywords } from './utils.js';

const SCE_DIR = join(getRealHome(), '.sce');

// ── 类型 ──

export interface BootstrapInput {
  task: string;
  repo?: string;
  thread?: string;
}

export interface ThreadSummary {
  id: string;
  repo: string;
  task: string;
  status: string;
  path: string;
  createdAtMs: number;
  branch?: string;
  parent?: string;
  ttl?: string;
  resumed?: string;
  cli?: string;
  model?: string;
  folder?: string;
}

// ── Git 上下文 ──

function git(cmd: string, cwd: string): string {
  try {
    // trimEnd 只去尾部换行，保留行首空格（porcelain 格式依赖前导空格）
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', timeout: 5000 }).trimEnd();
  } catch {
    return '';
  }
}

function getCurrentBranch(repo: string): string {
  return git('branch --show-current', repo) || git('rev-parse --short HEAD', repo) || 'unknown';
}

// ── Thread frontmatter 解析 ──

interface ThreadMeta {
  id?: string;
  repo?: string;
  task?: string;
  branch?: string;
  parent?: string;
  ttl?: string;
  created?: string;
  resumed?: string;
  cli?: string;
  model?: string;
  folder?: string;
}

function parseThreadFrontmatter(content: string): ThreadMeta {
  const meta: ThreadMeta = {};
  if (!content.startsWith('---')) return meta;
  const end = content.indexOf('---', 3);
  if (end < 0) return meta;
  const block = content.slice(3, end);
  block.split('\n').forEach(line => {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) {
      const [, key, val] = m;
      (meta as Record<string, string>)[key] = val.trim();
    }
  });
  return meta;
}

function parseTtl(ttl: string): number {
  const m = ttl.match(/^(\d+)(d|h|m)$/);
  if (!m) return 7 * 86400000; // 默认 7 天
  const [, n, unit] = m;
  const multiplier = unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000;
  return parseInt(n) * multiplier;
}

function extractThreadStatus(content: string): string {
  const lines = content.split('\n');
  const statusIdx = lines.findIndex(l => /^##\s*当前状态/.test(l));
  if (statusIdx < 0) return '';

  for (let i = statusIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('## ')) break;
    return line;
  }

  return '';
}

function resolveThreadCreatedAt(meta: ThreadMeta, fallbackMs: number): number {
  const createdAt = meta.created ? Date.parse(meta.created) : NaN;
  return Number.isFinite(createdAt) ? createdAt : fallbackMs;
}

/** 状态驱动 TTL：有未完成待续 14d，其他取 frontmatter 或默认 7d */
function deriveEffectiveTtl(content: string, metaTtl?: string): number {
  if (/^- \[ \]/m.test(content)) return 14 * 86400000;
  return parseTtl(metaTtl || '7d');
}

function parseThreadFile(path: string, now: number): (ThreadSummary & { expired: boolean }) | undefined {
  try {
    const content = readFileSync(path, 'utf-8');
    const mtime = statSync(path).mtime.getTime();
    const meta = parseThreadFrontmatter(content);
    const createdAtMs = resolveThreadCreatedAt(meta, mtime);
    const status = extractThreadStatus(content);
    const ttlMs = deriveEffectiveTtl(content, meta.ttl);

    return {
      id: meta.id || basename(path, '.md'),
      repo: meta.repo || '',
      task: meta.task || basename(path, '.md'),
      status,
      path,
      createdAtMs,
      branch: meta.branch,
      parent: meta.parent,
      ttl: meta.ttl,
      resumed: meta.resumed,
      cli: meta.cli,
      model: meta.model,
      folder: meta.folder,
      expired: now - createdAtMs > ttlMs,
    };
  } catch {
    return undefined;
  }
}

/** 标记 thread 已恢复：在 frontmatter 中插入 resumed 行 */
function markThreadResumed(thread: ThreadSummary): void {
  try {
    const content = readFileSync(thread.path, 'utf-8');
    if (content.includes('\nresumed:')) return; // 已标记
    const timestamp = new Date().toISOString();
    // 在 --- 结束行前插入 resumed
    const updated = content.replace(/^(---\n)/, `$1resumed: ${timestamp}\n`);
    if (updated !== content) {
      // 插在第二个 --- 前
      const lines = content.split('\n');
      const result: string[] = [];
      let fmCount = 0;
      for (const line of lines) {
        if (line === '---') {
          fmCount++;
          if (fmCount === 2) {
            result.push(`resumed: ${timestamp}`);
          }
        }
        result.push(line);
      }
      writeFileSync(thread.path, result.join('\n'), 'utf-8');
    }
  } catch { /* 静默失败 */ }
}

/** 按 repo 过滤 thread；repo 为空时返回所有 */
export function listRecentThreads(repo?: string, limit: number = 2): ThreadSummary[] {
  const threadsDir = join(SCE_DIR, 'threads');
  if (!existsSync(threadsDir)) return [];

  try {
    const now = Date.now();

    return readdirSync(threadsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => parseThreadFile(join(threadsDir, f), now))
      .filter((thread): thread is ThreadSummary & { expired: boolean } => Boolean(thread))
      .filter(t => !t.expired && !t.resumed && (!repo || t.repo === repo))
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit)
      .map(({ expired: _expired, ...thread }) => thread);
  } catch {
    return [];
  }
}

const GC_GRACE_DAYS = 30;

/** 清理过期 thread 文件：TTL 过期后再宽限 30 天删除 */
export function gcThreads(): number {
  const threadsDir = join(SCE_DIR, 'threads');
  if (!existsSync(threadsDir)) return 0;

  const now = Date.now();
  const graceMs = GC_GRACE_DAYS * 86400000;
  let deleted = 0;

  try {
    for (const f of readdirSync(threadsDir)) {
      if (!f.endsWith('.md')) continue;
      const filePath = join(threadsDir, f);
      const parsed = parseThreadFile(filePath, now);
      if (!parsed) continue;
      if (!parsed.expired) continue;

      const ttlMs = parseTtl(parsed.ttl || '7d');
      const deadSince = parsed.createdAtMs + ttlMs;
      if (now - deadSince >= graceMs) {
        unlinkSync(filePath);
        deleted++;
      }
    }
  } catch { /* GC 失败不影响主流程 */ }

  return deleted;
}

function normalizeTaskText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// extractKeywords 已统一为 extractKeywords (utils.ts)

function isGenericResumeTask(task: string): boolean {
  const normalized = normalizeTaskText(task);
  return /^(继续|继续上次|接着|接着来|恢复|resume|continue)$/.test(normalized);
}

function scoreTaskSimilarity(task: string, candidate: string): number {
  const a = normalizeTaskText(task);
  const b = normalizeTaskText(candidate);
  if (!a || !b) return 0;

  let score = 0;
  if (a === b) score += 10;
  if (a.includes(b) || b.includes(a)) score += 6;

  const aKeywords = extractKeywords(a);
  const bKeywords = extractKeywords(b);
  const shared = aKeywords.filter(token => bKeywords.includes(token));
  score += shared.length * 3;

  return score;
}

export function getThreadById(repo: string, threadId: string): ThreadSummary | undefined {
  const threadsDir = join(SCE_DIR, 'threads');
  if (!existsSync(threadsDir)) return undefined;

  const now = Date.now();
  const exactPath = join(threadsDir, `${threadId}.md`);
  const exact = parseThreadFile(exactPath, now);
  if (exact && !exact.expired) {
    // 优先匹配 repo，但不强制 — 支持任意位置恢复
    const { expired: _expired, ...thread } = exact;
    return thread;
  }

  // fallback: 扫描所有文件按 ID 查找（ID 可能和文件名不同）
  try {
    for (const file of readdirSync(threadsDir)) {
      if (!file.endsWith('.md') || file === `${threadId}.md`) continue;
      const parsed = parseThreadFile(join(threadsDir, file), now);
      if (parsed && parsed.id === threadId && !parsed.expired) {
        const { expired: _expired, ...thread } = parsed;
        return thread;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function findBestThread(
  repo: string,
  task: string,
  options?: { branch?: string; minScore?: number },
): ThreadSummary | undefined {
  const minScore = options?.minScore ?? 4;
  const candidates = listRecentThreads(repo, 50)
    .map(thread => ({
      thread,
      score:
        scoreTaskSimilarity(task, thread.task) +
        (options?.branch && thread.branch === options.branch ? 2 : 0),
    }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score || b.thread.createdAtMs - a.thread.createdAtMs);

  return candidates[0]?.thread;
}

function resolveTargetThread(input: BootstrapInput, options?: { branch?: string }): ThreadSummary | undefined {
  if (!input.repo) return undefined;

  const requestedThread = input.thread || input.task.match(/dst-\d{4,8}-\w+/)?.[0];
  if (requestedThread) {
    return getThreadById(input.repo, requestedThread);
  }

  if (isGenericResumeTask(input.task)) {
    return listRecentThreads(input.repo, 1)[0];
  }

  return findBestThread(input.repo, input.task, {
    branch: options?.branch || getCurrentBranch(input.repo),
  });
}

// ── 轻量启动（<100ms，只读 thread + 一句 next action） ──

export interface QuickResume {
  task: string;
  /** 主 thread（最近的或指定的） */
  activeThread?: {
    id: string;
    repo: string;
    task: string;
    status: string;
    nextSteps: string[];
    decisions: string[];
  };
  /** 其他可恢复的 thread */
  otherThreads: { id: string; repo: string; task: string; status: string }[];
}

function extractThreadSection(content: string, header: string): string[] {
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.startsWith(`## ${header}`));
  if (idx < 0) return [];
  const items: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) items.push(line.slice(2).replace(/^\[\s*[xX ]?\]\s*/, ''));
  }
  return items;
}

export function loadThreadDetails(t: ThreadSummary): { nextSteps: string[]; decisions: string[] } {
  try {
    const content = readFileSync(t.path, 'utf-8');
    return {
      nextSteps: extractThreadSection(content, '待续'),
      decisions: extractThreadSection(content, '决策').slice(0, 3),
    };
  } catch {
    return { nextSteps: [], decisions: [] };
  }
}

export function bootstrapQuick(input: BootstrapInput): QuickResume {
  const threads = listRecentThreads(input.repo, 5);

  if (threads.length === 0) {
    return { task: input.task, otherThreads: [] };
  }

  const target = resolveTargetThread(input);
  if (!target) {
    return { task: input.task, otherThreads: [] };
  }

  // 标记已恢复，sce-ls 不再显示
  markThreadResumed(target);

  const details = loadThreadDetails(target);

  return {
    task: input.task,
    activeThread: {
      id: target.id,
      repo: target.repo,
      task: target.task,
      status: target.status || '进行中',
      nextSteps: details.nextSteps,
      decisions: details.decisions,
    },
    otherThreads: threads
      .filter(t => t.id !== target.id)
      .map(t => ({ id: t.id, repo: t.repo, task: t.task, status: t.status || '' })),
  };
}

export function formatQuickResume(qr: QuickResume): string {
  if (!qr.activeThread) {
    return `> **任务**: ${qr.task}\n\n新任务，直接开始。`;
  }

  const t = qr.activeThread;
  const repoName = t.repo.split('/').pop() || t.repo;
  let text = `> **恢复**: ${t.task} (${repoName})\n`;
  text += `> **状态**: ${t.status}\n`;

  if (t.nextSteps.length > 0) {
    text += `\n**待续**:\n`;
    t.nextSteps.forEach(s => text += `- ${s}\n`);
  }

  if (t.decisions.length > 0) {
    text += `\n**关键决策**:\n`;
    t.decisions.forEach(d => text += `- ${d}\n`);
  }

  // 同 repo 有其他 thread
  if (qr.otherThreads.length > 0) {
    text += `\n**同项目其他进度**（说 \`继续 <id>\` 切换）:\n`;
    qr.otherThreads.forEach(o => {
      const oRepo = o.repo.split('/').pop() || o.repo;
      text += `- \`${o.id}\` (${oRepo}): ${o.task}${o.status ? ' — ' + o.status : ''}\n`;
    });
  }

  return text;
}

