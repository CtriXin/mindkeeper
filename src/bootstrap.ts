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

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { loadIndex } from './storage.js';
import { search } from './router.js';
import { listProcedures } from './procedure.js';
import { getRealHome } from './env.js';

const SCE_DIR = join(getRealHome(), '.sce');

// ── 类型 ──

export type TaskType = 'bugfix' | 'refactor' | 'feature' | 'doc' | 'setup' | 'unknown';

export interface GitContext {
  branch: string;
  uncommittedFiles: string[];
  recentCommits: string[];
  hasUncommitted: boolean;
}

export interface FileRecommendation {
  path: string;
  reason: string;
}

export interface WorkingSet {
  task: string;
  taskType: TaskType;
  git: GitContext;
  policies: string[];
  risks: string[];
  continuity: string[];
  procedures: string[];
  files: FileRecommendation[];
  knowledge: string[];
  nextAction: string;
}

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

function readGitContext(repo: string): GitContext {
  const branch = getCurrentBranch(repo);

  // uncommitted files (staged + unstaged + untracked)
  const statusRaw = git('status --porcelain', repo);
  const uncommittedFiles = statusRaw
    ? statusRaw.split('\n').map(l => l.slice(3).trim()).filter(Boolean).slice(0, 15)
    : [];

  // recent commits (last 5)
  const logRaw = git('log --oneline -5 --no-decorate', repo);
  const recentCommits = logRaw ? logRaw.split('\n').filter(Boolean) : [];

  return {
    branch,
    uncommittedFiles,
    recentCommits,
    hasUncommitted: uncommittedFiles.length > 0,
  };
}

function getCurrentBranch(repo: string): string {
  return git('branch --show-current', repo) || git('rev-parse --short HEAD', repo) || 'unknown';
}

// ── 任务分类 ──

export function classifyTask(task: string): TaskType {
  const t = task.toLowerCase();
  if (/fix|bug|修|报错|crash|error|broken|坏了|不对|问题/.test(t)) return 'bugfix';
  if (/refactor|重构|rename|拆分|cleanup|整理/.test(t)) return 'refactor';
  if (/doc|文档|readme|注释|comment|说明/.test(t)) return 'doc';
  if (/setup|init|install|配置|集成|deploy|ci|cd/.test(t)) return 'setup';
  if (/add|feat|新增|实现|implement|支持/.test(t)) return 'feature';
  return 'unknown';
}

// ── 项目规则 ──

function readFileIfExists(path: string, maxLines: number = 50): string {
  if (!existsSync(path)) return '';
  try {
    const content = readFileSync(path, 'utf-8');
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch {
    return '';
  }
}

function extractRules(content: string): string[] {
  const rules: string[] = [];
  const rulePattern = /^-\s+(?:\*\*)?(?:不要|禁止|不能|NEVER|不准|ALWAYS|必须)/i;
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (rulePattern.test(trimmed) && trimmed.length > 10 && trimmed.length < 150) {
      rules.push(trimmed.replace(/^-\s+/, '').replace(/\*\*/g, ''));
    }
  });
  return rules;
}

function loadProjectPolicies(repo?: string): string[] {
  if (!repo) return [];

  const rules: string[] = [];
  const candidates = [
    'CLAUDE.md', 'AGENT.md', 'AGENTS.md',
    '.claude/settings.json',  // 不读内容，只检测存在
  ];

  for (const rel of candidates) {
    const full = join(repo, rel);
    if (existsSync(full) && !rel.endsWith('.json')) {
      rules.push(...extractRules(readFileIfExists(full)));
    }
  }

  // 也读 ~/.sce/policies/
  const policiesDir = join(SCE_DIR, 'policies');
  if (existsSync(policiesDir)) {
    readdirSync(policiesDir).filter(f => f.endsWith('.md')).forEach(f => {
      rules.push(...extractRules(readFileIfExists(join(policiesDir, f))));
    });
  }

  return [...new Set(rules)].slice(0, 8);
}

// ── 风险推断 ──

function inferRisks(taskType: TaskType, gitCtx: GitContext, repo?: string): string[] {
  const risks: string[] = [];

  // uncommitted changes 冲突风险
  if (gitCtx.hasUncommitted) {
    risks.push(`有 ${gitCtx.uncommittedFiles.length} 个未提交文件 — 先确认是否和当前任务冲突`);
  }

  // 按任务类型
  if (taskType === 'bugfix') {
    risks.push('先复现 bug，确认修复后不引入新问题');
  }
  if (taskType === 'refactor') {
    risks.push('重构前确认有测试覆盖，避免静默破坏');
  }

  // 检查 uncommitted 中是否有敏感文件
  const sensitivePatterns = /core|bridge|auth|config|\.env|secret|migration/i;
  gitCtx.uncommittedFiles.forEach(f => {
    if (sensitivePatterns.test(f)) {
      risks.push(`${f} 在未提交列表中且是敏感文件`);
    }
  });

  return [...new Set(risks)].slice(0, 5);
}

