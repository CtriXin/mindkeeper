#!/usr/bin/env node
/**
 * MindKeeper MCP Server
 *
 * Startup tools (5): brain_bootstrap / brain_checkpoint / brain_recall / brain_check / brain_extend
 * Extended tools (3, loaded via brain_extend): brain_learn / brain_board / brain_list
 *
 * 业务逻辑在 handlers.ts，此文件只负责 MCP 协议层和路由分发。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadIndex } from './storage.js';
import {
  handleLearn, handleRecall, handleList,
  handleBootstrap, handleCheckpoint, handleThreads,
  handleBoard, handleCheck,
} from './handlers.js';

const index = loadIndex();

const server = new Server(
  { name: 'mindkeeper', version: '2.2.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// ── 懒加载状态 ──

let extended = false;

// ── 工具定义 ──

const CORE_TOOLS = [
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
    name: 'brain_recall',
    description: '根据任务描述查找相关 recipe，返回实现步骤、涉及文件、已知坑点和用户纠正。\n在新项目开始类似任务时调用，获取跨项目的实现经验。',
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
    name: 'brain_check',
    description: '扫描所有项目 board，返回需要关注的信号。轻量调用，只返回有信号的项。\n信号类型: deadline_soon/overdue/stale/active',
    inputSchema: {
      type: 'object',
      properties: {
        deadline_days: { type: 'number', description: '提前多少天提醒 deadline（默认 7）' },
      },
    },
  },
];

const EXTEND_STUB = {
  name: 'brain_extend',
  description: 'Load learn/board/list tools.',
  inputSchema: { type: 'object' as const, properties: {} },
};

const EXTENDED_TOOLS = [
  {
    name: 'brain_learn',
    description: '存储可复用知识。recipe: 步骤+文件+坑点; insight: 结论+原因+场景。id 已存在则更新并追加 changelog。\n调用前先询问用户"要不要存个 recipe/insight"，用户明确说"存"时直接调用。',
    inputSchema: {
      type: 'object',
      properties: {
        triggers: {
          type: 'array', items: { type: 'string' },
          description: '触发词（中英文皆可，如 ["广告延迟加载", "ad lazy load"]）',
        },
        summary: { type: 'string', description: '一句话摘要' },
        type: { type: 'string', enum: ['recipe', 'insight'], description: '知识类型，默认 recipe' },
        steps: { type: 'array', items: { type: 'string' }, description: 'recipe: 实现步骤（有序）' },
        files: { type: 'string', description: 'recipe: JSON array string，如 [{"path":"src/foo.ts","description":"added handler"}]' },
        gotchas: { type: 'array', items: { type: 'string' }, description: '已知坑点和注意事项' },
        corrections: { type: 'array', items: { type: 'string' }, description: '用户纠正过的错误（最有价值的知识）' },
        conclusion: { type: 'string', description: 'insight: 核心结论' },
        why: { type: 'string', description: 'insight: 为什么得出这个结论' },
        when_to_apply: { type: 'string', description: 'insight: 什么场景下应用这个认知' },
        meta: { type: 'string', description: 'JSON string: {"id","repo","branch","framework","project","tags","confidence","changelog_note"}' },
      },
      required: ['triggers', 'summary'],
    },
  },
  {
    name: 'brain_board',
    description: '四象限看板 CRUD + 备忘。action: read/write/add_item/update_item/add_memo/list/archive',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目名或 slug' },
        action: {
          type: 'string',
          enum: ['read', 'write', 'add_item', 'update_item', 'add_memo', 'list', 'archive'],
          description: '操作类型',
        },
        data: { type: 'string', description: 'write: JSON string of complete board data' },
        title: { type: 'string', description: 'add_item: 标题' },
        quadrant: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'], description: 'add_item: 象限（默认 q2）' },
        item_id: { type: 'string', description: 'update_item: 条目 id' },
        changes: { type: 'string', description: 'update_item: JSON string {title?,deadline?,status?,quadrant?,assignee?}' },
        deadline: { type: 'string', description: 'add_item: YYYY-MM-DD' },
        assignee: { type: 'string', description: 'add_item: 负责人' },
        source: { type: 'string', description: 'add_item/add_memo: 来源' },
        source_ref: { type: 'string', description: 'add_item: 来源引用' },
        text: { type: 'string', description: 'add_memo: 备忘文本' },
      },
      required: ['project', 'action'],
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
];

// ── 工具注册（懒加载）──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: extended
    ? [...CORE_TOOLS, ...EXTENDED_TOOLS]
    : [...CORE_TOOLS, EXTEND_STUB],
}));

// ── Resources（AI 自动拉取，无需调 tool） ──

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'mindkeeper://recipes',
      name: 'Recipe 知识库摘要',
      description: '所有已存储 recipe/insight 的 ID、触发词和一句话摘要。AI 可据此判断是否需要 brain_recall 获取详情。',
      mimeType: 'text/plain',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'mindkeeper://recipes') {
    const recipes = index.recipes;
    if (recipes.length === 0) {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: 'Recipe 库为空。',
        }],
      };
    }

    const lines = recipes.map(r => {
      const icon = r.type === 'insight' ? '💡' : '📋';
      const triggers = r.triggers.slice(0, 3).join('/');
      return `${icon} ${r.id}: ${r.summary} [${triggers}]`;
    });

    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `MindKeeper 知识库 (${recipes.length} 条):\n${lines.join('\n')}`,
      }],
    };
  }

  return {
    contents: [{
      uri,
      mimeType: 'text/plain',
      text: `未知资源: ${uri}`,
    }],
  };
});

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
      case 'brain_board':     return handleBoard(args);
      case 'brain_check':     return handleCheck(args, index);
      case 'brain_extend':
        extended = true;
        await server.notification({ method: 'notifications/tools/list_changed', params: {} });
        return { content: [{ type: 'text', text: 'Extended tools (learn, board, list) now available.' }] };
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
  console.error('MindKeeper MCP server v2.2 started');
  console.error(`Loaded ${index.recipes.length} recipes from index`);
}

main().catch(console.error);
