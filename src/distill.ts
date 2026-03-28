/**
 * distill.ts — 上下文蒸馏 & checkpoint
 *
 * 单一 pipeline，两个入口：
 * - brain_checkpoint (MCP tool) — AI 自己调用
 * - /distill (planned skill) — 用户手动触发
 *
 * 输出和 bootstrap reader 对齐的 thread frontmatter。
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { findBestThread, getThreadById } from './bootstrap.js';
import { findMatchingBoardItems } from './storage.js';
import { getRealHome } from './env.js';

const SCE_DIR = join(getRealHome(), '.sce');
const THREADS_DIR = join(SCE_DIR, 'threads');

// ── 类型 ──

export interface DistillInput {
  repo: string;
  task: string;
  branch?: string;
  parent?: string;
  decisions: string[];
  changes: string[];
  findings: string[];
  next: string[];
  status: string;
}

export interface DistillHint {
  type: 'recipe_candidate' | 'board_done' | 'next_to_board';
  message: string;
  data?: Record<string, unknown>;
}

export interface SplitThread {
  threadId: string;
  repo: string;
  path: string;
}

export interface DistillResult {
  success: boolean;
  threadId: string;
  path: string;
  parent?: string;
  stats: {
    decisions: number;
    changes: number;
    findings: number;
    next: number;
  };
  relatedBoardItems?: Array<{ project: string; itemId: string; title: string }>;
  hints?: DistillHint[];
  /** 多 repo 拆分时的其他 thread */
  splitThreads?: SplitThread[];
}

// ── ID 生成 ──

function generateThreadId(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `dst-${mm}${dd}-${rand}`;
}

// ── 输入约束 ──

const ENTRY_LIMITS = {
  decisions: 5,
  changes: 8,
  findings: 8,
  next: 8,
} as const;

function sanitizeScalar(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeList(items: string[], limit: number): string[] {
  return items
    .map(item => sanitizeScalar(item).replace(/^[-*]\s+/, '').replace(/^\[\s*[xX ]?\]\s+/, ''))
    .filter(Boolean)
    .slice(0, limit);
}

function resolveParent(input: DistillInput): string | undefined {
  if (input.parent) {
    const exact = getThreadById(input.repo, input.parent);
    if (!exact) {
      throw new Error(`指定的 parent thread 不存在: ${input.parent}`);
    }
    return exact.id;
  }

  return findBestThread(input.repo, input.task, {
    branch: input.branch,
    minScore: 4,
  })?.id;
}

// ── Repo 自动检测 ──

/** 从 change 条目提取文件路径：`src/foo.ts — 描述` → `src/foo.ts` */
function extractFilePath(change: string): string | undefined {
  // 取 — / – / - 前的部分（优先全角破折号）
  const sep = change.match(/\s[—–]\s/);
  const pathPart = sep ? change.slice(0, sep.index!).trim() : change.trim();
  // 看起来像文件路径：含 . 或 /
  if (/[./]/.test(pathPart) && !/\s{2,}/.test(pathPart)) return pathPart;
  return undefined;
}

const _gitRootCache = new Map<string, string | null>();

/** 获取路径所属的 git repo root，带缓存 */
function gitRepoRoot(filePath: string): string | null {
  const dir = existsSync(filePath)
    ? (filePath.includes('.') ? dirname(filePath) : filePath)
    : dirname(filePath);
  if (_gitRootCache.has(dir)) return _gitRootCache.get(dir)!;
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: dir, encoding: 'utf-8', timeout: 3000,
    }).trim();
    _gitRootCache.set(dir, root);
    return root;
  } catch {
    _gitRootCache.set(dir, null);
    return null;
  }
}

/** 将 change 的文件路径解析为绝对路径，尝试 fallbackRepo 和 cwd */
function resolveAbsPath(relPath: string, fallbackRepo: string): string | null {
  if (relPath.startsWith('/')) return relPath;
  // 尝试 fallbackRepo
  const fromRepo = resolve(fallbackRepo, relPath);
  if (existsSync(fromRepo)) return fromRepo;
  // 尝试 cwd
  const fromCwd = resolve(process.cwd(), relPath);
  if (existsSync(fromCwd)) return fromCwd;
  // 都找不到，用 fallbackRepo 路径（至少 git rev-parse 可能能工作）
  return fromRepo;
}

