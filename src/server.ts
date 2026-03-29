#!/usr/bin/env node
/**
 * MindKeeper MCP Server — 8 tools
 *
 * Knowledge: brain_learn / brain_recall / brain_list
 * Distill:   brain_bootstrap / brain_checkpoint / brain_threads
 * Board:     brain_board / brain_check
 *
 * 业务逻辑在 handlers.ts，此文件只负责 MCP 协议层和路由分发。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadIndex } from './storage.js';
import {
  handleLearn, handleRecall, handleList,
  handleBootstrap, handleCheckpoint, handleThreads,
  handleBoard, handleCheck,
} from './handlers.js';

const index = loadIndex();

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
          steps: { type: 'array', items: { type: 'string' }, description: 'recipe: 实现步骤（有序）' },
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
          gotchas: { type: 'array', items: { type: 'string' }, description: '已知坑点和注意事项' },
          corrections: { type: 'array', items: { type: 'string' }, description: '用户纠正过的错误（最有价值的知识）' },
          conclusion: { type: 'string', description: 'insight: 核心结论' },
          why: { type: 'string', description: 'insight: 为什么得出这个结论' },
          when_to_apply: { type: 'string', description: 'insight: 什么场景下应用这个认知' },
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
          data: { type: 'object', description: 'write 时的完整 board 数据' },
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

// ── 工具路由 ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;

  try {
    switch (name) {
      case 'brain_learn':     return handleLearn(args, index);
      case 'brain_recall':    return handleRecall(args, index);
      case 'brain_list':      return handleList(args, index);
      case 'brain_bootstrap': return handleBootstrap(args, index);
      case 'brain_checkpoint': return handleCheckpoint(args);
      case 'brain_threads':   return handleThreads(args);
      case 'brain_board':     return handleBoard(args);
      case 'brain_check':     return handleCheck(args, index);
      default:
        return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `错误: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// ── 启动 ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MindKeeper MCP server v2.1 started');
  console.error(`Loaded ${index.recipes.length} recipes from index`);
}

main().catch(console.error);
