#!/usr/bin/env node
/**
 * MindKeeper MCP Server — 8 tools
 *
 * Knowledge: brain_learn / brain_recall / brain_list
 * Distill:   brain_bootstrap / brain_checkpoint / brain_threads
 * Board:     brain_board / brain_check
 */

import { execSync } from 'child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadIndex, saveIndex, loadRecipe, saveRecipe, recipeMetaFrom, touchRecipes } from './storage.js';
import { searchRecipes } from './router.js';
import { bootstrapQuick, formatQuickResume, getThreadById, listRecentThreads, findBestThread, loadThreadDetails } from './bootstrap.js';
import { checkpoint, formatDistillReceipt } from './distill.js';
import {
  loadBoard, createBoard, addBoardItem, updateBoardItem,
  addBoardMemo, checkBoards, listBoardSummaries, archiveStaleItems,
  saveBoard, listBoardSlugs,
  checkRecipeStaleness, deprecateStaleRecipes, getRecipeHealthSummary,
  findMatchingBoardItems,
} from './storage.js';
import type { BrainIndex, Recipe, RecipeFile, ChangelogEntry, QuadrantKey, Board, BoardSignal } from './types.js';
import { QUADRANT_KEYS, QUADRANT_LABELS } from './types.js';

let index: BrainIndex = loadIndex();