/**
 * 检测 changes 中涉及的 repo，返回 Map<repoRoot, changeEntries>
 * 无法检测的 change 归入 fallbackRepo
 */
function detectReposFromChanges(
  changes: string[],
  fallbackRepo: string,
): Map<string, string[]> {
  const repoMap = new Map<string, string[]>();

  for (const change of changes) {
    const filePath = extractFilePath(change);
    let repo = fallbackRepo;

    if (filePath) {
      const absPath = resolveAbsPath(filePath, fallbackRepo);
      if (absPath) {
        const root = gitRepoRoot(absPath);
        if (root) repo = root;
      }
    }

    if (!repoMap.has(repo)) repoMap.set(repo, []);
    repoMap.get(repo)!.push(change);
  }

  return repoMap;
}

// ── 核心 pipeline ──

/** 写入单个 thread 文件，返回 { threadId, path } */
function writeThread(opts: {
  repo: string;
  task: string;
  branch?: string;
  parent?: string;
  created: string;
  decisions: string[];
  changes: string[];
  findings: string[];
  next: string[];
  status: string;
}): { threadId: string; path: string } {
  const threadId = generateThreadId();

  const frontmatter = [
    '---',
    `id: ${threadId}`,
    `repo: ${opts.repo}`,
    `task: ${opts.task}`,
    opts.branch ? `branch: ${opts.branch}` : null,
    opts.parent ? `parent: ${opts.parent}` : null,
    `created: ${opts.created}`,
    `ttl: 7d`,
    '---',
  ].filter(Boolean).join('\n');

  const sections: string[] = [];

  if (opts.decisions.length > 0) {
    sections.push('## 决策\n');
    opts.decisions.forEach(d => sections.push(`- ${d}`));
    sections.push('');
  }
  if (opts.changes.length > 0) {
    sections.push('## 变更\n');
    opts.changes.forEach(c => sections.push(`- ${c}`));
    sections.push('');
  }
  if (opts.findings.length > 0) {
    sections.push('## 发现\n');
    opts.findings.forEach(f => sections.push(`- ${f}`));
    sections.push('');
  }
  if (opts.next.length > 0) {
    sections.push('## 待续\n');
    opts.next.forEach(n => sections.push(`- [ ] ${n}`));
    sections.push('');
  }
  sections.push('## 当前状态\n');
  sections.push(opts.status);

  const content = frontmatter + '\n\n' + sections.join('\n') + '\n';
  const filePath = join(THREADS_DIR, `${threadId}.md`);
  writeFileSync(filePath, content, 'utf-8');

  return { threadId, path: filePath };
}

export function checkpoint(input: DistillInput): DistillResult {
  if (!existsSync(THREADS_DIR)) {
    mkdirSync(THREADS_DIR, { recursive: true });
  }

  const parent = resolveParent(input);
  const created = new Date().toISOString();
  const task = sanitizeScalar(input.task);
  const branch = input.branch ? sanitizeScalar(input.branch) : undefined;
  const status = sanitizeScalar(input.status || '进行中');
  const decisions = sanitizeList(input.decisions || [], ENTRY_LIMITS.decisions);
  const changes = sanitizeList(input.changes || [], ENTRY_LIMITS.changes);
  const findings = sanitizeList(input.findings || [], ENTRY_LIMITS.findings);
  const next = sanitizeList(input.next || [], ENTRY_LIMITS.next);

  const fallbackRepo = sanitizeScalar(input.repo);

  // 自动检测 changes 中涉及的 repo
  const repoMap = changes.length > 0
    ? detectReposFromChanges(changes, fallbackRepo)
    : new Map([[fallbackRepo, changes]]);

  const repos = [...repoMap.keys()];

  // 单 repo：直接写（可能修正了 repo 字段）
  if (repos.length <= 1) {
    const actualRepo = repos[0] || fallbackRepo;
    const { threadId, path: filePath } = writeThread({
      repo: actualRepo, task, branch, parent, created,
      decisions, changes, findings, next, status,
    });

    const relatedBoardItems = findMatchingBoardItems(task);
    const hints = detectHints({ status, findings, next, decisions }, relatedBoardItems);

    return {
      success: true, threadId, path: filePath, parent,
      stats: { decisions: decisions.length, changes: changes.length, findings: findings.length, next: next.length },
      relatedBoardItems: relatedBoardItems.length > 0 ? relatedBoardItems : undefined,
      hints: hints.length > 0 ? hints : undefined,
    };
  }

  // 多 repo：拆分，每个 repo 一个 thread，共享 decisions/findings/next
  const splitThreads: SplitThread[] = [];
  let primaryResult: { threadId: string; path: string } | undefined;

  for (const [repo, repoChanges] of repoMap) {
    const isPrimary = repo === fallbackRepo || !primaryResult;
    const result = writeThread({
      repo, task, branch: isPrimary ? branch : undefined,
      parent: isPrimary ? parent : undefined,
      created, decisions, changes: repoChanges,
      findings, next, status,
    });

    if (isPrimary) {
      primaryResult = result;
    } else {
      splitThreads.push({ threadId: result.threadId, repo, path: result.path });
    }
  }

  const primary = primaryResult!;
  const relatedBoardItems = findMatchingBoardItems(task);
  const hints = detectHints({ status, findings, next, decisions }, relatedBoardItems);

  return {
    success: true,
    threadId: primary.threadId,
    path: primary.path,
    parent,
    stats: { decisions: decisions.length, changes: changes.length, findings: findings.length, next: next.length },
    relatedBoardItems: relatedBoardItems.length > 0 ? relatedBoardItems : undefined,
    hints: hints.length > 0 ? hints : undefined,
    splitThreads: splitThreads.length > 0 ? splitThreads : undefined,
  };
}