// ── 检测项目规则文件 ──

const RULE_FILE_CANDIDATES = ['AGENT.md', 'AGENTS.md', 'CLAUDE.md'];

function detectRuleFile(repo: string): string | null {
  for (const f of RULE_FILE_CANDIDATES) {
    if (existsSync(join(repo, f))) return f;
  }
  return null;
}

// ── 精准文件推荐（最多 3 个，带理由） ──

function recommendFiles(task: string, taskType: TaskType, gitCtx: GitContext, repo?: string): FileRecommendation[] {
  const recs: FileRecommendation[] = [];

  // 1. 规则文件（如果任务涉及核心改动）
  if (repo && taskType !== 'doc') {
    const ruleFile = detectRuleFile(repo);
    if (ruleFile) {
      recs.push({ path: ruleFile, reason: '了解项目约束和受保护文件' });
    }
  }

  // 2. 从 uncommitted files 中找和任务最相关的
  const taskKeywords = task.toLowerCase().split(/[\s,/\\.-]+/).filter(w => w.length > 2);
  const scored = gitCtx.uncommittedFiles
    .map(f => {
      const name = f.toLowerCase();
      const score = taskKeywords.filter(kw => name.includes(kw)).length;
      return { path: f, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    recs.push({ path: scored[0].path, reason: '文件名和任务关键词匹配，且有未提交改动' });
  }

  // 3. 从最近 commit 推断热点文件
  if (repo) {
    const diffFiles = git('diff --name-only HEAD~3 HEAD 2>/dev/null', repo);
    if (diffFiles) {
      const hotFiles = diffFiles.split('\n').filter(Boolean);
      // 找和任务最相关的
      const hotScored = hotFiles
        .map(f => {
          const name = f.toLowerCase();
          const score = taskKeywords.filter(kw => name.includes(kw)).length;
          return { path: f, score };
        })
        .sort((a, b) => b.score - a.score);

      if (hotScored.length > 0 && hotScored[0].score > 0) {
        const f = hotScored[0].path;
        if (!recs.find(r => r.path === f)) {
          recs.push({ path: f, reason: '最近 commit 中被频繁修改，和任务关键词匹配' });
        }
      }
    }
  }

  // 4. 如果还不够 3 个，根据任务类型补充
  if (recs.length < 3 && repo) {
    const typeFiles: Record<TaskType, string[]> = {
      bugfix: ['src/server.ts', 'src/index.ts', 'src/main.ts'],
      refactor: ['src/types.ts', 'tsconfig.json'],
      feature: ['src/types.ts', 'package.json'],
      doc: ['README.md', 'docs/'],
      setup: ['package.json', 'tsconfig.json', '.env.example'],
      unknown: [],
    };
    for (const f of typeFiles[taskType] || []) {
      if (recs.length >= 3) break;
      if (existsSync(join(repo, f)) && !recs.find(r => r.path === f)) {
        recs.push({ path: f, reason: `${taskType} 类型任务的常用入口` });
      }
    }
  }

  return recs.slice(0, 3);
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

function parseThreadFile(path: string, now: number): (ThreadSummary & { expired: boolean }) | undefined {
  try {
    const content = readFileSync(path, 'utf-8');
    const mtime = statSync(path).mtime.getTime();
    const meta = parseThreadFrontmatter(content);
    const createdAtMs = resolveThreadCreatedAt(meta, mtime);
    const ttlMs = parseTtl(meta.ttl || '7d');

    return {
      id: meta.id || basename(path, '.md'),
      repo: meta.repo || '',
      task: meta.task || basename(path, '.md'),
      status: extractThreadStatus(content),
      path,
      createdAtMs,
      branch: meta.branch,
      parent: meta.parent,
      ttl: meta.ttl,
      resumed: meta.resumed,
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

function normalizeTaskText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractTaskKeywords(text: string): string[] {
  const matches = normalizeTaskText(text).match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set(matches.filter(token => token.length >= 2))];
}

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

  const aKeywords = extractTaskKeywords(a);
  const bKeywords = extractTaskKeywords(b);
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
  if (exact && exact.repo === repo) {
    const { expired: _expired, ...thread } = exact;
    return thread;
  }

  try {
    for (const file of readdirSync(threadsDir)) {
      if (!file.endsWith('.md') || file === `${threadId}.md`) continue;
      const parsed = parseThreadFile(join(threadsDir, file), now);
      if (parsed && parsed.id === threadId && parsed.repo === repo) {
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

  const requestedThread = input.thread || input.task.match(/dst-\d{8}-\w+/)?.[0];
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

// ── 连续性恢复（TODO, plan, thread） ──

function loadContinuity(repo?: string): string[] {
  const items: string[] = [];

  // 1. 项目 TODO.md
  if (repo) {
    for (const rel of ['TODO.md', '.ai/plan/TODO.md', '.ai/plan/current.md']) {
      const path = join(repo, rel);
      if (existsSync(path)) {
        const content = readFileIfExists(path, 20);
        // 提取未完成的 TODO 项
        const todos = content.split('\n')
          .filter(l => /^\s*-\s*\[\s*\]/.test(l))
          .slice(0, 3)
          .map(l => l.trim());
        if (todos.length > 0) {
          items.push(`📋 ${rel} 中有 ${todos.length} 项待办:`);
          todos.forEach(t => items.push(`  ${t}`));
        }
        break; // 只读第一个找到的
      }
    }
  }

  const threads = listRecentThreads(repo, 2);
  if (threads.length > 0) {
    items.push('🧵 最近的 thread:');
    threads.forEach(t => {
      items.push(`  ${t.id}: ${t.task}${t.status ? ' — ' + t.status : ''}`.slice(0, 80));
    });
  }

  // 3. .ai/plan/progress.md 或 findings.md
  if (repo) {
    for (const rel of ['.ai/plan/progress.md', 'progress.md', 'findings.md']) {
      const path = join(repo, rel);
      if (existsSync(path)) {
        const stat = statSync(path);
        const ageHours = (Date.now() - stat.mtime.getTime()) / 3600000;
        if (ageHours < 48) {
          const summary = readFileIfExists(path, 5).split('\n').filter(l => l.trim()).slice(0, 2).join(' ');
          items.push(`📝 ${rel} (${Math.round(ageHours)}h 前更新): ${summary.slice(0, 80)}`);
        }
        break;
      }
    }
  }

  return items;
}

// ── Procedure 筛选 ──

function recommendProcedures(taskType: TaskType, task: string): string[] {
  const allProcs = listProcedures();
  if (allProcs.length === 0) return [];

  const taskLower = task.toLowerCase();

  // 按任务类型和关键词匹配
  const scored = allProcs.map(p => {
    let score = 0;
    const triggers = Array.isArray(p.trigger) ? p.trigger : [p.trigger];
    // 触发词匹配
    triggers.forEach(t => {
      if (t && taskLower.includes(t.toLowerCase())) score += 3;
    });
    // 标签匹配
    if (p.tags) {
      if (p.tags.includes(taskType)) score += 2;
      if (p.tags.includes('core')) score += 1;
    }
    return { name: p.name, description: p.description || '', score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  return scored.slice(0, 2).map(p => `${p.name}: ${p.description}`);
}

// ── 生成 next action ──

function generateNextAction(taskType: TaskType, task: string, gitCtx: GitContext, continuity: string[], risks: string[], repo?: string): string {
  // 最高优先：有大量未提交改动，且和当前任务无关时才建议 stash
  if (gitCtx.hasUncommitted && gitCtx.uncommittedFiles.length > 5) {
    const taskKeywords = task.toLowerCase().split(/[\s,/\\.-]+/).filter(w => w.length > 2);
    const relatedCount = gitCtx.uncommittedFiles.filter(f =>
      taskKeywords.some(kw => f.toLowerCase().includes(kw))
    ).length;
    // 超过半数文件和任务无关，才建议整理
    if (relatedCount < gitCtx.uncommittedFiles.length / 2) {
      return `有 ${gitCtx.uncommittedFiles.length} 个未提交文件且多数和当前任务无关，建议先 commit 或 stash 无关改动`;
    }
  }

  // 有连续性信息 → 恢复
  if (continuity.some(c => c.startsWith('📋'))) {
    return '先检查项目 TODO 中的待办项，确认当前任务是否在列表中，避免重复工作';
  }
  if (continuity.some(c => c.startsWith('🧵'))) {
    return '先回顾最近的 thread，看是否有未完成的相关工作可以衔接';
  }

  // 按任务类型
  switch (taskType) {
    case 'bugfix':
      return '先复现问题，确认 error message 和触发路径，再定位代码';
    case 'refactor':
      return '先确认有测试覆盖目标代码，然后小步重构、每步验证';
    case 'feature':
      return '先读相关模块的现有实现，理解数据流和接口，再动手';
    case 'doc':
      return '先检查现有文档的准确性，再补充新内容';
    case 'setup':
      return '先检查依赖版本和环境要求，避免兼容性问题';
    default: {
      const ruleFile = repo ? detectRuleFile(repo) : null;
      return ruleFile
        ? `先读 ${ruleFile} 了解项目约束，再开始`
        : '先了解项目结构和约束，再开始';
    }
  }
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

function loadThreadDetails(t: ThreadSummary): { nextSteps: string[]; decisions: string[] } {
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

// ── 深度上下文（按需调用，含 git/policies/files/knowledge） ──

export function bootstrap(input: BootstrapInput): WorkingSet {
  const repo = input.repo;
  const taskType = classifyTask(input.task);

  // Git 上下文
  const gitCtx = repo ? readGitContext(repo) : {
    branch: 'unknown', uncommittedFiles: [], recentCommits: [], hasUncommitted: false,
  };
  const targetThread = resolveTargetThread(input, { branch: gitCtx.branch });

  // 项目规则
  const policies = loadProjectPolicies(repo);

  // 风险
  const risks = inferRisks(taskType, gitCtx, repo);

  // 连续性
  const continuity = loadContinuity(repo);
  if (targetThread) {
    continuity.unshift(`🧵 当前恢复目标: ${targetThread.id}: ${targetThread.task}${targetThread.status ? ' — ' + targetThread.status : ''}`.slice(0, 120));
  }

  // 文件推荐
  const files = recommendFiles(input.task, taskType, gitCtx, repo);

  // 知识检索
  const index = loadIndex();
  const searchResults = search(index, input.task, 3);
  const knowledge = searchResults.map(r => `${r.unit.summary} (${r.score.toFixed(2)})`);

  // Procedure 筛选
  const procedures = recommendProcedures(taskType, input.task);

  // 下一步
  const nextAction = generateNextAction(taskType, input.task, gitCtx, continuity, risks, repo);

  return {
    task: input.task,
    taskType,
    git: gitCtx,
    policies,
    risks,
    continuity,
    procedures,
    files,
    knowledge,
    nextAction,
  };
}

// ── 格式化输出 ──

export function formatWorkingSet(ws: WorkingSet): string {
  const typeLabel: Record<TaskType, string> = {
    bugfix: '🐛 Bug 修复',
    refactor: '🔧 重构',
    feature: '✨ 新功能',
    doc: '📝 文档',
    setup: '⚙️ 配置/集成',
    unknown: '📦 任务',
  };

  let text = `# 🧠 MindKeeper Bootstrap\n\n`;
  text += `> **${typeLabel[ws.taskType]}**: ${ws.task}\n`;
  text += `> **分支**: \`${ws.git.branch}\``;
  if (ws.git.hasUncommitted) {
    text += ` | ${ws.git.uncommittedFiles.length} 个未提交文件`;
  }
  text += `\n\n---\n\n`;

  // 规则
  if (ws.policies.length > 0) {
    text += `## 📋 规则\n\n`;
    ws.policies.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  // 风险
  if (ws.risks.length > 0) {
    text += `## ⚠️ 风险\n\n`;
    ws.risks.forEach(r => text += `- ${r}\n`);
    text += `\n`;
  }

  // 连续性
  if (ws.continuity.length > 0) {
    text += `## 🔄 恢复上下文\n\n`;
    ws.continuity.forEach(c => text += `${c}\n`);
    text += `\n`;
  }

  // 文件推荐
  if (ws.files.length > 0) {
    text += `## 📂 先看这 ${ws.files.length} 个文件\n\n`;
    ws.files.forEach(f => text += `- \`${f.path}\` — ${f.reason}\n`);
    text += `\n`;
  }

  // 相关知识
  if (ws.knowledge.length > 0) {
    text += `## 🔍 相关知识\n\n`;
    ws.knowledge.forEach(k => text += `- ${k}\n`);
    text += `\n`;
  }

  // Procedure
  if (ws.procedures.length > 0) {
    text += `## 📝 推荐 Procedure\n\n`;
    ws.procedures.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  // 最近 commits（简略）
  if (ws.git.recentCommits.length > 0) {
    text += `## 📜 最近提交\n\n`;
    ws.git.recentCommits.slice(0, 3).forEach(c => text += `- ${c}\n`);
    text += `\n`;
  }

  // 下一步
  text += `## 💡 下一步\n\n`;
  text += `**${ws.nextAction}**\n`;

  return text;
}
