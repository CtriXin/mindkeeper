import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { listThreadHistory, type ThreadSummary } from './bootstrap.js';

export const SESSION_INDEX_REL_PATH = '.ai/SESSION_INDEX.md';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocalTimestamp(ms: number): string {
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    `${sign}${hh}:${mm}`,
  ].join(' ');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

function renderThreadRow(thread: ThreadSummary): string {
  const time = escapeCell(formatLocalTimestamp(thread.createdAtMs));
  const cli = escapeCell(thread.cli || '-');
  const model = escapeCell(thread.model || '-');
  const folder = thread.folder ? `\`${escapeCell(thread.folder)}\`` : '`.`';
  const task = escapeCell(thread.task || '-');
  const status = escapeCell(thread.status || '-');
  const threadId = `\`${escapeCell(thread.id)}\``;
  return `| ${time} | ${cli} | ${model} | ${folder} | ${task} | ${status} | ${threadId} |`;
}

function renderSessionIndex(repo: string, threads: ThreadSummary[]): string {
  const repoName = repo.split('/').filter(Boolean).pop() || repo;
  const lines: string[] = [
    `# Session Index — ${repoName}`,
    '',
    '> MindKeeper 自动维护，按时间倒序记录最近 thread。',
    '> 恢复：`mk dst resume <thread-id>` 或 `/cr <thread-id>`',
    '',
    '| Time | CLI | Model | Folder | Task | Status | Thread |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  if (threads.length === 0) {
    lines.push('| - | - | - | - | 暂无 thread | - | - |');
  } else {
    threads.forEach(thread => lines.push(renderThreadRow(thread)));
  }

  lines.push('');
  return lines.join('\n');
}

export function syncProjectSessionIndex(
  repo: string,
  threads: ThreadSummary[] = listThreadHistory(repo, 200),
): { path?: string; count: number } {
  const requestedRepo = resolve(repo);
  const repoPath = existsSync(requestedRepo) ? realpathSync(requestedRepo) : requestedRepo;
  if (!existsSync(repoPath)) {
    return { count: 0 };
  }

  const aiDir = join(repoPath, '.ai');
  if (!existsSync(aiDir)) {
    mkdirSync(aiDir, { recursive: true });
  }

  const filePath = join(repoPath, SESSION_INDEX_REL_PATH);
  writeFileSync(filePath, renderSessionIndex(repoPath, threads), 'utf-8');
  return { path: filePath, count: threads.length };
}
