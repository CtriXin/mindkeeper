/**
 * brain_search — 全文搜索 thread / fragment / recipe
 *
 * 零依赖实现：基于关键词匹配 + 评分排序，不用 SQLite/FTS5。
 * 搜索范围：threads（~/.sce/threads/）、fragments（~/.sce/fragments/）、recipes（index.json）。
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { extractKeywords } from './utils.js';
import { getRealHome } from './env.js';
import { loadIndex } from './storage.js';
import type { FragmentRecord } from './types.js';
import { loadFragments } from './fragments.js';

const SCE_DIR = join(getRealHome(), '.sce');
const THREADS_DIR = join(SCE_DIR, 'threads');
const FRAGMENTS_DIR = join(SCE_DIR, 'fragments');

// ── 轻量 frontmatter 解析（不依赖 bootstrap.ts） ──

function parseThreadMeta(content: string): Record<string, string> {
  const meta: Record<string, string> = {};
  if (!content.startsWith('---')) return meta;
  const end = content.indexOf('---', 3);
  if (end < 0) return meta;
  const block = content.slice(3, end);
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return meta;
}

// ── 类型 ──

export interface SearchResult {
  type: 'thread' | 'fragment' | 'recipe';
  id: string;
  score: number;
  summary: string;
  /** 命中的关键词 */
  matched: string[];
  /** 额外元数据 */
  meta: Record<string, string>;
}

// ── 评分 ──

function scoreTextAgainstKeywords(text: string, keywords: string[]): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  for (const kw of keywords) {
    const kl = kw.toLowerCase();
    const count = (lower.split(kl).length - 1);
    if (count > 0) {
      matched.push(kw);
      // 完全匹配 > 部分匹配
      score += kl.length * count * 2;
    }
  }

  return { score, matched };
}

function scoreWithFieldBoost(
  fields: { text: string; weight: number }[],
  keywords: string[],
): { score: number; matched: string[] } {
  let totalScore = 0;
  const matchedSet = new Set<string>();

  for (const field of fields) {
    const { score, matched } = scoreTextAgainstKeywords(field.text, keywords);
    if (score > 0) {
      totalScore += score * field.weight;
      matched.forEach(k => matchedSet.add(k));
    }
  }

  return { score: totalScore, matched: [...matchedSet] };
}

// ── 搜索 Threads ──

