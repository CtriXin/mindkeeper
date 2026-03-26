#!/usr/bin/env node
/**
 * MindKeeper MCP Server — 8 tools
 *
 * 知识 CRUD: brain_search / brain_store / brain_update / brain_forget / brain_list
 * Distill 链路: brain_bootstrap / brain_checkpoint / brain_threads
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadIndex, saveIndex, loadUnit, saveUnit, deleteUnit, metaFromUnit } from './storage.js';
import { search } from './router.js';
import { bootstrapQuick, formatQuickResume, getThreadById, listRecentThreads } from './bootstrap.js';
import { checkpoint, formatDistillReceipt } from './distill.js';
import type { BrainIndex, Unit } from './types.js';

// 启动时加载索引（唯一的初始 IO）
let index: BrainIndex = loadIndex();

const server = new Server(
  { name: 'mindkeeper', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// 定义工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'brain_search',
      description: '语义检索知识库。返回与查询最相关的知识单元。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '自然语言查询' },
          limit: { type: 'number', description: '返回数量，默认 5', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'brain_store',
      description: '存入新知识。知识会持久化到文件系统。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '唯一标识符（英文，用于文件名）' },
          triggers: {
            type: 'array',
            items: { type: 'string' },
            description: '触发词列表（何时应该召回这个知识）',
          },
          summary: { type: 'string', description: '一句话摘要' },
          content: { type: 'string', description: '完整内容（Markdown）' },
          project: { type: 'string', description: '来源项目' },
          confidence: { type: 'number', description: '置信度 0-1，默认 0.8', default: 0.8 },
          tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        },
        required: ['id', 'triggers', 'summary', 'content'],
      },
    },
    {
      name: 'brain_update',
      description: '更新已有知识。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要更新的知识 ID' },
          triggers: { type: 'array', items: { type: 'string' }, description: '新的触发词' },
          summary: { type: 'string', description: '新的摘要' },
          content: { type: 'string', description: '新的内容' },
          confidence: { type: 'number', description: '新的置信度' },
        },
        required: ['id'],
      },
    },
    {
      name: 'brain_forget',
      description: '删除知识。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的知识 ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'brain_list',
      description: '列出所有知识主题。返回摘要列表，不返回完整内容。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '按项目过滤' },
          tag: { type: 'string', description: '按标签过滤' },
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
          parent: { type: 'string', description: '显式指定 parent thread id，避免并行任务串线' },
          decisions: {
            type: 'array', items: { type: 'string' },
            description: '做了什么决策（不超过 5 条）',
          },
          changes: {
            type: 'array', items: { type: 'string' },
            description: '改了哪些文件（文件路径 + 摘要）',
          },
          findings: {
            type: 'array', items: { type: 'string' },
            description: '过程中的发现和踩坑',
          },
          next: {
            type: 'array', items: { type: 'string' },
            description: '还没做完的、下一步要做的',
          },
          status: { type: 'string', description: '一句话总结当前状态' },
        },
        required: ['repo', 'task', 'status'],
      },
    },
    {
      name: 'brain_threads',
      description: '列出所有未过期的蒸馏 thread，按 repo 分组。用于查看跨项目的待恢复工作。',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: '可选，只看某个 repo 的 thread' },
        },
      },
    },
  ],
}));

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;

  try {
    switch (name) {
      case 'brain_search': {
        const results = search(index, String(args.query || ''), Number(args.limit) || 5);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: '未找到相关知识。' }] };
        }
        const text = results.map((r, i) =>
          `## ${i + 1}. ${r.unit.summary} (score: ${r.score.toFixed(2)})\n\n` +
          `**触发词**: ${r.matchedTriggers.join(', ')}\n\n` +
          `${r.unit.content}`
        ).join('\n\n---\n\n');
        return { content: [{ type: 'text', text }] };
      }

      case 'brain_store': {
        const unit: Unit = {
          id: String(args.id),
          triggers: (args.triggers as string[]) || [],
          summary: String(args.summary),
          content: String(args.content),
          project: args.project ? String(args.project) : undefined,
          confidence: Number(args.confidence) || 0.8,
          tags: (args.tags as string[]) || undefined,
          created: new Date().toISOString(),
          accessCount: 0,
        };

        // 检查是否已存在
        if (index.units.find(u => u.id === unit.id)) {
          return { content: [{ type: 'text', text: `知识 "${unit.id}" 已存在，请使用 brain_update 更新。` }] };
        }

        saveUnit(unit);
        index.units.push(metaFromUnit(unit));
        saveIndex(index);

        return { content: [{ type: 'text', text: `已存入知识: ${unit.id}\n触发词: ${unit.triggers.join(', ')}` }] };
      }

      case 'brain_update': {
        const id = String(args.id);
        const existing = loadUnit(id);
        if (!existing) {
          return { content: [{ type: 'text', text: `知识 "${id}" 不存在。` }] };
        }

        // 合并更新
        if (args.triggers) existing.triggers = args.triggers as string[];
        if (args.summary) existing.summary = String(args.summary);
        if (args.content) existing.content = String(args.content);
        if (args.confidence !== undefined) existing.confidence = Number(args.confidence);

        saveUnit(existing);

        // 更新索引
        const metaIdx = index.units.findIndex(u => u.id === id);
        if (metaIdx >= 0) {
          index.units[metaIdx] = metaFromUnit(existing);
          saveIndex(index);
        }

        return { content: [{ type: 'text', text: `已更新知识: ${id}` }] };
      }

      case 'brain_forget': {
        const id = String(args.id);
        const deleted = deleteUnit(id);
        if (!deleted) {
          return { content: [{ type: 'text', text: `知识 "${id}" 不存在。` }] };
        }

        index.units = index.units.filter(u => u.id !== id);
        saveIndex(index);

        return { content: [{ type: 'text', text: `已删除知识: ${id}` }] };
      }

      case 'brain_list': {
        let units = index.units;

        if (args.project) {
          units = units.filter(u => u.project === String(args.project));
        }

        if (units.length === 0) {
          return { content: [{ type: 'text', text: '知识库为空。' }] };
        }

        const text = units.map(u =>
          `- **${u.id}**: ${u.summary} [${u.triggers.slice(0, 3).join(', ')}${u.triggers.length > 3 ? '...' : ''}]`
        ).join('\n');

        return { content: [{ type: 'text', text: `共 ${units.length} 条知识:\n\n${text}` }] };
      }

      case 'brain_bootstrap': {
        if (!args.repo) {
          return {
            content: [{ type: 'text', text: 'brain_bootstrap 需要 repo 路径。' }],
            isError: true,
          };
        }

        if (args.thread && !getThreadById(String(args.repo), String(args.thread))) {
          return {
            content: [{ type: 'text', text: `thread 不存在或不属于当前 repo: ${String(args.thread)}` }],
            isError: true,
          };
        }

        const qr = bootstrapQuick({
          task: String(args.task),
          repo: String(args.repo),
          thread: args.thread ? String(args.thread) : undefined,
        });

        const text = formatQuickResume(qr);
        return { content: [{ type: 'text', text }] };
      }

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

        return { content: [{ type: 'text', text: formatDistillReceipt(result) }] };
      }

      case 'brain_threads': {
        const repo = args.repo ? String(args.repo) : undefined;
        const threads = listRecentThreads(repo, 50);

        if (threads.length === 0) {
          return { content: [{ type: 'text', text: repo ? `${repo} 没有待恢复的 thread。` : '没有待恢复的 thread。' }] };
        }

        // 按 repo 分组
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

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MindKeeper MCP server started');
  console.error(`Loaded ${index.units.length} knowledge units from index`);
}

main().catch(console.error);
