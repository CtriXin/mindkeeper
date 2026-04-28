#!/usr/bin/env node
/**
 * MindKeeper CLI (mk)
 *
 * mk                          全景：recipe + board + thread
 * mk "query"                  统一搜索
 * mk rcp [id]                 列表 / 详情（alias: recipe）
 * mk rcp rm <id>              删除
 * mk bd [project]             列表 / 详情（alias: board）
 * mk bd done <project> <id>   标记完成
 * mk bd archive <project>     归档
 * mk dst [id]                 列表 / 详情（alias: thread）
 * mk dst rm <id>              删除
 * mk dst archive <id>         归档
 * mk c                        跨 CLI 续聊（continuity pack）
 */

import { loadIndex, saveIndex, loadRecipe, deleteRecipe } from './storage.js';
import { searchRecipes, extractKeywords } from './router.js';
import {
  loadBoard, updateBoardItem, listBoardSummaries, archiveStaleItems,
  findMatchingBoardItems, listBoardSlugs, boardPath,
} from './storage.js';
import { unlinkSync, readFileSync } from 'fs';
import { getThreadById, listRecentThreads } from './bootstrap.js';
import { syncProjectSessionIndex, SESSION_INDEX_REL_PATH } from './session-index.js';
import { QUADRANT_KEYS, QUADRANT_LABELS } from './types.js';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { cmdContinuity } from './continuity.js';

const args = process.argv.slice(2);
const command = args[0];

// ── ANSI 颜色 ──
const isColor = process.stdout.isTTY !== false;
const c = {
  bold:    (s: string) => isColor ? `\x1b[1m${s}\x1b[0m` : s,
  cyan:    (s: string) => isColor ? `\x1b[36m${s}\x1b[0m` : s,
  green:   (s: string) => isColor ? `\x1b[32m${s}\x1b[0m` : s,
  yellow:  (s: string) => isColor ? `\x1b[33m${s}\x1b[0m` : s,
  magenta: (s: string) => isColor ? `\x1b[35m${s}\x1b[0m` : s,
  gray:    (s: string) => isColor ? `\x1b[90m${s}\x1b[0m` : s,
};

function truncate(s: string, w: number): string {
  let len = 0;
  let i = 0;
  for (; i < s.length && len < w - 1; i++) {
    len += s.charCodeAt(i) > 127 ? 2 : 1;
  }
  return len >= w - 1 && i < s.length ? s.slice(0, i) + '…' : s;
}

function printHelp() {
  console.log(`
mk — MindKeeper CLI

  mk                              全景（各显示 5 条）
  mk all                          全景（显示全部）
  mk "query"                      统一搜索

  mk rcp [all]                    列出 recipe
  mk rcp <id>                     查看详情
  mk rcp rm <id>                  删除

  mk bd [all]                     列出看板
  mk bd <project>                 查看看板
  mk bd rm <project>              删除看板
  mk bd done <project> <id>       标记完成
  mk bd archive <project>         归档

  mk dst [all]                    列出 thread（按 repo 聚合）
  mk dst -l                       列出 thread（详细表格，含 time/cli/model/repo/folder）
  mk dst <id>                     查看详情
  mk dst rm <id>                  删除
  mk dst archive <id>             归档
  mk dst resume <id> [--no-cd]    恢复 thread 上下文
                                    --no-cd: 不切换工作目录，仅加载上下文
  mk dst sync [repo]              重建当前项目 ${SESSION_INDEX_REL_PATH}

  mk c                             跨 CLI 续聊：生成 continuity pack 并复制
  mk c codex:<hash>                指定 Codex session hash
  mk c --to mms-codex              生成后提示用 mms codex 继续
`);
}

// ── 通用格式化 ──

const DEFAULT_LIMIT = 5;

function fmtId(id: string): string {
  // 显示完整 ID，方便复制：dst-0328-vfdy3c
  return c.cyan(id);
}

function fmtAge(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000);
  return days === 0 ? '今天' : `${days}天前`;
}

function projName(repo: string): string {
  return repo.split('/').pop() || repo;
}

