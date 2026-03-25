#!/usr/bin/env node
/**
 * MindKeeper MCP Server
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
import { isPinRequest, pin, pinDirect, loadHighlights } from './pin.js';
import { listProcedures, loadProcedure, parseProcedure, planExecution, formatStepPrompt } from './procedure.js';
import { guide, getContextState } from './guide.js';
import { bootstrap, formatWorkingSet } from './bootstrap.js';
import type { BrainIndex, Unit } from './types.js';
import type { ExecutionContext } from './procedure.js';

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
    {
      name: 'brain_pin',
      description: '📌 Pin 重要内容到 HIGHLIGHTS.md。用于保存用户标记的关键信息。',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要 pin 的内容' },
          title: { type: 'string', description: '标题（可选，自动从内容提取）' },
          category: { type: 'string', description: '分类（可选）' },
          source: { type: 'string', description: '来源（可选，如项目名或会话 ID）' },
        },
        required: ['content'],
      },
    },
    {
      name: 'brain_highlights',
      description: '查看所有 pinned highlights。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'brain_procedures',
      description: '列出所有可用的 Procedure（多步骤工作流）。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'brain_procedure',
      description: '获取指定 Procedure 的详情和执行计划。',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Procedure 名称' },
          input: { type: 'string', description: '输入内容（用于变量插值）' },
        },
        required: ['name'],
      },
    },
    {
      name: 'brain_learn',
      description: '触发学习回路，从输入中学习并记录。',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: '要学习的内容' },
          type: { type: 'string', description: '信号类型：Failure/Missing/Inefficiency/Suggestion/Discovery' },
        },
        required: ['input'],
      },
    },
    {
      name: 'brain_guide',
      description: '获取下一步建议。读取当前状态，智能推荐下一步该做什么。',
      inputSchema: {
        type: 'object',
        properties: {
          context: { type: 'string', description: '当前上下文（可选，用于更精准的建议）' },
        },
      },
    },
    {
      name: 'brain_status',
      description: '查看 MindKeeper 的当前状态：observations、evidence、threads 等。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'brain_bootstrap',
      description: '任务启动入口。输入 repo + task，输出完整的 Working Set：规则、procedure、thread、风险点、建议文件、下一步。在开始任何任务前先调用这个。',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '当前任务描述' },
          repo: { type: 'string', description: '当前仓库路径' },
          branch: { type: 'string', description: '当前 Git 分支' },
          recentFiles: {
            type: 'array',
            items: { type: 'string' },
            description: '最近修改的文件路径',
          },
        },
        required: ['task'],
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

      case 'brain_pin': {
        const content = String(args.content);
        const result = pinDirect(content, {
          title: args.title ? String(args.title) : undefined,
          category: args.category ? String(args.category) : undefined,
          source: args.source ? String(args.source) : undefined,
        });

        if (!result.success) {
          return { content: [{ type: 'text', text: `Pin 失败: ${result.error}` }], isError: true };
        }

        return {
          content: [{
            type: 'text',
            text: `📌 已 pin: **${result.entry!.title}**\n分类: ${result.entry!.category || 'Uncategorized'}\n日期: ${result.entry!.date}`,
          }],
        };
      }

      case 'brain_highlights': {
        const highlights = loadHighlights();
        return { content: [{ type: 'text', text: highlights }] };
      }

      case 'brain_procedures': {
        const procedures = listProcedures();
        if (procedures.length === 0) {
          return { content: [{ type: 'text', text: '暂无可用的 Procedure。' }] };
        }

        const text = procedures.map(p =>
          `- **${p.name}**: ${p.description || '无描述'}\n  触发词: ${Array.isArray(p.trigger) ? p.trigger.join(', ') : p.trigger || '无'}`
        ).join('\n\n');

        return { content: [{ type: 'text', text: `## 可用的 Procedure\n\n${text}` }] };
      }

      case 'brain_procedure': {
        const name = String(args.name);
        const procedure = loadProcedure(name);
        if (!procedure) {
          return { content: [{ type: 'text', text: `Procedure "${name}" 不存在。` }] };
        }

        const context: ExecutionContext = {
          input: args.input ? String(args.input) : '',
          results: {},
          variables: {},
        };

        const plan = planExecution(procedure, context);

        let text = `## Procedure: ${procedure.meta.name}\n\n`;
        text += `${procedure.meta.description || ''}\n\n`;
        text += `**默认模型**: ${procedure.meta.defaultModel || 'auto'}\n\n`;
        text += `### 执行计划 (${plan.length} 步)\n\n`;

        plan.forEach((step, i) => {
          const prompt = formatStepPrompt(step, context);
          text += `#### Step ${step.index}: ${step.name} (${step.model}${step.optional ? ', optional' : ''})\n\n`;
          text += `${step.content.slice(0, 200)}${step.content.length > 200 ? '...' : ''}\n\n`;
        });

        return { content: [{ type: 'text', text }] };
      }

      case 'brain_learn': {
        const input = String(args.input);
        const signalType = args.type ? String(args.type) : 'Discovery';

        // 加载学习回路 Procedure
        const procedure = loadProcedure('learning-loop');
        if (!procedure) {
          return { content: [{ type: 'text', text: '学习回路 Procedure 未找到，请先创建 learning-loop.md' }] };
        }

        const context: ExecutionContext = {
          input,
          results: {},
          variables: { signalType },
        };

        const plan = planExecution(procedure, context);

        // 返回第一步的 prompt（实际执行需要多轮调用）
        const firstStep = plan[0];
        if (!firstStep) {
          return { content: [{ type: 'text', text: '学习回路无可执行步骤。' }] };
        }

        const prompt = formatStepPrompt(firstStep, context);

        return {
          content: [{
            type: 'text',
            text: `## 学习回路启动\n\n` +
              `**输入**: ${input.slice(0, 100)}${input.length > 100 ? '...' : ''}\n` +
              `**信号类型**: ${signalType}\n` +
              `**计划步骤**: ${plan.length}\n\n` +
              `---\n\n${prompt}`,
          }],
        };
      }

      case 'brain_guide': {
        const contextStr = args.context ? String(args.context) : undefined;
        const suggestion = guide(contextStr);
        return { content: [{ type: 'text', text: `## MindKeeper，下一步？\n\n${suggestion}` }] };
      }

      case 'brain_status': {
        const state = getContextState();
        let text = `## MindKeeper 状态\n\n`;
        text += `- **Observations**: ${state.recentObservations.length} 条最近\n`;
        text += `- **Evidence**: ${state.recentEvidence.length} 条最近\n`;
        text += `- **Threads**: ${state.activeThreads.length} 个活跃\n`;
        text += `- **Procedures**: ${state.availableProcedures.length} 个可用\n`;

        if (state.recentObservations.length > 0) {
          text += `\n### 最近的 Observations\n`;
          state.recentObservations.forEach(o => text += `- ${o}\n`);
        }

        if (state.availableProcedures.length > 0) {
          text += `\n### 可用的 Procedures\n`;
          state.availableProcedures.forEach(p => text += `- ${p}\n`);
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'brain_bootstrap': {
        const taskDesc = String(args.task);
        const ws = bootstrap({
          task: taskDesc,
          repo: args.repo ? String(args.repo) : undefined,
          branch: args.branch ? String(args.branch) : undefined,
          recentFiles: args.recentFiles as string[] | undefined,
        });

        const text = formatWorkingSet(ws);
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
  console.error('MindKeeper MCP server started');
  console.error(`Loaded ${index.units.length} knowledge units from index`);
}

main().catch(console.error);
