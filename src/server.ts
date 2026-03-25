#!/usr/bin/env node
/**
 * agents-brain MCP Server
 *
 * 提供以下工具：
 * - brain_search: 语义检索
 * - brain_store: 存入新知识
 * - brain_update: 更新已有知识
 * - brain_forget: 删除知识
 * - brain_list: 列出所有主题
 * - brain_recall: 根据上下文自动召回
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadIndex, saveIndex, loadUnit, saveUnit, deleteUnit, metaFromUnit } from './storage.js';
import { search, recall, findRelated } from './router.js';
import type { BrainIndex, Unit } from './types.js';

// 启动时加载索引（唯一的初始 IO）
let index: BrainIndex = loadIndex();

const server = new Server(
  { name: 'agents-brain', version: '0.1.0' },
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
      name: 'brain_recall',
      description: '根据当前上下文自动召回相关知识。适合在开始工作前调用。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '当前项目名' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: '正在处理的文件路径',
          },
          errors: {
            type: 'array',
            items: { type: 'string' },
            description: '遇到的错误信息',
          },
        },
      },
    },
    {
      name: 'brain_related',
      description: '查找与指定知识相关的其他知识。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '知识 ID' },
          limit: { type: 'number', description: '返回数量，默认 3', default: 3 },
        },
        required: ['id'],
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

      case 'brain_recall': {
        const results = recall(index, {
          project: args.project ? String(args.project) : undefined,
          files: args.files as string[] | undefined,
          errors: args.errors as string[] | undefined,
        });

        if (results.length === 0) {
          return { content: [{ type: 'text', text: '无相关知识可召回。' }] };
        }

        const text = '**自动召回的相关知识:**\n\n' + results.map((r, i) =>
          `### ${i + 1}. ${r.unit.summary}\n\n${r.unit.content}`
        ).join('\n\n---\n\n');

        return { content: [{ type: 'text', text }] };
      }

      case 'brain_related': {
        const results = findRelated(index, String(args.id), Number(args.limit) || 3);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: '未找到相关知识。' }] };
        }

        const text = results.map(r =>
          `- **${r.unit.id}**: ${r.unit.summary} (相关度: ${r.score.toFixed(2)})`
        ).join('\n');

        return { content: [{ type: 'text', text }] };
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
  console.error('agents-brain MCP server started');
  console.error(`Loaded ${index.units.length} knowledge units from index`);
}

main().catch(console.error);