function detectRepoRoot(base: string): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: base,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return base;
  }
}

// ── Thread 按 repo 聚合 ──

interface ThreadGroup {
  repo: string;
  name: string;
  local: boolean;
  threads: ReturnType<typeof listRecentThreads>;
}

function groupThreadsByRepo(
  threads: ReturnType<typeof listRecentThreads>,
  cwd: string,
): { local: ThreadGroup[]; other: ThreadGroup[] } {
  const map = new Map<string, ReturnType<typeof listRecentThreads>>();
  for (const t of threads) {
    const repo = t.repo || 'unknown';
    if (!map.has(repo)) map.set(repo, []);
    map.get(repo)!.push(t);
  }

  const local: ThreadGroup[] = [];
  const other: ThreadGroup[] = [];

  for (const [repo, items] of map) {
    const isLocal = repo === cwd || cwd.startsWith(repo + '/') || repo.startsWith(cwd + '/');
    const group: ThreadGroup = { repo, name: projName(repo), local: isLocal, threads: items };
    (isLocal ? local : other).push(group);
  }

  // 组内按最新 thread 排序
  const byNewest = (a: ThreadGroup, b: ThreadGroup) =>
    b.threads[0].createdAtMs - a.threads[0].createdAtMs;
  local.sort(byNewest);
  other.sort(byNewest);

  return { local, other };
}

function printThreadGroups(
  groups: ThreadGroup[],
  limit: number,
  dim: boolean,
  detailed = false,
) {
  if (detailed) {
    // Detailed table format: ID | TIME | CLI | MODEL | REPO/FOLDER | TASK
    const header = `  ${c.bold('ID')}                 ${c.bold('TIME')}    ${c.bold('CLI')}       ${c.bold('MODEL')}              ${c.bold('REPO/FOLDER')}               ${c.bold('TASK')}`;
    console.log(header);
    console.log('  ' + '─'.repeat(110));
  }

  let printed = 0;
  for (const g of groups) {
    if (printed >= limit) break;
    const remaining = limit - printed;
    const show = g.threads.slice(0, remaining);

    if (!detailed) {
      if (dim) {
        console.log(`  ${c.gray(g.name)}`);
      } else {
        console.log(`  ${c.green(g.name)}`);
      }
    }

    for (const t of show) {
      if (detailed) {
        const time = fmtAgeShort(t.createdAtMs);
        const cli = (t.cli || '-').padEnd(8);
        const model = truncate(t.model || '-', 16).padEnd(18);
        const folder = t.folder ? `${g.name}/${t.folder}` : g.name;
        const shortFolder = truncate(folder, 24).padEnd(26);
        const task = truncate(t.task, 30);
        const line = `  ${fmtId(t.id)}  ${c.gray(time)}  ${cli}  ${model}  ${shortFolder}  ${task}`;
        console.log(dim ? c.gray(line) : line);
      } else {
        const line = `    ${fmtId(t.id)}  ${truncate(t.task, 42)}  ${c.gray(fmtAge(t.createdAtMs))}`;
        console.log(dim ? c.gray(line) : line);
      }
      printed++;
    }
  }
  return printed;
}