// ── 后处理提示检测 ──

const RECIPE_KEYWORDS = /坑|gotcha|fix|踩|注意|关键|trick|workaround|解决|方案|原来|发现/i;
const DONE_KEYWORDS = /完成|done|搞定|finished|已实现|shipped|merged/i;

function detectHints(
  ctx: { status: string; findings: string[]; next: string[]; decisions: string[] },
  boardItems: Array<{ project: string; itemId: string; title: string }>,
): DistillHint[] {
  const hints: DistillHint[] = [];

  // 1. Recipe 提炼提示：findings 中有可复用模式
  const recipeFindings = ctx.findings.filter(f => RECIPE_KEYWORDS.test(f));
  if (recipeFindings.length >= 2) {
    hints.push({
      type: 'recipe_candidate',
      message: `检测到 ${recipeFindings.length} 条可复用发现，建议存为 recipe`,
      data: { findings: recipeFindings },
    });
  }

  // 2. Board 联动：状态为完成 + 有关联 board item
  if (DONE_KEYWORDS.test(ctx.status) && boardItems.length > 0) {
    const items = boardItems.map(i => `[${i.project}] ${i.title}`);
    hints.push({
      type: 'board_done',
      message: `任务已完成，关联看板项可标记 done: ${items.join(', ')}`,
      data: { items: boardItems },
    });
  }

  // 3. Next → Board：有待续事项，建议加入看板
  if (ctx.next.length >= 2) {
    hints.push({
      type: 'next_to_board',
      message: `${ctx.next.length} 项待续，建议加入看板跟踪`,
      data: { next: ctx.next },
    });
  }

  return hints;
}

// ── 格式化回执 ──

export function formatDistillReceipt(result: DistillResult): string {
  const { threadId, parent, stats } = result;
  let text = `已蒸馏 — ${stats.decisions}决策 ${stats.changes}变更 ${stats.findings}发现 ${stats.next}待续`;
  if (parent) {
    text += ` (链接: ${parent})`;
  }

  // 多 repo 拆分信息
  if (result.splitThreads && result.splitThreads.length > 0) {
    text += '\n\n**多 repo 拆分**:';
    for (const st of result.splitThreads) {
      const repoName = st.repo.split('/').pop() || st.repo;
      text += `\n- \`${st.threadId}\` → ${repoName}`;
    }
  }

  if (result.relatedBoardItems && result.relatedBoardItems.length > 0) {
    const items = result.relatedBoardItems.map(i => `[${i.project}] ${i.title}`).join(', ');
    text += `\n**关联看板**: ${items}`;
  }

  // 显示后处理提示
  if (result.hints && result.hints.length > 0) {
    text += '\n\n---\n**建议**';
    const HINT_ICONS: Record<string, string> = { recipe_candidate: '[recipe]', board_done: '[done]', next_to_board: '[board]' };
    for (const hint of result.hints) {
      text += `\n${HINT_ICONS[hint.type] || '•'} ${hint.message}`;
    }
  }

  text += `\n\n**恢复口令: \`${threadId}\`**`;
  return text;
}