function searchThreads(query: string, repo?: string, limit: number = 10): SearchResult[] {
  if (!existsSync(THREADS_DIR)) return [];

  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const results: SearchResult[] = [];

  try {
    const files = readdirSync(THREADS_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = join(THREADS_DIR, file);
      const content = readFileSync(filePath, 'utf-8');
      const meta = parseThreadMeta(content);

      if (repo && meta.repo && meta.repo !== repo) continue;

      const searchText = [
        meta.task || '',
        meta.branch || '',
        content.split('---').slice(2).join(''), // frontmatter 之后的内容
      ].join(' ');

      const { score, matched } = scoreWithFieldBoost([
        { text: meta.task || '', weight: 5 },
        { text: meta.branch || '', weight: 2 },
        { text: content, weight: 1 },
      ], keywords);

      if (score <= 0) continue;

      const threadId = meta.id || basename(file, '.md');
      const statusMatch = content.match(/##\s*当前状态\s*\n([^\n]+)/);

      results.push({
        type: 'thread',
        id: threadId,
        score,
        summary: meta.task || file,
        matched,
        meta: {
          repo: meta.repo || '',
          branch: meta.branch || '',
          created: meta.created || '',
          status: statusMatch?.[1]?.trim() || '',
        },
      });
    }
  } catch { /* ignore */ }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── 搜索 Fragments ──

function searchFragments(query: string, repo?: string, limit: number = 10): SearchResult[] {
  if (!existsSync(FRAGMENTS_DIR)) return [];

  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const results: SearchResult[] = [];

  try {
    const files = readdirSync(FRAGMENTS_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = join(FRAGMENTS_DIR, file);
      const content = readFileSync(filePath, 'utf-8');

      for (const line of content.split('\n').filter(Boolean)) {
        let frag: FragmentRecord;
        try {
          frag = JSON.parse(line) as FragmentRecord;
        } catch { continue; }

        if (repo && frag.repo !== repo) continue;

        const { score, matched } = scoreWithFieldBoost([
          { text: frag.summary, weight: 5 },
          { text: frag.task, weight: 3 },
          { text: [...frag.decisions, ...frag.findings].join(' '), weight: 2 },
          { text: frag.changes.join(' '), weight: 1 },
        ], keywords);

        if (score <= 0) continue;

        results.push({
          type: 'fragment',
          id: frag.id,
          score,
          summary: frag.summary,
          matched,
          meta: {
            repo: frag.repo,
            thread: frag.threadId,
            kind: frag.kind,
            created: frag.created,
            branch: frag.branch || '',
          },
        });
      }
    }
  } catch { /* ignore */ }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── 搜索 Recipes (复用现有 searchRecipes，但返回 SearchResult 格式) ──

function searchRecipes(query: string, limit: number = 5): SearchResult[] {
  const index = loadIndex();
  if (index.recipes.length === 0) return [];

  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const results: SearchResult[] = [];

  for (const recipe of index.recipes) {
    const searchText = [
      recipe.summary,
      recipe.triggers.join(' '),
      recipe.project || '',
      recipe.framework || '',
      ...(recipe.tags || []),
    ].join(' ');

    const { score, matched } = scoreWithFieldBoost([
      { text: recipe.summary, weight: 5 },
      { text: recipe.triggers.join(' '), weight: 4 },
      { text: [recipe.project, recipe.framework, ...(recipe.tags || [])].join(' '), weight: 2 },
    ], keywords);

    if (score <= 0) continue;

    results.push({
      type: 'recipe',
      id: recipe.id,
      score,
      summary: recipe.summary,
      matched,
      meta: {
        triggers: recipe.triggers.slice(0, 3).join(', '),
        project: recipe.project || '-',
        framework: recipe.framework || '-',
        created: recipe.created.slice(0, 10),
      },
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── 主搜索入口 ──

export interface SearchOptions {
  types?: ('thread' | 'fragment' | 'recipe')[];
  repo?: string;
  limit?: number;
}

export function searchAll(query: string, options: SearchOptions = {}): SearchResult[] {
  const types = options.types || ['thread', 'fragment', 'recipe'];
  const limit = options.limit || 10;
  const all: SearchResult[] = [];

  if (types.includes('thread')) {
    all.push(...searchThreads(query, options.repo, Math.ceil(limit * 0.5)));
  }
  if (types.includes('fragment')) {
    all.push(...searchFragments(query, options.repo, Math.ceil(limit * 0.5)));
  }
  if (types.includes('recipe')) {
    all.push(...searchRecipes(query, Math.ceil(limit * 0.3)));
  }

  return all.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return '未找到匹配结果。';

  const grouped = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!grouped.has(r.type)) grouped.set(r.type, []);
    grouped.get(r.type)!.push(r);
  }

  const typeLabels: Record<string, string> = {
    thread: '🧵 Thread',
    fragment: '📝 Fragment',
    recipe: '📋 Recipe',
  };

  const lines: string[] = [];
  lines.push(`找到 ${results.length} 条结果:\n`);

  for (const [type, items] of grouped) {
    lines.push(`### ${typeLabels[type] || type} (${items.length})`);
    for (const item of items) {
      const metaParts = Object.entries(item.meta)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .slice(0, 4);

      const metaStr = metaParts.length > 0 ? ` [${metaParts.join(', ')}]` : '';
      const matchedStr = item.matched.length > 0 ? ` ← ${item.matched.slice(0, 3).join(', ')}` : '';

      lines.push(`- **\`${item.id}\`** ${item.summary}${metaStr}${matchedStr}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