/** 自动生成 recipe ID: rcp-项目尾段-3位递增编号 */
function generateRecipeId(idx: BrainIndex, project?: string): string {
  const prefix = project
    ? project.split(/[_\-/]/).filter(Boolean).pop()!.toLowerCase()
    : 'mk';

  // 找同前缀最大编号（兼容新旧格式）
  const pattern = new RegExp(`^(?:rcp-)?${prefix}-(\\d+)$`);
  let max = 0;
  for (const r of idx.recipes) {
    const m = r.id.match(pattern);
    if (m) max = Math.max(max, Number(m[1]));
  }

  return `rcp-${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const server = new Server(
  { name: 'mindkeeper', version: '2.1.0' },
  { capabilities: { tools: {} } }
);

// ── 工具定义 ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'brain_learn',
      description: [
        '存储可复用知识到知识库。支持两种类型：',
        '',
        '**recipe**（默认）— 实现经验：步骤 + 文件 + 坑点。用于代码实现模式的跨项目复用。',
        '**insight** — 产品/设计认知：结论 + 原因 + 适用场景。用于决策经验、架构认知、设计原则。',
        '',
        '调用时机：',
        '- 任务收敛后，若检测到可复用模式，先询问用户"要不要存个 recipe/insight"',
        '- 用户明确说"存到知识库"、"learn 一下"、"记到 recipe"等指向知识库的指令时直接调用',
        '- 注意："总结一下"、"记录一下"不等于要存，不确定时先问',
        '',
        '如果 id 已存在，自动覆盖主体并追加 changelog。',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '可选，不传则自动生成（项目尾段+递增编号如 crypto-001）' },
          type: { type: 'string', enum: ['recipe', 'insight'], description: '知识类型：recipe（实现经验）或 insight（产品/设计认知），默认 recipe' },
          triggers: {
            type: 'array', items: { type: 'string' },
            description: '触发词（中英文皆可，如 ["广告延迟加载", "ad lazy load"]）',
          },
          summary: { type: 'string', description: '一句话摘要' },
          // recipe 字段
          steps: {
            type: 'array', items: { type: 'string' },
            description: 'recipe: 实现步骤（有序）',
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '文件路径' },
                description: { type: 'string', description: '在此文件中做了什么' },
              },
              required: ['path', 'description'],
            },
            description: 'recipe: 涉及的文件及各自改动说明',
          },
          gotchas: {
            type: 'array', items: { type: 'string' },
            description: '已知坑点和注意事项',
          },
          corrections: {
            type: 'array', items: { type: 'string' },
            description: '用户纠正过的错误（最有价值的知识）',
          },
          // insight 字段
          conclusion: { type: 'string', description: 'insight: 核心结论' },
          why: { type: 'string', description: 'insight: 为什么得出这个结论' },
          when_to_apply: { type: 'string', description: 'insight: 什么场景下应用这个认知' },
          // 通用字段
          repo: { type: 'string', description: '来源仓库完整路径' },
          branch: { type: 'string', description: '来源分支' },
          framework: { type: 'string', description: '框架/版本标签（如 vue3, react18, nuxt3）' },
          project: { type: 'string', description: '来源项目名' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签' },
          confidence: { type: 'number', description: '置信度 0-1，默认 0.9' },
          changelog_note: { type: 'string', description: '本次变更说明（更新时必填）' },
        },
        required: ['triggers', 'summary'],
      },
    },
    {
      name: 'brain_recall',
      description: [
        '根据任务描述查找相关 recipe，返回实现步骤、涉及文件、已知坑点和用户纠正。',
        '在新项目开始类似任务时调用，获取跨项目的实现经验。',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '任务描述（如 "广告延迟加载"）' },
          limit: { type: 'number', description: '返回数量，默认 3' },
        },
        required: ['query'],
      },
    },
    {
      name: 'brain_list',
      description: '列出所有已存储的 recipe 摘要。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '按项目过滤' },
          tag: { type: 'string', description: '按标签过滤' },
          framework: { type: 'string', description: '按框架过滤' },
        },
      },
    },
    {
      name: 'brain_bootstrap',
      description: '轻量启动入口（<100ms）。只读最近 thread 和一句 next action。',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '当前任务描述' },
          repo: { type: 'string', description: '当前仓库路径' },
          thread: { type: 'string', description: '指定恢复的 thread id（如 dst-20260326-xxxxxx）' },
        },
        required: ['task', 'repo'],
      },
    },
    {
      name: 'brain_checkpoint',
      description: '蒸馏当前工作状态，写入 thread 文件。保存进度供跨 session 恢复。',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: '当前仓库路径' },
          task: { type: 'string', description: '当前任务描述' },
          branch: { type: 'string', description: '当前分支' },
          parent: { type: 'string', description: '显式指定 parent thread id' },
          decisions: { type: 'array', items: { type: 'string' }, description: '决策（≤5）' },
          changes: { type: 'array', items: { type: 'string' }, description: '变更文件' },
          findings: { type: 'array', items: { type: 'string' }, description: '发现和踩坑' },
          next: { type: 'array', items: { type: 'string' }, description: '待续事项' },
          status: { type: 'string', description: '一句话状态' },
        },
        required: ['repo', 'task', 'status'],
      },
    },
    {
      name: 'brain_threads',
      description: '列出所有未过期的蒸馏 thread，按 repo 分组。',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: '可选，只看某个 repo 的 thread' },
        },
      },
    },
    {
      name: 'brain_board',
      description: [
        '读写项目的四象限看板 + 备忘。每个项目一个 board，存储在 ~/.sce/boards/ 下。',
        '',
        '操作：',
        '- read: 读取指定项目的完整 board',
        '- write: 创建/重写整个 board（传入完整 data）',
        '- add_item: 添加条目（title + quadrant，默认 q2 重要不紧急）',
        '- update_item: 更新条目字段（title/deadline/status/quadrant/assignee）',
        '- add_memo: 添加备忘',
        '- list: 列出所有项目 board 摘要',
        '- archive: 归档已完成超 30 天的条目',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '项目名或 slug（如 mindkeeper）' },
          action: {
            type: 'string',
            enum: ['read', 'write', 'add_item', 'update_item', 'add_memo', 'list', 'archive'],
            description: '操作类型',
          },
          data: {
            type: 'object',
            description: 'write 时的完整 board 数据',
          },
          title: { type: 'string', description: 'add_item 时的标题' },
          quadrant: {
            type: 'string',
            enum: ['q1', 'q2', 'q3', 'q4'],
            description: 'add_item 时的象限（默认 q2 重要不紧急）',
          },
          item_id: { type: 'string', description: 'update_item 时的条目 id' },
          changes: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              deadline: { type: 'string' },
              status: { type: 'string', enum: ['active', 'done', 'archived'] },
              quadrant: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'] },
              assignee: { type: 'string' },
            },
            description: 'update_item 时要修改的字段',
          },
          deadline: { type: 'string', description: 'add_item 时的截止日期（YYYY-MM-DD）' },
          assignee: { type: 'string', description: 'add_item 时的负责人' },
          source: { type: 'string', description: 'add_item/add_memo 的来源（如 feishu）' },
          source_ref: { type: 'string', description: 'add_item 的来源引用（如消息 id）' },
          text: { type: 'string', description: 'add_memo 时的备忘文本' },
        },
        required: ['project', 'action'],
      },
    },
    {
      name: 'brain_check',
      description: [
        '扫描所有项目 board，返回需要关注的信号。轻量调用，只返回有信号的项。',
        '',
        '信号类型：',
        '- deadline_soon: deadline 在 N 天内（默认 7 天）',
        '- overdue: 已过 deadline',
        '- stale: 项目超过 stale_warning_days 无更新',
        '- active: 有活跃待办',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          deadline_days: { type: 'number', description: '提前多少天提醒 deadline（默认 7）' },
        },
      },
    },
  ],
}));

// ── 工具处理 ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;

  try {
    switch (name) {
      // ── brain_learn ──
      case 'brain_learn': {
        const knowledgeType = (args.type as string) === 'insight' ? 'insight' as const : 'recipe' as const;
        const triggers = (args.triggers as string[]) || [];
        const summary = String(args.summary);
        const steps = (args.steps as string[]) || [];
        const files = ((args.files as any[]) || []).map((f: any): RecipeFile => ({
          path: String(f.path),
          description: String(f.description || ''),
        }));
        const gotchas = (args.gotchas as string[]) || [];
        const corrections = (args.corrections as string[]) || [];
        const conclusion = args.conclusion ? String(args.conclusion) : undefined;
        const why = args.why ? String(args.why) : undefined;
        const when_to_apply = args.when_to_apply ? String(args.when_to_apply) : undefined;
        const repo = args.repo ? String(args.repo) : undefined;
        const branch = args.branch ? String(args.branch) : undefined;
        const framework = args.framework ? String(args.framework) : undefined;
        const project = args.project ? String(args.project) : undefined;
        const tags = (args.tags as string[]) || undefined;
        const confidence = Number(args.confidence) || 0.9;
        const changelogNote = args.changelog_note ? String(args.changelog_note) : undefined;

        // ID: 传了就用，没传自动生成（项目尾段+递增编号）
        const id = args.id ? String(args.id) : generateRecipeId(index, project);

        const existing = loadRecipe(id);
        const now = new Date().toISOString().slice(0, 10);

        if (existing) {
          // 覆盖主体 + 追加 changelog
          existing.type = knowledgeType;
          existing.triggers = triggers;
          existing.summary = summary;
          existing.steps = steps;
          existing.files = files;
          existing.gotchas = gotchas;
          existing.corrections = corrections;
          existing.conclusion = conclusion;
          existing.why = why;
          existing.when_to_apply = when_to_apply;
          if (repo) existing.repo = repo;
          if (branch) existing.branch = branch;
          if (framework) existing.framework = framework;
          if (project) existing.project = project;
          if (tags) existing.tags = tags;
          existing.confidence = confidence;
          existing.updated = new Date().toISOString();
          existing.changelog.push({
            date: now,
            description: changelogNote || '更新',
          });

          saveRecipe(existing);

          const metaIdx = index.recipes.findIndex(r => r.id === id);
          if (metaIdx >= 0) {
            index.recipes[metaIdx] = recipeMetaFrom(existing);
          }
          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: `已更新 recipe: ${id}\n` +
                `步骤: ${steps.length} | 文件: ${files.length} | 坑点: ${gotchas.length} | 纠正: ${corrections.length}\n` +
                `Changelog: +1 (共 ${existing.changelog.length} 条)`,
            }],
          };
        }

        // 新建
        const recipe: Recipe = {
          id,
          type: knowledgeType,
          triggers,
          summary,
          repo,
          branch,
          steps,
          files,
          gotchas,
          corrections,
          conclusion,
          why,
          when_to_apply,
          framework,
          project,
          tags,
          confidence,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          accessCount: 0,
          changelog: [{ date: now, description: changelogNote || '首次记录' }],
        };

        // 自动关联 board item
        const boardMatches = findMatchingBoardItems(summary + ' ' + triggers.join(' '));
        if (boardMatches.length > 0) {
          recipe.boardItemId = boardMatches[0].itemId;
        }

        saveRecipe(recipe);
        // 去重：确保 index 中没有同 ID 条目
        index.recipes = index.recipes.filter(r => r.id !== id);
        index.recipes.push(recipeMetaFrom(recipe));
        saveIndex(index);

        const typeLabel = knowledgeType === 'insight' ? 'insight' : 'recipe';
        let learnText = `已存入 ${typeLabel}: ${id}\n` +
          `触发词: ${triggers.join(', ')}`;
        if (knowledgeType === 'insight') {
          learnText += `\n结论: ${conclusion || '-'} | 原因: ${why ? '✓' : '-'} | 适用场景: ${when_to_apply ? '✓' : '-'}`;
        } else {
          learnText += `\n步骤: ${steps.length} | 文件: ${files.length} | 坑点: ${gotchas.length} | 纠正: ${corrections.length}`;
        }
        if (recipe.boardItemId) {
          const match = boardMatches[0];
          learnText += `\n📌 已关联看板: [${match.project}] ${match.title}`;
        }

        return {
          content: [{ type: 'text', text: learnText }],
        };
      }

      // ── brain_recall ──
      case 'brain_recall': {
        const query = String(args.query || '');
        const limit = Number(args.limit) || 3;
        const results = searchRecipes(index, query, limit);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: '未找到相关 recipe。' }] };
        }

        touchRecipes(index, results.map(r => r.recipe.id));

        // 检测过时
        const recallStaleSignals = checkRecipeStaleness(index);
        const recallStaleMap = new Map(recallStaleSignals.map(s => [s.recipeId, s.reasons]));

        const text = results.map((r, i) => {
          const rec = r.recipe;
          const parts: string[] = [];

          const typeLabel = rec.type === 'insight' ? '💡 insight' : '📋 recipe';
          parts.push(`## ${i + 1}. ${rec.summary} [${typeLabel}] (score: ${r.score.toFixed(2)})`);
          parts.push(`**ID**: ${rec.id} | **框架**: ${rec.framework || '通用'} | **项目**: ${rec.project || '-'}`);
          if (rec.repo || rec.branch) {
            const repoShort = rec.repo?.replace(/^\/Users\/[^/]+\//, '~/') || '-';
            parts.push(`**源码位置**: ${repoShort} @ \`${rec.branch || 'main'}\``);
          }
          parts.push(`**触发词匹配**: ${r.matchedTriggers.join(', ')}`);

          // Insight 专用段
          if (rec.conclusion) {
            parts.push('');
            parts.push('### 结论');
            parts.push(rec.conclusion);
          }
          if (rec.why) {
            parts.push('');
            parts.push('### 原因');
            parts.push(rec.why);
          }
          if (rec.when_to_apply) {
            parts.push('');
            parts.push('### 适用场景');
            parts.push(rec.when_to_apply);
          }

          // Recipe 段
          const steps = Array.isArray(rec.steps) ? rec.steps : [];
          const files = Array.isArray(rec.files) ? rec.files : [];
          const gotchas = Array.isArray(rec.gotchas) ? rec.gotchas : [];
          const corrections = Array.isArray(rec.corrections) ? rec.corrections : [];
          const changelog = Array.isArray(rec.changelog) ? rec.changelog : [];

          if (steps.length > 0) {
            parts.push('');
            parts.push('### 实现步骤');
            steps.forEach((s, j) => parts.push(`${j + 1}. ${s}`));
          }

          if (files.length > 0) {
            parts.push('');
            parts.push('### 涉及文件');
            files.forEach(f => parts.push(`- \`${f.path}\` — ${f.description}`));
          }

          if (gotchas.length > 0) {
            parts.push('');
            parts.push('### 已知坑点');
            gotchas.forEach(g => parts.push(`- ⚠️ ${g}`));
          }

          if (corrections.length > 0) {
            parts.push('');
            parts.push('### 用户纠正');
            corrections.forEach(c => parts.push(`- 🔴 ${c}`));
          }

          if (changelog.length > 0) {
            parts.push('');
            parts.push('### Changelog');
            changelog.forEach(e => parts.push(`- ${e.date}: ${e.description}`));
          }

          // 过时提示
          const staleReasons = recallStaleMap.get(rec.id);
          if (staleReasons) {
            parts.push('');
            parts.push(`> ⚠️ 注意: 此 recipe 可能过时 — ${staleReasons.join(', ')}`);
          }

          return parts.join('\n');
        }).join('\n\n---\n\n');

        return { content: [{ type: 'text', text }] };
      }

      // ── brain_list ──
      case 'brain_list': {
        let recipes = index.recipes;

        if (args.project) {
          recipes = recipes.filter(r => r.project === String(args.project));
        }
        if (args.tag) {
          const tag = String(args.tag).toLowerCase();
          recipes = recipes.filter(r => r.tags?.some(t => t.toLowerCase() === tag));
        }
        if (args.framework) {
          const fw = String(args.framework).toLowerCase();
          recipes = recipes.filter(r => r.framework?.toLowerCase() === fw);
        }

        if (recipes.length === 0) {
          return { content: [{ type: 'text', text: 'Recipe 库为空。' }] };
        }

        // 检测过时 recipe
        const staleSignals = checkRecipeStaleness(index);
        const staleMap = new Map(staleSignals.map(s => [s.recipeId, s.reasons]));

        const text = recipes.map(r => {
          const typeIcon = r.type === 'insight' ? '💡' : '📋';
          const fw = r.framework ? `[${r.framework}]` : '';
          const proj = r.project ? `(${r.project})` : '';
          const staleTag = staleMap.has(r.id) ? ` ⚠️[${staleMap.get(r.id)!.join(', ')}]` : '';
          return `- ${typeIcon} **${r.id}**: ${r.summary} ${fw} ${proj} — ${r.triggers.slice(0, 3).join(', ')}${staleTag}`;
        }).join('\n');

        // 健康摘要
        const health = getRecipeHealthSummary(index);
        const healthLine = `\n---\n**健康**: ${health.total} recipes — ${health.active} 活跃, ${health.stale} 过时, ${health.deprecated} 已降权`;

        return { content: [{ type: 'text', text: `共 ${recipes.length} 个 recipe:\n\n${text}${healthLine}` }] };
      }

      // ── brain_bootstrap ──
      case 'brain_bootstrap': {
        if (!args.repo) {
          return { content: [{ type: 'text', text: 'brain_bootstrap 需要 repo 路径。' }], isError: true };
        }

        // 有 thread 参数 → 恢复具体对话（原有行为）
        if (args.thread) {
          if (!getThreadById(String(args.repo), String(args.thread))) {
            return {
              content: [{ type: 'text', text: `thread 不存在或不属于当前 repo: ${String(args.thread)}` }],
              isError: true,
            };
          }

          const qr = bootstrapQuick({
            task: String(args.task),
            repo: String(args.repo),
            thread: String(args.thread),
          });

          return { content: [{ type: 'text', text: formatQuickResume(qr) }] };
        }

        // 无 thread → 项目级视图：board 信号 + 最近 thread 详情 + recipe 推送
        const signals = checkBoards();
        const threads = listRecentThreads(String(args.repo), 5);

        const lines: string[] = [];
        lines.push(`> **任务**: ${String(args.task)}`);

        // 自动推送匹配的 recipe（不更新访问统计，避免污染衰减信号）
        const recallHints = searchRecipes(index, String(args.task), 3)
          .filter(r => r.score > 0.5);
        if (recallHints.length > 0) {
          lines.push('\n**相关经验**');
          for (const r of recallHints) {
            lines.push(`  - \`${r.recipe.id}\` — ${r.recipe.summary}`);
          }
        }

        // Board 信号
        if (signals.length > 0) {
          lines.push('\n**项目看板**');
          for (const s of signals.slice(0, 5)) {
            const icon = s.type === 'overdue' ? '🔴' : s.type === 'deadline_soon' ? '🟡' : s.type === 'stale' ? '⚠️' : '📋';
            lines.push(`  ${icon} **${s.project}** — ${s.message}`);
          }
        }

        // 最近 thread 详情（恢复对话内容）
        const bestThread = findBestThread(
          String(args.repo),
          String(args.task),
        );

        if (bestThread) {
          // 恢复 thread 详情，但不标记 resumed（下次还能看到）
          const details = loadThreadDetails(bestThread);
          const repoName = bestThread.repo.split('/').pop() || bestThread.repo;

          lines.push(`\n**上次进度** (${repoName})`);
          lines.push(`  \`${bestThread.id}\` — ${bestThread.task}`);
          if (details.nextSteps.length > 0) {
            lines.push('  待续:');
            details.nextSteps.forEach(s => lines.push(`    - ${s}`));
          }
          if (details.decisions.length > 0) {
            lines.push('  决策:');
            details.decisions.forEach(d => lines.push(`    - ${d}`));
          }
        } else if (threads.length > 0) {
          // 没有匹配的 thread，显示列表
          lines.push('\n**最近对话**');
          const grouped = new Map<string, typeof threads>();
          for (const t of threads) {
            const key = t.repo.split('/').pop() || t.repo;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(t);
          }
          for (const [repoName, repoThreads] of grouped) {
            const ids = repoThreads.map(t => t.id).join('  ');
            lines.push(`  ${repoName}/  ${ids}`);
          }
          lines.push('');
        } else if (signals.length === 0) {
          lines.push('\n新任务，直接开始。');
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // ── brain_checkpoint ──
      case 'brain_checkpoint': {
        if (!args.repo || !args.task || !args.status) {
          return {
            content: [{ type: 'text', text: 'brain_checkpoint 需要 repo、task、status。' }],
            isError: true,
          };
        }

        const result = checkpoint({
          repo: String(args.repo),
          task: String(args.task),
          branch: args.branch ? String(args.branch) : undefined,
          parent: args.parent ? String(args.parent) : undefined,
          decisions: (args.decisions as string[]) || [],
          changes: (args.changes as string[]) || [],
          findings: (args.findings as string[]) || [],
          next: (args.next as string[]) || [],
          status: String(args.status),
        });

        const receipt = formatDistillReceipt(result);

        // 推送蒸馏回执到飞书（静默，不阻塞）
        try {
          const repoName = String(args.repo).split('/').pop() || '';
          const msg = `**MindKeeper** · ${repoName}\\n${String(args.status)}\\n${result.threadId}`;
          const larkBin = process.env.LARK_CLI_PATH || '/Users/xin/.nvm/versions/node/v22.19.0/bin/lark-cli';
          execSync(
            `printf '${msg.replace(/'/g, "'\\''")}' | xargs -0 ${larkBin} im +messages-send --chat-id "oc_f7597f473db3fb959f979a9400abc2f2" --as bot --markdown`,
            { timeout: 5000, stdio: 'ignore', shell: '/bin/bash' },
          );
        } catch { /* 推送失败不影响蒸馏 */ }

        return { content: [{ type: 'text', text: receipt }] };
      }

      // ── brain_threads ──
      case 'brain_threads': {
        const repo = args.repo ? String(args.repo) : undefined;
        const threads = listRecentThreads(repo, 50);

        if (threads.length === 0) {
          return { content: [{ type: 'text', text: repo ? `${repo} 没有待恢复的 thread。` : '没有待恢复的 thread。' }] };
        }

        const grouped = new Map<string, typeof threads>();
        for (const t of threads) {
          const key = t.repo || '(unknown)';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(t);
        }

        const lines: string[] = [`共 ${threads.length} 个待恢复 thread:\n`];
        for (const [repoName, repoThreads] of grouped) {
          const short = repoName.replace(/^\/Users\/[^/]+\//, '~/');
          lines.push(`**${short}**`);
          for (const t of repoThreads) {
            const age = Math.round((Date.now() - t.createdAtMs) / 86400000);
            const ageStr = age === 0 ? '今天' : `${age}天前`;
            lines.push(`  \`${t.id}\` ${ageStr} — ${t.task.slice(0, 60)}`);
          }
          lines.push('');
        }

        lines.push('恢复方式：发送 thread id（如 `dst-20260326-xxx`）');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // ── brain_board ──
      case 'brain_board': {
        const project = String(args.project || '');
        const action = String(args.action || 'read');

        switch (action) {
          case 'list': {
            const summaries = listBoardSummaries();
            if (summaries.length === 0) {
              return { content: [{ type: 'text', text: '没有项目看板。用 brain_board 添加第一个项目。' }] };
            }
            const lines = [`共 ${summaries.length} 个项目看板:\n`];
            for (const s of summaries) {
              const statusIcon = s.activeCount === 0 ? '✅' : '📋';
              lines.push(`  ${statusIcon} **${s.project}** — ${s.activeCount} 项待办 (更新: ${s.lastUpdated})`);
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          case 'read': {
            const board = loadBoard(project);
            if (!board) {
              return { content: [{ type: 'text', text: `项目 "${project}" 的看板不存在。用 action="write" 创建。` }] };
            }
            const lines = formatBoard(board);
            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          case 'write': {
            const data = args.data as Record<string, any>;
            if (!data) {
              return { content: [{ type: 'text', text: 'action="write" 需要 data 参数。' }], isError: true };
            }
            const board = createBoard(data.project || project, data.repo, data.stale_warning_days);
            board.quadrants = data.quadrants || board.quadrants;
            board.memos = data.memos || board.memos;
            saveBoard(board);
            return { content: [{ type: 'text', text: `已创建/更新项目看板: ${board.project}` }] };
          }

          case 'add_item': {
            const title = String(args.title || '');
            const quadrant = (args.quadrant as QuadrantKey) || 'q2';
            const item = addBoardItem(project, title, quadrant, {
              deadline: args.deadline ? String(args.deadline) : undefined,
              assignee: args.assignee ? String(args.assignee) : undefined,
              source: args.source ? String(args.source) : undefined,
              source_ref: args.source_ref ? String(args.source_ref) : undefined,
            });
            if (!item) {
              return { content: [{ type: 'text', text: '添加失败。' }], isError: true };
            }
            return {
              content: [{
                type: 'text',
                text: `已添加到 ${QUADRANT_LABELS[quadrant]}: [${item.id}] ${item.title}${item.deadline ? ` (截止: ${item.deadline})` : ''}`,
              }],
            };
          }

          case 'update_item': {
            const itemId = String(args.item_id || '');
            const changes = (args.changes || {}) as Record<string, any>;
            const item = updateBoardItem(project, itemId, changes);
            if (!item) {
              return { content: [{ type: 'text', text: `未找到条目: ${itemId}` }], isError: true };
            }
            const changeDesc = Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(', ');
            let resultText = `已更新 [${itemId}]: ${changeDesc}`;
            // 完成时提示提取 recipe
            if (changes.status === 'done') {
              resultText += '\n\n💡 如果这项工作有可复用模式，考虑用 brain_learn 提取 recipe。';
            }
            return { content: [{ type: 'text', text: resultText }] };
          }

          case 'add_memo': {
            const text = String(args.text || '');
            if (!text) {
              return { content: [{ type: 'text', text: 'add_memo 需要 text 参数。' }], isError: true };
            }
            const memo = addBoardMemo(project, text, args.source ? String(args.source) : undefined);
            if (!memo) {
              return { content: [{ type: 'text', text: '添加备忘失败。' }], isError: true };
            }
            return { content: [{ type: 'text', text: `已添加备忘: ${text}` }] };
          }

          case 'archive': {
            const count = archiveStaleItems(project);
            return { content: [{ type: 'text', text: count > 0 ? `已归档 ${count} 个过期条目。` : '没有需要归档的条目。' }] };
          }

          default:
            return { content: [{ type: 'text', text: `未知操作: ${action}` }], isError: true };
        }
      }

      // ── brain_check ──
      case 'brain_check': {
        const deadlineDays = Number(args.deadline_days) || undefined;
        const signals = checkBoards({ deadlineDays });

        // 自动降权过时 recipe
        const deprecation = deprecateStaleRecipes(index);

        const lines: string[] = [];

        if (signals.length > 0) {
          // 按项目分组，只保留最重要的信号
          const projectSignals = new Map<string, BoardSignal>();
          for (const s of signals) {
            const existing = projectSignals.get(s.project);
            // 优先级：overdue > deadline_soon > stale > stale_item > active
            const priorityMap: Record<string, number> = { overdue: 0, deadline_soon: 1, stale: 2, stale_item: 3, active: 4 };
            const priority = priorityMap[s.type] ?? 5;
            const existingPriority = existing ? (priorityMap[existing.type] ?? 5) : 99;
            if (priority < existingPriority) {
              projectSignals.set(s.project, s);
            }
          }

          lines.push('**项目看板**\n');
          for (const [_project, signal] of projectSignals) {
            const icon = signal.type === 'overdue' ? '🔴' : signal.type === 'deadline_soon' ? '🟡' : signal.type === 'stale' ? '⚠️' : signal.type === 'stale_item' ? '💤' : '📋';
            lines.push(`  ${icon} **${signal.project}** — ${signal.message}`);
          }

          // 额外的紧急信号
          const urgentSignals = signals.filter(s => s.type === 'overdue' || s.type === 'deadline_soon');
          if (urgentSignals.length > 1) {
            lines.push('\n紧急事项:');
            for (const s of urgentSignals) {
              const icon = s.type === 'overdue' ? '🔴' : '🟡';
              lines.push(`  ${icon} [${s.project}] ${s.message}`);
            }
          }
        }

        // Recipe 健康
        const recipeStaleSignals = checkRecipeStaleness(index);
        if (recipeStaleSignals.length > 0 || deprecation.deprecated.length > 0) {
          lines.push('\n**Recipe 健康**');
          lines.push(`  ${deprecation.total} 个 — ${deprecation.active} 活跃, ${deprecation.stale} 过时, ${deprecation.deprecatedCount} 已降权`);

          if (deprecation.deprecated.length > 0) {
            lines.push(`  🔻 本次降权: ${deprecation.deprecated.join(', ')}`);
          }

          const topStale = recipeStaleSignals.slice(0, 3);
          for (const s of topStale) {
            lines.push(`  ⚠️ ${s.recipeId}: ${s.reasons.join(', ')}`);
          }
        }

        if (lines.length === 0) {
          return { content: [{ type: 'text', text: '所有项目状态正常，无信号。' }] };
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      default:
        return { content: [{ type: 'text', text: `未知工具: ${name}` }] };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `错误: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

function formatBoard(board: Board): string[] {
  const lines: string[] = [];
  lines.push(`# ${board.project}`);
  if (board.repo) lines.push(`repo: ${board.repo}`);
  lines.push(`更新: ${board.last_updated} | stale 警告: ${board.stale_warning_days || 14} 天`);

  const icons = ['🔴', '🟡', '🟢', '⚪'] as const;

  for (let i = 0; i < QUADRANT_KEYS.length; i++) {
    const qk = QUADRANT_KEYS[i];
    const items = board.quadrants[qk].filter(item => item.status !== 'archived');
    lines.push(`\n${icons[i]} ${QUADRANT_LABELS[qk]}`);

    if (items.length === 0) {
      lines.push('  (空)');
      continue;
    }

    for (const item of items) {
      const statusMark = item.status === 'done' ? '~~' : '';
      let line = `  - [${item.id}] ${statusMark}${item.title}${statusMark}`;
      if (item.deadline) line += ` (${item.deadline})`;
      if (item.assignee) line += ` @${item.assignee}`;
      if (item.status === 'done') line += ' ✓';
      lines.push(line);
    }
  }

  if (board.memos.length > 0) {
    lines.push('\n📝 备忘');
    for (const m of board.memos) {
      lines.push(`  - ${m.text} (${m.created})`);
    }
  }

  return lines;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MindKeeper MCP server v2.0 started');
  console.error(`Loaded ${index.recipes.length} recipes from index`);
}

main().catch(console.error);
