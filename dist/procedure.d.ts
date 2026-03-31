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
/** 解析 Procedure Markdown */
export declare function parseProcedure(content: string): Procedure;
/** 变量插值 */
export declare function interpolate(template: string, context: ExecutionContext): string;
/** 检查条件是否满足 */
export declare function checkCondition(condition: string, context: ExecutionContext): boolean;
/** 加载 Procedure 文件 */
export declare function loadProcedure(name: string): Procedure | null;
/** 保存 Procedure 文件 */
export declare function saveProcedure(procedure: Procedure): void;
/** 列出所有 Procedure */
export declare function listProcedures(): ProcedureMeta[];
/** 根据触发词查找 Procedure */
export declare function findProcedureByTrigger(trigger: string): Procedure | null;
/** 生成 Procedure 的执行计划 */
export declare function planExecution(procedure: Procedure, context: ExecutionContext): ProcedureStep[];
/** 格式化步骤为可执行的 prompt */
export declare function formatStepPrompt(step: ProcedureStep, context: ExecutionContext): string;