function fmtAgeShort(ms: number): string {
  const diff = Date.now() - ms;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days === 0) {
    if (hours === 0) return '<1h';
    return `${hours}h`;
  }
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}m`;
}

// ── 全景 ──
function showAll(showAllItems = false) {
  const index = loadIndex();
  const limit = showAllItems ? Infinity : DEFAULT_LIMIT;

  // Recipes
  if (index.recipes.length > 0) {
    const show = index.recipes.slice(0, limit);
    const more = index.recipes.length - show.length;
    console.log(c.bold(`📋 Recipe (${index.recipes.length})`));
    for (const r of show) {
      const icon = r.type === 'insight' ? '💡' : '📋';
      const fw = r.framework ? c.gray(` [${r.framework}]`) : '';
      console.log(`  ${icon} ${c.cyan(r.id)}: ${truncate(r.summary, 60)}${fw}`);
    }
    if (more > 0) console.log(c.gray(`  … +${more} 条 (mk recipe 查看全部)`));
  }

  // Boards（只显示有待办的看板）
  const summaries = listBoardSummaries().filter(s => s.activeCount > 0);
  if (summaries.length > 0) {
    const show = summaries.slice(0, limit);
    const more = summaries.length - show.length;
    console.log(`\n${c.bold(`📌 Board (${summaries.length})`)}`);
    for (const s of show) {
      console.log(`  ${c.cyan('bd-' + s.slug)} ${c.yellow(`${s.activeCount} 待办`)}`);
    }
    if (more > 0) console.log(c.gray(`  … +${more} 个 (mk board 查看全部)`));
  }

  // Threads — 按 repo 聚合
  const threads = listRecentThreads(undefined, showAllItems ? 100 : 50);
  if (threads.length > 0) {
    const cwd = process.cwd();
    const { local, other } = groupThreadsByRepo(threads, cwd);
    const totalCount = threads.length;
    console.log(`\n${c.bold(`🧵 Thread (${totalCount})`)}`);

    // 总共5条：先给当前，剩余给其他；当前不够展示则扩到8 max
    const localTotal = local.reduce((n, g) => n + g.threads.length, 0);

    let localLimit: number;
    let otherLimit: number;
    if (showAllItems) {
      localLimit = Infinity;
      otherLimit = Infinity;
    } else {
      localLimit = Math.min(localTotal, 5);
      otherLimit = 5 - localLimit;
      // 当前超过分配额，扩到 8 max
      if (localLimit < localTotal) {
        localLimit = Math.min(localTotal, 8);
      }
    }

    let localPrinted = 0;
    if (local.length > 0) {
      console.log(c.bold('  ▸ 当前'));
      localPrinted = printThreadGroups(local, localLimit, false);
    }

    if (other.length > 0 && otherLimit > 0) {
      if (localPrinted > 0) console.log('');
      console.log(c.gray('  ▹ 其他'));
      printThreadGroups(other, otherLimit, true);
    }
  }

  if (index.recipes.length === 0 && summaries.length === 0 && threads.length === 0) {
    console.log('暂无数据');
  }

  console.log('');
  console.log(c.gray('mk <id> 查看  mk all 全部  mk rcp/bd/dst 分类  mk help 帮助'));
}

// ── recipe 子命令 ──
function cmdRecipe() {
  const sub = args[1];
  const index = loadIndex();

  // mk rcp — 列表（全部）
  if (!sub || sub === 'all') {
    if (index.recipes.length === 0) { console.log('Recipe 库为空'); return; }
    for (const r of index.recipes) {
      const icon = r.type === 'insight' ? '💡' : '📋';
      const fw = r.framework ? c.gray(` [${r.framework}]`) : '';
      const proj = r.project ? c.green(` (${r.project})`) : '';
      console.log(`${icon} ${c.cyan(r.id)}: ${r.summary}${fw}${proj}`);
    }
    return;
  }

  // mk recipe rm <id>
  if (sub === 'rm') {
    const id = args[2];
    if (!id) { console.log('用法: mk recipe rm <id>'); return; }
    if (!deleteRecipe(id)) { console.log(`不存在: ${id}`); return; }
    index.recipes = index.recipes.filter(r => r.id !== id);
    saveIndex(index);
    console.log(`已删除: ${id}`);
    return;
  }

  // mk recipe <id> — 详情
  const recipe = loadRecipe(sub);
  if (!recipe) { console.log(`不存在: ${sub}`); return; }

  const typeLabel = recipe.type === 'insight' ? '💡 Insight' : '📋 Recipe';
  console.log(`\n# ${recipe.summary}\n`);
  console.log(`ID: ${recipe.id} | 类型: ${typeLabel}`);
  console.log(`触发词: ${recipe.triggers.join(', ')}`);
  if (recipe.framework) console.log(`框架: ${recipe.framework}`);
  if (recipe.project) console.log(`项目: ${recipe.project}`);
  console.log(`置信度: ${recipe.confidence} | 访问: ${recipe.accessCount} 次`);

  if (recipe.conclusion) console.log(`\n## 结论\n  ${recipe.conclusion}`);
  if (recipe.why) console.log(`\n## 原因\n  ${recipe.why}`);
  if (recipe.when_to_apply) console.log(`\n## 适用场景\n  ${recipe.when_to_apply}`);
  if (recipe.steps.length > 0) {
    console.log(`\n## 步骤`);
    recipe.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }
  if (recipe.files.length > 0) {
    console.log(`\n## 文件`);
    recipe.files.forEach(f => console.log(`  - ${f.path} — ${f.description}`));
  }
  if (recipe.gotchas.length > 0) {
    console.log(`\n## 坑点`);
    recipe.gotchas.forEach(g => console.log(`  - ${g}`));
  }
  if (recipe.corrections.length > 0) {
    console.log(`\n## 纠正`);
    recipe.corrections.forEach(cc => console.log(`  - ${cc}`));
  }
}

