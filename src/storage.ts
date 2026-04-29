/**
 * 存储层
 *
 * v2 — Recipe 驱动
 * - brain/index.json: 极简索引（recipes + 旧 units）
 * - brain/recipes/*.md: Recipe 文件（frontmatter + 结构化 markdown）
 * - brain/units/*.md: 旧知识单元（只读，不再新增）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { getRealHome } from './env.js';
import { extractKeywords } from './utils.js';
import type { BrainIndex, Recipe, RecipeMeta, RecipeFile, ChangelogEntry, Unit, UnitMeta, Board, BoardItem, BoardMemo, BoardSignal, QuadrantKey, RecipeStalenessSignal, DigestEntry } from './types.js';
import { QUADRANT_KEYS } from './types.js';

const SCE_DIR = join(getRealHome(), '.sce');
const BRAIN_DIR = join(SCE_DIR, 'brain');
const INDEX_PATH = join(BRAIN_DIR, 'index.json');
const RECIPES_DIR = join(BRAIN_DIR, 'recipes');
const UNITS_DIR = join(BRAIN_DIR, 'units');

// ── 目录 ──

function ensureDirs() {
  if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true });
  if (!existsSync(RECIPES_DIR)) mkdirSync(RECIPES_DIR, { recursive: true });
  if (!existsSync(UNITS_DIR)) mkdirSync(UNITS_DIR, { recursive: true });
}

// ── 索引 ──

export function loadIndex(): BrainIndex {
  ensureDirs();
  if (!existsSync(INDEX_PATH)) {
    const empty: BrainIndex = { version: '2.0', updated: new Date().toISOString(), recipes: [], units: [] };
    writeFileSync(INDEX_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  // v1 → v2 迁移：补 recipes 字段
  if (!raw.recipes) raw.recipes = [];
  return raw;
}

export function saveIndex(index: BrainIndex): void {
  index.updated = new Date().toISOString();
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

// ── Frontmatter 解析/生成 ──

function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, any> = {};
  match[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      let value: any = rest.join(':').trim();
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
      } else if (!isNaN(Number(value)) && value !== '') {
        value = Number(value);
      }
      meta[key.trim()] = value;
    }
  });

  return { meta, body: match[2] };
}

function toFrontmatter(meta: Record<string, any>, body: string): string {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map(s => `"${s}"`).join(', ')}]`;
      return `${k}: ${v}`;
    });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// ── Recipe Markdown 解析 ──

function extractSection(body: string, header: string): string {
  const lines = body.split('\n');
  const idx = lines.findIndex(l => l.trim() === `## ${header}`);
  if (idx < 0) return '';

  const result: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ')) break;
    result.push(lines[i]);
  }
  return result.join('\n').trim();
}

/** 提取段落文本（非列表，用于 insight 的结论/原因/适用场景） */
function extractSectionText(body: string, header: string): string {
  const section = extractSection(body, header);
  if (!section) return '';
  return section.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

function parseListItems(section: string): string[] {
  if (!section) return [];
  return section.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') || /^\d+\.\s/.test(l))
    .map(l => l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''));
}

