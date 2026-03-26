/**
 * Procedure Markdown 格式解析器
 *
 * 灵感来源：10x Superpowers
 * 设计理念：用 Markdown 定义可组合的多步骤工作流
 *
 * 格式示例：
 * ```markdown
 * ---
 * name: learn
 * trigger: 发现新知识
 * description: 7 段学习回路
 * defaultModel: fast
 * ---
 *
 * ## Step 1: Capture (model: fast)
 * 识别信号类型，提取关键词
 * {{input}}
 *
 * ## Step 2: Distill (model: smart)
 * 从 evidence 蒸馏出 observation
 * Based on: {{previous}}
 * ```
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getRealHome } from './env.js';

const SCE_DIR = join(getRealHome(), '.sce');
const PROCEDURES_DIR = join(SCE_DIR, 'procedures');

/** 模型层级 */
export type ModelTier = 'fast' | 'smart' | 'auto';

/** Procedure 元数据 */
export interface ProcedureMeta {
  name: string;
  trigger?: string | string[];
  description?: string;
  defaultModel?: ModelTier;
  tags?: string[];
}

/** Procedure 步骤 */
export interface ProcedureStep {
  /** 步骤编号 */
  index: number;
  /** 步骤名称 */
  name: string;
  /** 模型层级 */
  model: ModelTier;
  /** 是否可选 */
  optional: boolean;
  /** 条件表达式 */
  condition?: string;
  /** 步骤内容（prompt） */
  content: string;
}

/** 完整的 Procedure */
export interface Procedure {
  meta: ProcedureMeta;
  steps: ProcedureStep[];
  raw: string;
}

/** 执行上下文 */
export interface ExecutionContext {
  input: string;
  previous?: string;
  results: Record<string, string>;
  variables: Record<string, unknown>;
}

/** 解析 YAML frontmatter */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, unknown> = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;

    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // 解析数组 [a, b, c]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    }

    meta[key] = value;
  });

  return { meta, body: match[2] };
}

/** 解析步骤标题 */
function parseStepHeader(header: string): { index: number; name: string; model: ModelTier; optional: boolean; condition?: string } {
  // ## Step 1: Capture (model: fast, optional)
  // ## Step 2: Distill (model: smart, if: hasEvidence)

  const match = header.match(/^##\s*(?:Step\s*)?(\d+)?[:.：]?\s*([^(]+)(?:\(([^)]+)\))?/i);
  if (!match) {
    return { index: 0, name: header, model: 'auto', optional: false };
  }

  const index = match[1] ? parseInt(match[1], 10) : 0;
  const name = match[2].trim();
  const options = match[3] || '';

  let model: ModelTier = 'auto';
  let optional = false;
  let condition: string | undefined;

  options.split(',').forEach(opt => {
    const trimmed = opt.trim().toLowerCase();
    if (trimmed.startsWith('model:')) {
      const m = trimmed.slice(6).trim();
      if (m === 'fast' || m === 'smart' || m === 'auto') {
        model = m;
      }
    } else if (trimmed === 'optional') {
      optional = true;
    } else if (trimmed.startsWith('if:')) {
      condition = trimmed.slice(3).trim();
    }
  });

  return { index, name, model, optional, condition };
}

/** 解析 Procedure Markdown */
export function parseProcedure(content: string): Procedure {
  const { meta, body } = parseFrontmatter(content);

  const procedureMeta: ProcedureMeta = {
    name: String(meta.name || 'unnamed'),
    trigger: meta.trigger as string | string[] | undefined,
    description: meta.description ? String(meta.description) : undefined,
    defaultModel: (meta.defaultModel as ModelTier) || 'auto',
    tags: meta.tags as string[] | undefined,
  };

  // 按 ## 分割步骤
  const sections = body.split(/^(##\s+.+)$/m).filter(s => s.trim());
  const steps: ProcedureStep[] = [];

  let currentHeader = '';
  let stepIndex = 0;

  for (const section of sections) {
    if (section.startsWith('## ')) {
      currentHeader = section;
    } else if (currentHeader) {
      stepIndex++;
      const { index, name, model, optional, condition } = parseStepHeader(currentHeader);
      steps.push({
        index: index || stepIndex,
        name,
        model: model === 'auto' ? procedureMeta.defaultModel || 'auto' : model,
        optional,
        condition,
        content: section.trim(),
      });
      currentHeader = '';
    }
  }

  return {
    meta: procedureMeta,
    steps,
    raw: content,
  };
}

/** 变量插值 */
export function interpolate(template: string, context: ExecutionContext): string {
  return template
    .replace(/\{\{input\}\}/g, context.input)
    .replace(/\{\{previous\}\}/g, context.previous || '')
    .replace(/\{\{results\.(\w+)\}\}/g, (_, key) => context.results[key] || '')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = context.variables[key];
      return value !== undefined ? String(value) : `{{${key}}}`;
    });
}

/** 检查条件是否满足 */
export function checkCondition(condition: string, context: ExecutionContext): boolean {
  // 简单的条件检查：变量是否存在且非空
  const value = context.variables[condition] || context.results[condition];
  return !!value;
}

/** 加载 Procedure 文件 */
export function loadProcedure(name: string): Procedure | null {
  const path = join(PROCEDURES_DIR, `${name}.md`);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, 'utf-8');
  return parseProcedure(content);
}

/** 保存 Procedure 文件 */
export function saveProcedure(procedure: Procedure): void {
  if (!existsSync(PROCEDURES_DIR)) {
    mkdirSync(PROCEDURES_DIR, { recursive: true });
  }

  const path = join(PROCEDURES_DIR, `${procedure.meta.name}.md`);
  writeFileSync(path, procedure.raw);
}

/** 列出所有 Procedure */
export function listProcedures(): ProcedureMeta[] {
  if (!existsSync(PROCEDURES_DIR)) return [];

  return readdirSync(PROCEDURES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(join(PROCEDURES_DIR, f), 'utf-8');
      const proc = parseProcedure(content);
      return proc.meta;
    });
}

/** 根据触发词查找 Procedure */
export function findProcedureByTrigger(trigger: string): Procedure | null {
  const procedures = listProcedures();

  for (const meta of procedures) {
    const triggers = Array.isArray(meta.trigger) ? meta.trigger : [meta.trigger];
    if (triggers.some(t => t && trigger.toLowerCase().includes(t.toLowerCase()))) {
      return loadProcedure(meta.name);
    }
  }

  return null;
}

/** 生成 Procedure 的执行计划 */
export function planExecution(procedure: Procedure, context: ExecutionContext): ProcedureStep[] {
  return procedure.steps.filter(step => {
    // 跳过不满足条件的步骤
    if (step.condition && !checkCondition(step.condition, context)) {
      return false;
    }
    return true;
  });
}

/** 格式化步骤为可执行的 prompt */
export function formatStepPrompt(step: ProcedureStep, context: ExecutionContext): string {
  const header = `## ${step.name}`;
  const content = interpolate(step.content, context);
  return `${header}\n\n${content}`;
}