// ── board 子命令 ──
function cmdBoard() {
  const sub = args[1];

  // mk bd — 列表（全部）
  if (!sub || sub === 'all') {
    const all = listBoardSummaries().filter(s => s.activeCount > 0);
    if (all.length === 0) { console.log('没有看板（或全部已完成）'); return; }
    for (const s of all) {
      console.log(`📌 ${c.cyan('bd-' + s.slug)} ${c.yellow(`${s.activeCount} 待办`)} ${c.gray(s.lastUpdated)}`);
    }
    return;
  }

  // mk board rm <project>
  if (sub === 'rm') {
    const proj = args[2];
    if (!proj) { console.log('用法: mk board rm <project>'); return; }
    const slug = proj.startsWith('bd-') ? proj.slice(3) : proj;
    const board = loadBoard(slug);
    if (!board) { console.log(`不存在: ${slug}`); return; }
    unlinkSync(boardPath(slug));
    console.log(`已删除看板: ${slug}`);
    return;
  }

  // mk board archive <project>
  if (sub === 'archive') {
    const proj = args[2];
    if (!proj) { console.log('用法: mk board archive <project>'); return; }
    const slug = proj.startsWith('bd-') ? proj.slice(3) : proj;
    const count = archiveStaleItems(slug);
    console.log(count > 0 ? `已归档 ${count} 条` : '没有需要归档的条目');
    return;
  }

  // mk board done <project> <id>
  if (sub === 'done') {
    const proj = args[2];
    const itemId = args[3];
    if (!proj || !itemId) { console.log('用法: mk board done <project> <id>'); return; }
    const slug = proj.startsWith('bd-') ? proj.slice(3) : proj;
    const item = updateBoardItem(slug, itemId, { status: 'done' });
    console.log(item ? `已完成: [${itemId}] ${item.title}` : `未找到: ${itemId}`);
    return;
  }

  const project = sub.startsWith('bd-') ? sub.slice(3) : sub;

  // mk board <project> — 详情
  const board = loadBoard(project);
  if (!board) { console.log(`看板不存在: ${project}`); return; }

  console.log(`\n# ${board.project} ${c.gray(board.last_updated)}`);
  const icons = ['🔴', '🟡', '🟢', '⚪'] as const;
  for (let i = 0; i < QUADRANT_KEYS.length; i++) {
    const qk = QUADRANT_KEYS[i];
    const items = board.quadrants[qk].filter(item => item.status !== 'archived');
    if (items.length === 0) continue;
    console.log(`\n${icons[i]} ${QUADRANT_LABELS[qk]}`);
    for (const item of items) {
      const done = item.status === 'done' ? c.gray(' ✓') : '';
      const dl = item.deadline ? c.gray(` (${item.deadline})`) : '';
      console.log(`  [${item.id}] ${item.title}${dl}${done}`);
    }
  }
  if (board.memos.length > 0) {
    console.log(`\n📝 备忘`);
    for (const m of board.memos) console.log(`  - ${m.text}`);
  }
}