function parseFileEntries(section: string): RecipeFile[] {
  if (!section) return [];
  return section.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => {
      const text = l.slice(2);
      // 格式: `path` — description 或 path — description
      const m = text.match(/^`?([^`—–-]+?)`?\s*[—–-]\s*(.+)$/);
      if (m) return { path: m[1].trim(), description: m[2].trim() };
      return { path: text, description: '' };
    });
}

function parseChangelog(section: string): ChangelogEntry[] {
  if (!section) return [];
  return section.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => {
      const text = l.slice(2);
      // 格式: 2026-03-27: description
      const m = text.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
      if (m) return { date: m[1], description: m[2] };
      return { date: '', description: text };
    })
    .filter(e => e.date);
}

/** 安全取数组，防止字段类型异常 */
function asArray<T>(val: unknown): T[] {
  return Array.isArray(val) ? val : [];
}

function recipeBodyToMarkdown(recipe: Recipe): string {
  const sections: string[] = [];

  // Insight 专用字段
  if (recipe.conclusion) {
    sections.push('## 结论');
    sections.push(recipe.conclusion);
    sections.push('');
  }
  if (recipe.why) {
    sections.push('## 原因');
    sections.push(recipe.why);
    sections.push('');
  }
  if (recipe.when_to_apply) {
    sections.push('## 适用场景');
    sections.push(recipe.when_to_apply);
    sections.push('');
  }

  const steps = asArray<string>(recipe.steps);
  const files = asArray<RecipeFile>(recipe.files);
  const gotchas = asArray<string>(recipe.gotchas);
  const corrections = asArray<string>(recipe.corrections);
  const changelog = asArray<ChangelogEntry>(recipe.changelog);

  if (steps.length > 0) {
    sections.push('## 实现步骤');
    steps.forEach((s, i) => sections.push(`${i + 1}. ${s}`));
    sections.push('');
  }

  if (files.length > 0) {
    sections.push('## 涉及文件');
    files.forEach(f =>
      sections.push(`- \`${f.path}\` — ${f.description}`)
    );
    sections.push('');
  }

  if (gotchas.length > 0) {
    sections.push('## 已知坑点');
    gotchas.forEach(g => sections.push(`- ${g}`));
    sections.push('');
  }

  if (corrections.length > 0) {
    sections.push('## 用户纠正');
    corrections.forEach(c => sections.push(`- ${c}`));
    sections.push('');
  }

  if (changelog.length > 0) {
    sections.push('## Changelog');
    changelog.forEach(e => sections.push(`- ${e.date}: ${e.description}`));
    sections.push('');
  }

  return sections.join('\n');
}

// ── Recipe CRUD ──

export function loadRecipe(id: string): Recipe | null {
  const path = join(RECIPES_DIR, `${id}.md`);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  return {
    id,
    triggers: meta.triggers || [],
    summary: meta.summary || '',
    repo: meta.repo,
    branch: meta.branch,
    project: meta.project,
    framework: meta.framework,
    created: meta.created || new Date().toISOString(),
    updated: meta.updated || meta.created || new Date().toISOString(),
    lastAccessed: meta.lastAccessed,
    accessCount: meta.accessCount || 0,
    confidence: meta.confidence ?? 0.8,
    tags: meta.tags,
    lastVerified: meta.lastVerified,
    boardItemId: meta.boardItemId,
    related: meta.related,
    type: meta.type || 'recipe',
    steps: parseListItems(extractSection(body, '实现步骤')),
    files: parseFileEntries(extractSection(body, '涉及文件')),
    gotchas: parseListItems(extractSection(body, '已知坑点')),
    corrections: parseListItems(extractSection(body, '用户纠正')),
    changelog: parseChangelog(extractSection(body, 'Changelog')),
    conclusion: extractSectionText(body, '结论') || undefined,
    why: extractSectionText(body, '原因') || undefined,
    when_to_apply: extractSectionText(body, '适用场景') || undefined,
  };
}

export function saveRecipe(recipe: Recipe): void {
  ensureDirs();
  const meta: Record<string, any> = {
    id: recipe.id,
    type: recipe.type || 'recipe',
    triggers: recipe.triggers,
    summary: recipe.summary,
    repo: recipe.repo,
    branch: recipe.branch,
    project: recipe.project,
    framework: recipe.framework,
    created: recipe.created,
    updated: recipe.updated,
    lastAccessed: recipe.lastAccessed,
    accessCount: recipe.accessCount,
    confidence: recipe.confidence,
    tags: recipe.tags,
    lastVerified: recipe.lastVerified,
    boardItemId: recipe.boardItemId,
    related: recipe.related,
  };

  const body = recipeBodyToMarkdown(recipe);
  const path = join(RECIPES_DIR, `${recipe.id}.md`);
  writeFileSync(path, toFrontmatter(meta, body));
}

