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
import { join } from 'path';
import { findBestThread, getThreadById } from './bootstrap.js';
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
}

// ── ID 生成 ──

function generateThreadId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `dst-${date}-${rand}`;
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

// ── 核心 pipeline ──

export function checkpoint(input: DistillInput): DistillResult {
  // 确保目录存在
  if (!existsSync(THREADS_DIR)) {
    mkdirSync(THREADS_DIR, { recursive: true });
  }

  const threadId = generateThreadId();
  const parent = resolveParent(input);
  const created = new Date().toISOString();
  const repo = sanitizeScalar(input.repo);
  const task = sanitizeScalar(input.task);
  const branch = input.branch ? sanitizeScalar(input.branch) : undefined;
  const status = sanitizeScalar(input.status || '进行中');
  const decisions = sanitizeList(input.decisions || [], ENTRY_LIMITS.decisions);
  const changes = sanitizeList(input.changes || [], ENTRY_LIMITS.changes);
  const findings = sanitizeList(input.findings || [], ENTRY_LIMITS.findings);
  const next = sanitizeList(input.next || [], ENTRY_LIMITS.next);

  // 构建 frontmatter — 和 bootstrap parseThreadFrontmatter 对齐
  const frontmatter = [
    '---',
    `id: ${threadId}`,
    `repo: ${repo}`,
    `task: ${task}`,
    branch ? `branch: ${branch}` : null,
    parent ? `parent: ${parent}` : null,
    `created: ${created}`,
    `ttl: 7d`,
    '---',
  ].filter(Boolean).join('\n');

  // 构建内容 — 固定 5 段，和 Codex review 对齐
  const sections: string[] = [];

  if (decisions.length > 0) {
    sections.push('## 决策\n');
    decisions.forEach(d => sections.push(`- ${d}`));
    sections.push('');
  }

  if (changes.length > 0) {
    sections.push('## 变更\n');
    changes.forEach(c => sections.push(`- ${c}`));
    sections.push('');
  }

  if (findings.length > 0) {
    sections.push('## 发现\n');
    findings.forEach(f => sections.push(`- ${f}`));
    sections.push('');
  }

  if (next.length > 0) {
    sections.push('## 待续\n');
    next.forEach(n => sections.push(`- [ ] ${n}`));
    sections.push('');
  }

  sections.push('## 当前状态\n');
  sections.push(status);

  const content = frontmatter + '\n\n' + sections.join('\n') + '\n';

  // 写入
  const filePath = join(THREADS_DIR, `${threadId}.md`);
  writeFileSync(filePath, content, 'utf-8');

  return {
    success: true,
    threadId,
    path: filePath,
    parent,
    stats: {
      decisions: decisions.length,
      changes: changes.length,
      findings: findings.length,
      next: next.length,
    },
  };
}

// ── 格式化回执 ──

export function formatDistillReceipt(result: DistillResult): string {
  const { threadId, parent, stats } = result;
  let text = `💾 **已蒸馏** — \`${threadId}\`\n\n`;
  if (parent) {
    text += `🔗 链接到上一个: \`${parent}\`\n`;
  }
  text += `📊 ${stats.decisions} 条决策 | ${stats.changes} 个文件变更 | ${stats.findings} 个发现 | ${stats.next} 项待续\n\n`;
  text += `\n下次恢复：发送 \`${threadId}\``;
  return text;
}