// ── thread 子命令 ──
function cmdThread() {
  const sub = args[1];
  const isDetailed = args.includes('-l') || args.includes('--detailed');

  // Handle flags like -l before subcommand checks
  if (isDetailed && (!sub || sub === '-l' || sub === '--detailed' || sub === 'all')) {
    const all = listRecentThreads(undefined, 100);
    if (all.length === 0) { console.log('没有 thread'); return; }

    const cwd = process.cwd();
    const { local, other } = groupThreadsByRepo(all, cwd);

    // Detailed list all in one table
    console.log(c.bold(`\n🧵 Thread (${all.length})\n`));
    printThreadGroups([...local, ...other], Infinity, false, true);
    console.log(c.gray('\n\nmk dst resume <id> [--no-cd]  恢复上下文'));
    return;
  }

  const showAllItems = sub === 'all';

  if (sub === 'sync') {
    const target = args[2] ? resolve(args[2]) : detectRepoRoot(process.cwd());
    const result = syncProjectSessionIndex(target);
    if (!result.path || result.count === 0) {
      console.log(`没有可同步的 thread：${target}`);
      return;
    }
    console.log(`已同步 ${result.path} (${result.count} 条)`);
    return;
  }

  // mk dst resume <id> [--no-cd]
  if (sub === 'resume') {
    const id = args[2];
    const noCd = args.includes('--no-cd');
    if (!id) { console.log('用法: mk thread resume <id> [--no-cd]'); return; }

    const thread = getThreadById('', id);
    if (!thread) { console.log(`未找到: ${id}`); return; }

    // 直接读取 thread 文件，不依赖外部 dst 命令
    try {
      const content = readFileSync(thread.path, 'utf-8');

      if (!noCd) {
        console.log(`\n已切换到: ${c.cyan(thread.repo)}`);
        console.log(`目录: ${c.gray(thread.folder || '.')}\n`);
      } else {
        console.log(`\n当前目录保持不变`);
        console.log(`Thread 路径: ${c.cyan(thread.repo)}${thread.folder ? '/' + thread.folder : ''}\n`);
      }

      console.log(c.bold('=== Thread 上下文 ==='));
      console.log(content);
    } catch {
      console.log(`读取失败: ${thread.path}`);
    }
    return;
  }

  // mk dst — 按 repo 聚合列表（全部）
  if (!sub || showAllItems) {
    const all = listRecentThreads(undefined, 100);
    if (all.length === 0) { console.log('没有 thread'); return; }

    const cwd = process.cwd();
    const { local, other } = groupThreadsByRepo(all, cwd);

    let localPrinted = 0;
    if (local.length > 0) {
      console.log(c.bold(`▸ 当前`));
      localPrinted = printThreadGroups(local, Infinity, false);
    }

    if (other.length > 0) {
      if (localPrinted > 0) console.log('');
      console.log(c.gray(`▹ 其他`));
      printThreadGroups(other, Infinity, true);
    }
    return;
  }

  // mk thread rm <id>
  if (sub === 'rm') {
    const id = args[2];
    if (!id) { console.log('用法: mk thread rm <id>'); return; }
    try { execSync(`dst rm ${id}`, { encoding: 'utf-8' }); }
    catch { console.log(`删除失败: ${id}`); }
    return;
  }

  // mk thread archive <id>
  if (sub === 'archive') {
    const id = args[2];
    if (!id) { console.log('用法: mk thread archive <id>'); return; }
    try { execSync(`dst archive ${id}`, { encoding: 'utf-8' }); }
    catch { console.log(`归档失败: ${id}`); }
    return;
  }

  // mk thread <id> — 详情（复用 dst show）
  try {
    const out = execSync(`dst show ${sub}`, { encoding: 'utf-8' });
    console.log(out);
  } catch {
    console.log(`不存在: ${sub}`);
  }
}