export function deleteRecipe(id: string): boolean {
  const path = join(RECIPES_DIR, `${id}.md`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function recipeMetaFrom(recipe: Recipe): RecipeMeta {
  return {
    id: recipe.id,
    type: recipe.type || 'recipe',
    triggers: recipe.triggers,
    summary: recipe.summary,
    repo: recipe.repo,
    branch: recipe.branch,
    project: recipe.project,
    framework: recipe.framework,
    created: recipe.created,
    updated: recipe.updated,
    lastAccessed: recipe.lastAccessed,
    accessCount: recipe.accessCount,
    confidence: recipe.confidence,
    tags: recipe.tags,
    lastVerified: recipe.lastVerified,
    boardItemId: recipe.boardItemId,
    related: recipe.related,
  };
}

/** 批量更新访问统计 */
export function touchRecipes(index: BrainIndex, ids: string[]): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  let changed = false;
  for (const id of ids) {
    const meta = index.recipes.find(r => r.id === id);
    if (meta) {
      meta.lastAccessed = now;
      meta.accessCount = (meta.accessCount || 0) + 1;
      changed = true;
    }
  }
  if (changed) saveIndex(index);
}

/** 列出所有 recipe 文件 */
export function listRecipeFiles(): string[] {
  ensureDirs();
  return readdirSync(RECIPES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

// ── 旧 Unit 函数（保留兼容，CLI 用） ──

export function loadUnit(id: string): Unit | null {
  const path = join(UNITS_DIR, `${id}.md`);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  return {
    id,
    triggers: meta.triggers || [],
    summary: meta.summary || '',
    project: meta.project,
    created: meta.created || new Date().toISOString(),
    lastAccessed: meta.lastAccessed,
    accessCount: meta.accessCount || 0,
    confidence: meta.confidence || 0.5,
    content: body.trim(),
    related: meta.related,
    tags: meta.tags,
  };
}

export function saveUnit(unit: Unit): void {
  ensureDirs();
  const { content, ...meta } = unit;
  const path = join(UNITS_DIR, `${unit.id}.md`);
  writeFileSync(path, toFrontmatter(meta, content));
}

export function deleteUnit(id: string): boolean {
  const path = join(UNITS_DIR, `${id}.md`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function metaFromUnit(unit: Unit): UnitMeta {
  const { content, related, ...meta } = unit;
  return meta;
}

export function listUnitFiles(): string[] {
  ensureDirs();
  return readdirSync(UNITS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

// ── Board（项目看板） ──

const BOARDS_DIR = join(SCE_DIR, 'boards');

function ensureBoardsDir() {
  if (!existsSync(BOARDS_DIR)) mkdirSync(BOARDS_DIR, { recursive: true });
}

export function boardPath(projectSlug: string): string {
  return join(BOARDS_DIR, `${projectSlug}.json`);
}

function archiveBoardPath(projectSlug: string): string {
  return join(BOARDS_DIR, `${projectSlug}.archive.json`);
}

function parseBoardJson(raw: string): Board {
  const data = JSON.parse(raw);
  // 确保 quadrants 四个 key 都存在
  const quadrants: Record<QuadrantKey, BoardItem[]> = {
    q1: [], q2: [], q3: [], q4: [],
    ...(data.quadrants || {}),
  };
  return {
    project: data.project || '',
    description: data.description,
    repo: data.repo,
    aliases: data.aliases,
    sub_projects: data.sub_projects,
    last_updated: data.last_updated || new Date().toISOString().slice(0, 10),
    stale_warning_days: data.stale_warning_days || 14,
    quadrants,
    memos: Array.isArray(data.memos) ? data.memos : [],
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** 生成简短 ID */
function generateItemId(): string {
  return Math.random().toString(36).slice(2, 7);
}

/** 列出所有 board 的 project slug */
export function listBoardSlugs(): string[] {
  ensureBoardsDir();
  return readdirSync(BOARDS_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.archive.json'))
    .map(f => f.replace('.json', ''));
}

/** 加载指定项目的 board */
export function loadBoard(projectSlug: string): Board | null {
  const path = boardPath(projectSlug);
  if (!existsSync(path)) return null;
  try {
    return parseBoardJson(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** 保存 board */
export function saveBoard(board: Board): void {
  ensureBoardsDir();
  board.last_updated = new Date().toISOString().slice(0, 10);
  writeFileSync(boardPath(slugify(board.project)), JSON.stringify(board, null, 2), 'utf-8');
}

/** 创建新 board */
export function createBoard(project: string, repo?: string, staleWarningDays?: number): Board {
  ensureBoardsDir();
  const board: Board = {
    project,
    repo,
    last_updated: new Date().toISOString().slice(0, 10),
    stale_warning_days: staleWarningDays || 14,
    quadrants: { q1: [], q2: [], q3: [], q4: [] },
    memos: [],
  };
  saveBoard(board);
  return board;
}

/** 添加条目到 board */
export function addBoardItem(
  projectSlug: string,
  title: string,
  quadrant: QuadrantKey,
  options?: { deadline?: string; assignee?: string; source?: string; source_ref?: string },
): BoardItem | null {
  const board = loadBoard(projectSlug) || createBoard(projectSlug);
  const item: BoardItem = {
    id: generateItemId(),
    title,
    deadline: options?.deadline,
    status: 'active',
    quadrant,
    assignee: options?.assignee,
    created: new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    source: options?.source,
    source_ref: options?.source_ref,
  };
  board.quadrants[quadrant].push(item);
  saveBoard(board);
  return item;
}

/** 更新 board 条目（仅更新提供的字段） */
export function updateBoardItem(
  projectSlug: string,
  itemId: string,
  changes: Partial<Pick<BoardItem, 'title' | 'deadline' | 'status' | 'quadrant' | 'assignee'>>,
): BoardItem | null {
  const board = loadBoard(projectSlug);
  if (!board) return null;

  for (const qk of QUADRANT_KEYS) {
    const idx = board.quadrants[qk].findIndex(i => i.id === itemId);
    if (idx < 0) continue;

    const item = board.quadrants[qk][idx];
    if (changes.title !== undefined) item.title = changes.title;
    if (changes.deadline !== undefined) item.deadline = changes.deadline;
    if (changes.status !== undefined) item.status = changes.status;
    if (changes.quadrant !== undefined && changes.quadrant !== qk) {
      board.quadrants[qk].splice(idx, 1);
      item.quadrant = changes.quadrant;
      board.quadrants[changes.quadrant].push(item);
    }
    item.updated = new Date().toISOString().slice(0, 10);

    saveBoard(board);
    return item;
  }
  return null;
}

/** 添加备忘 */
export function addBoardMemo(projectSlug: string, text: string, source?: string): BoardMemo | null {
  const board = loadBoard(projectSlug) || createBoard(projectSlug);
  const memo: BoardMemo = {
    text,
    created: new Date().toISOString().slice(0, 10),
    source,
  };
  board.memos.push(memo);
  saveBoard(board);
  return memo;
}

/** 获取 board 文件修改时间 */
export function getBoardMtime(projectSlug: string): number | null {
  const path = boardPath(projectSlug);
  if (!existsSync(path)) return null;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** 扫描所有 board，返回信号（只返回有信号的项） */
export function checkBoards(options?: {
  deadlineDays?: number;
}): BoardSignal[] {
  const signals: BoardSignal[] = [];
  const deadlineDays = options?.deadlineDays || 7;
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const slug of listBoardSlugs()) {
    const board = loadBoard(slug);
    if (!board) continue;

    const staleDays = board.stale_warning_days || 14;
    const boardAgeMs = now - new Date(board.last_updated).getTime();
    const boardAgeDays = Math.floor(boardAgeMs / 86400000);

    let activeCount = 0;
    let hasDeadlineSoon = false;
    let hasOverdue = false;

    for (const qk of QUADRANT_KEYS) {
      for (const item of board.quadrants[qk]) {
        if (item.status !== 'active') continue;
        activeCount++;

        if (item.deadline) {
          const deadlineDate = new Date(item.deadline);
          const daysLeft = Math.ceil((deadlineDate.getTime() - now) / 86400000);

          if (daysLeft < 0) {
            hasOverdue = true;
            signals.push({
              project: board.project,
              type: 'overdue',
              message: `${item.title} — 已过期 ${Math.abs(daysLeft)} 天`,
              days: daysLeft,
            });
          } else if (daysLeft <= deadlineDays) {
            hasDeadlineSoon = true;
            signals.push({
              project: board.project,
              type: 'deadline_soon',
              message: `${item.title} — ${daysLeft} 天后到期`,
              days: daysLeft,
            });
          }
        }

        // 僵尸 item：active 但 90+ 天未更新
        if (item.updated) {
          const itemAgeDays = Math.floor((now - new Date(item.updated).getTime()) / 86400000);
          if (itemAgeDays >= 90) {
            signals.push({
              project: board.project,
              type: 'stale_item',
              message: `${item.title} — 活跃但 ${itemAgeDays} 天未更新`,
              days: itemAgeDays,
            });
          }
        }
      }
    }

    // 项目 stale
    if (boardAgeDays >= staleDays && activeCount > 0) {
      signals.push({
        project: board.project,
        type: 'stale',
        message: `${boardAgeDays} 天无更新（${activeCount} 项待办）`,
        days: boardAgeDays,
      });
    }

    // 有活跃待办（只在没有其他信号时报告，避免噪音）
    if (activeCount > 0 && !hasDeadlineSoon && !hasOverdue) {
      signals.push({
        project: board.project,
        type: 'active',
        message: `${activeCount} 项待办`,
        item_count: activeCount,
      });
    }
  }

  return signals;
}

/** 自动归档：将 done 超 30 天的条目移入 archive 文件 */
export function archiveStaleItems(projectSlug: string): number {
  const board = loadBoard(projectSlug);
  if (!board) return 0;

  const archiveMs = 30 * 86400000;
  const now = Date.now();
  let archivedCount = 0;

  // 加载已有归档
  const archivePath = archiveBoardPath(projectSlug);
  let archivedItems: BoardItem[] = [];
  if (existsSync(archivePath)) {
    try {
      const raw = JSON.parse(readFileSync(archivePath, 'utf-8'));
      archivedItems = Array.isArray(raw.items) ? raw.items : [];
    } catch { /* ignore */ }
  }

  for (const qk of QUADRANT_KEYS) {
    const kept: BoardItem[] = [];
    for (const item of board.quadrants[qk]) {
      if (item.status === 'done' && item.updated) {
        const doneAge = now - new Date(item.updated).getTime();
        if (doneAge >= archiveMs) {
          item.status = 'archived';
          archivedItems.push(item);
          archivedCount++;
          continue;
        }
      }
      kept.push(item);
    }
    board.quadrants[qk] = kept;
  }

  if (archivedCount > 0) {
    saveBoard(board);
    writeFileSync(archivePath, JSON.stringify({
      project: board.project,
      archived_at: new Date().toISOString(),
      items: archivedItems,
    }, null, 2), 'utf-8');
  }

  return archivedCount;
}

/** 列出所有 board 摘要 */
export function listBoardSummaries(): Array<{ slug: string; project: string; activeCount: number; doneCount: number; lastUpdated: string }> {
  const summaries: Array<{ slug: string; project: string; activeCount: number; doneCount: number; lastUpdated: string }> = [];

  for (const slug of listBoardSlugs()) {
    const board = loadBoard(slug);
    if (!board) continue;

    let activeCount = 0;
    let doneCount = 0;
    for (const qk of QUADRANT_KEYS) {
      activeCount += board.quadrants[qk].filter(i => i.status === 'active').length;
      doneCount += board.quadrants[qk].filter(i => i.status === 'done').length;
    }

    summaries.push({
      slug,
      project: board.project,
      activeCount,
      doneCount,
      lastUpdated: board.last_updated,
    });
  }

  return summaries.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

// ── Recipe 衰减检测 ──

const DAY_MS = 86400000;

/** 检测过时 recipe，返回有问题的列表 */
export function checkRecipeStaleness(index: BrainIndex): RecipeStalenessSignal[] {
  const signals: RecipeStalenessSignal[] = [];
  const now = Date.now();

  for (const meta of index.recipes) {
    const reasons: string[] = [];

    // 90+ 天未访问
    if (meta.lastAccessed) {
      const daysSince = Math.floor((now - new Date(meta.lastAccessed).getTime()) / DAY_MS);
      if (daysSince >= 90) {
        reasons.push(`${daysSince}天未访问`);
      }
    } else if (meta.accessCount === 0) {
      const daysSinceCreated = Math.floor((now - new Date(meta.created).getTime()) / DAY_MS);
      if (daysSinceCreated >= 90) {
        reasons.push(`创建${daysSinceCreated}天从未访问`);
      }
    }

    // 置信度低
    if (meta.confidence < 0.7) {
      reasons.push(`置信度低(${meta.confidence})`);
    }

    // 框架可能过时
    if (meta.framework && meta.updated) {
      const daysSinceUpdate = Math.floor((now - new Date(meta.updated).getTime()) / DAY_MS);
      if (daysSinceUpdate >= 180) {
        reasons.push(`框架${meta.framework}可能过时`);
      }
    }

    if (reasons.length > 0) {
      signals.push({ recipeId: meta.id, summary: meta.summary, reasons });
    }
  }

  return signals;
}

/** 自动降权：accessCount=0 且 180+ 天的 recipe → confidence 降到 0.3 */
export function deprecateStaleRecipes(index: BrainIndex): { deprecated: string[]; total: number; active: number; stale: number; deprecatedCount: number } {
  const now = Date.now();
  const deprecated: string[] = [];

  for (const meta of index.recipes) {
    if (meta.accessCount === 0 && meta.confidence > 0.3) {
      const daysSinceCreated = Math.floor((now - new Date(meta.created).getTime()) / DAY_MS);
      if (daysSinceCreated >= 180) {
        meta.confidence = 0.3;
        meta.updated = new Date().toISOString();
        deprecated.push(meta.id);

        // 同步更新 recipe 文件
        const recipe = loadRecipe(meta.id);
        if (recipe) {
          recipe.confidence = 0.3;
          recipe.updated = meta.updated;
          saveRecipe(recipe);
        }
      }
    }
  }

  if (deprecated.length > 0) {
    saveIndex(index);
  }

  const health = getRecipeHealthSummary(index);
  return { deprecated, total: health.total, active: health.active, stale: health.stale, deprecatedCount: health.deprecated };
}

/** 获取 recipe 健康摘要 */
export function getRecipeHealthSummary(index: BrainIndex): { total: number; active: number; stale: number; deprecated: number } {
  const now = Date.now();
  let active = 0, stale = 0, deprecated = 0;

  for (const meta of index.recipes) {
    if (meta.confidence < 0.7) {
      deprecated++;
    } else if (meta.lastAccessed) {
      const days = Math.floor((now - new Date(meta.lastAccessed).getTime()) / DAY_MS);
      if (days >= 90) stale++;
      else active++;
    } else {
      const days = Math.floor((now - new Date(meta.created).getTime()) / DAY_MS);
      if (days >= 90 && meta.accessCount === 0) stale++;
      else active++;
    }
  }

  return { total: index.recipes.length, active, stale, deprecated };
}

// ── Board-Recipe 关联 ──

/** 查找与任务文本匹配的活跃 board items */
export function findMatchingBoardItems(taskText: string): Array<{ project: string; itemId: string; title: string }> {
  const keywords = extractKeywords(taskText);
  if (keywords.length === 0) return [];

  const matches: Array<{ project: string; itemId: string; title: string; overlap: number }> = [];

  for (const slug of listBoardSlugs()) {
    const board = loadBoard(slug);
    if (!board) continue;

    for (const qk of QUADRANT_KEYS) {
      for (const item of board.quadrants[qk]) {
        if (item.status !== 'active') continue;
        const itemKeywords = extractKeywords(item.title);
        const overlap = keywords.filter(k => itemKeywords.includes(k)).length;
        if (overlap >= 2) {
          matches.push({ project: board.project, itemId: item.id, title: item.title, overlap });
        }
      }
    }
  }

  return matches
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3)
    .map(({ project, itemId, title }) => ({ project, itemId, title }));
}

// ── Digest（分析缓存） ──

const DIGESTS_DIR = join(SCE_DIR, 'digests');
const DIGEST_INDEX_PATH = join(DIGESTS_DIR, 'index.json');

interface DigestIndex {
  version: string;
  updated: string;
  entries: DigestEntry[];
}

function ensureDigestsDir() {
  if (!existsSync(DIGESTS_DIR)) mkdirSync(DIGESTS_DIR, { recursive: true });
}

function loadDigestIndex(): DigestIndex {
  ensureDigestsDir();
  if (!existsSync(DIGEST_INDEX_PATH)) {
    const empty: DigestIndex = { version: '1.0', updated: new Date().toISOString(), entries: [] };
    writeFileSync(DIGEST_INDEX_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(DIGEST_INDEX_PATH, 'utf-8'));
}

function saveDigestIndex(di: DigestIndex): void {
  di.updated = new Date().toISOString();
  writeFileSync(DIGEST_INDEX_PATH, JSON.stringify(di, null, 2));
}

function digestPath(id: string): string {
  return join(DIGESTS_DIR, `${id}.md`);
}

function generateDigestId(): string {
  return `dgt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 关键词重叠率 */
function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map(k => k.toLowerCase()));
  const hits = a.filter(k => setB.has(k.toLowerCase())).length;
  return hits / Math.max(a.length, b.length);
}

/** Ebbinghaus 衰减 + Zipf 半衰期调整 */
function digestDecay(entry: DigestEntry): number {
  const daysSince = (Date.now() - new Date(entry.lastAccessed || entry.created).getTime()) / 86400000;
  // 高频访问 → 更长半衰期：base 7 天，每 5 次访问 +3 天，上限 30 天
  const halfLife = Math.min(7 + Math.floor(entry.accessCount / 5) * 3, 30);
  return Math.exp(-daysSince / halfLife);
}

export function storeDigest(input: {
  name: string;
  keywords: string[];
  content: string;
  project?: string;
  repo?: string;
  global?: boolean;
  ttlHours?: number;
}): DigestEntry {
  ensureDigestsDir();
  const di = loadDigestIndex();
  const now = new Date().toISOString();
  const id = generateDigestId();

  const entry: DigestEntry = {
    id,
    name: input.name,
    keywords: input.keywords,
    content: input.content,
    project: input.project,
    repo: input.repo,
    created: now,
    lastAccessed: now,
    accessCount: 0,
    global: input.global ?? false,
    expiresAt: input.ttlHours
      ? new Date(Date.now() + input.ttlHours * 3600000).toISOString()
      : undefined,
  };

  // 写入文件
  const meta = [`name: ${entry.name}`, `keywords: [${entry.keywords.map(k => `"${k}"`).join(', ')}]`, `created: ${entry.created}`].join('\n');
  writeFileSync(digestPath(id), `---\n${meta}\n---\n${entry.content}`);

  di.entries.push(entry);
  saveDigestIndex(di);
  return entry;
}

export function recallDigests(query: {
  keywords: string[];
  project?: string;
  limit?: number;
}): Array<DigestEntry & { score: number }> {
  const di = loadDigestIndex();
  const now = Date.now();
  const limit = query.limit || 3;

  const results: Array<DigestEntry & { score: number }> = [];

  for (const entry of di.entries) {
    // 过期跳过
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) continue;

    // 项目过滤（global 可跨项目）
    if (query.project && entry.project !== query.project && !entry.global) continue;

    const overlap = keywordOverlap(query.keywords, entry.keywords);
    if (overlap < 0.15) continue;

    const decay = digestDecay(entry);
    const score = overlap * decay;

    results.push({ ...entry, score });
  }

  results.sort((a, b) => b.score - a.score);

  // 更新访问统计
  const touched = results.slice(0, limit);
  if (touched.length > 0) {
    const nowISO = new Date().toISOString();
    for (const r of touched) {
      const idx = di.entries.findIndex(e => e.id === r.id);
      if (idx >= 0) {
        di.entries[idx].lastAccessed = nowISO;
        di.entries[idx].accessCount++;
      }
    }
    saveDigestIndex(di);

    // 更新内存中的返回值
    for (const r of touched) {
      r.lastAccessed = nowISO;
      r.accessCount++;
    }
  }

  return touched;
}

export function invalidateDigest(id: string): boolean {
  ensureDigestsDir();
  const di = loadDigestIndex();
  const idx = di.entries.findIndex(e => e.id === id);
  if (idx < 0) return false;

  di.entries.splice(idx, 1);
  saveDigestIndex(di);

  const path = digestPath(id);
  if (existsSync(path)) unlinkSync(path);
  return true;
}

export function listDigestSummaries(project?: string): Array<{ id: string; name: string; keywords: string[]; accessCount: number; created: string }> {
  const di = loadDigestIndex();
  let entries = di.entries;
  if (project) entries = entries.filter(e => e.project === project || e.global);
  return entries.map(e => ({
    id: e.id, name: e.name, keywords: e.keywords,
    accessCount: e.accessCount, created: e.created,
  }));
}