// ── 统一搜索 ──
function cmdSearch(query: string) {
  const index = loadIndex();
  const queryTerms = extractKeywords(query);
  let hasResults = false;

  // Recipes
  const recipeResults = searchRecipes(index, query, 5);
  if (recipeResults.length > 0) {
    hasResults = true;
    console.log(c.bold(`📋 Recipe (${recipeResults.length})\n`));
    for (const r of recipeResults) {
      console.log(`  ${c.gray(`[${r.score.toFixed(2)}]`)} ${c.cyan(r.recipe.id)}: ${r.recipe.summary}`);
    }
  }

  // Board items
  const boardMatches = findMatchingBoardItems(query);
  if (boardMatches.length > 0) {
    hasResults = true;
    console.log(`\n${c.bold(`📌 Board (${boardMatches.length})`)}\n`);
    for (const m of boardMatches) {
      console.log(`  ${c.green(m.project)} ${c.gray('›')} [${c.yellow(m.itemId)}] ${m.title}`);
    }
  }

  // Board 项目名匹配
  const matchedBoards = listBoardSlugs().filter(slug => {
    const lower = slug.toLowerCase();
    return queryTerms.some(t => lower.includes(t) || t.includes(lower));
  });
  for (const slug of matchedBoards) {
    const board = loadBoard(slug);
    if (!board) continue;
    hasResults = true;
    const active = Object.values(board.quadrants).flat().filter(i => i.status === 'active');
    console.log(`\n${c.bold(`📌 ${board.project}`)} ${c.gray(`(${active.length} 待办)`)}`);
    for (const item of active.slice(0, 5)) {
      const dl = item.deadline ? c.gray(` (${item.deadline})`) : '';
      console.log(`  [${c.yellow(item.id)}] ${item.title}${dl}`);
    }
  }

  // Threads
  const allThreads = listRecentThreads(undefined, 20);
  const threadMatches = allThreads.filter(t => {
    const text = `${t.task} ${t.repo} ${t.status}`.toLowerCase();
    return queryTerms.some(term => text.includes(term));
  }).slice(0, 3);
  if (threadMatches.length > 0) {
    hasResults = true;
    console.log(`\n${c.bold(`🧵 Thread (${threadMatches.length})`)}\n`);
    for (const t of threadMatches) {
      const age = Math.floor((Date.now() - t.createdAtMs) / 86400000);
      console.log(`  ${c.magenta(t.id)} ${t.task} ${c.gray(`${age === 0 ? '今天' : age + '天前'}`)}`);
    }
  }

  if (!hasResults) console.log(`未找到: "${query}"`);
}

// ── 智能 ID 路由 ──
function tryDirectShow(id: string): boolean {
  // thread: dst-* 开头
  if (id.startsWith('dst-')) {
    try {
      const out = execSync(`dst show ${id}`, { encoding: 'utf-8' });
      console.log(out);
      return true;
    } catch { /* not found */ }
  }

  // recipe: rcp-* 开头
  if (id.startsWith('rcp-')) {
    const recipe = loadRecipe(id);
    if (recipe) { args[1] = id; cmdRecipe(); return true; }
  }

  // board: bd-* 开头 → 去掉前缀加载
  if (id.startsWith('bd-')) {
    const slug = id.slice(3);
    const board = loadBoard(slug);
    if (board) { args[1] = slug; args.length = 2; cmdBoard(); return true; }
  }

  // 无前缀兜底：依次尝试 recipe → board
  const recipe = loadRecipe(id);
  if (recipe) { args[1] = id; cmdRecipe(); return true; }

  const board = loadBoard(id);
  if (board) { args[1] = id; args.length = 2; cmdBoard(); return true; }

  return false;
}

// ── 路由 ──
switch (command) {
  case 'recipe': case 'rcp': cmdRecipe(); break;
  case 'board': case 'bd':   cmdBoard();  break;
  case 'thread': case 'dst': cmdThread(); break;
  case 'continue': case 'continuity': case 'c': await cmdContinuity(args.slice(1)); break;
  case 'help': case '--help': case '-h': printHelp(); break;
  case 'all': showAll(true); break;
  case undefined: showAll(); break;
  default: {
    // 单个参数时先尝试智能 ID 匹配
    if (args.length === 1 && tryDirectShow(args[0])) break;
    cmdSearch(args.join(' '));
    break;
  }
}
