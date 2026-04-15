/**
 * distill.ts — 上下文蒸馏 & checkpoint
 *
 * 单一 pipeline，两个入口：
 * - brain_checkpoint (MCP tool) — AI 自己调用
 * - /distill (planned skill) — 用户手动触发
 *
 * 输出和 bootstrap reader 对齐的 thread frontmatter。
 */
export interface DistillInput {
    repo: string;
    task: string;
    branch?: string;
    parent?: string;
    cli?: string;
    model?: string;
    decisions: string[];
    changes: string[];
    findings: string[];
    next: string[];
    status: string;
}
export interface DistillHint {
    type: 'recipe_candidate' | 'board_done' | 'next_to_board';
    message: string;
    data?: Record<string, unknown>;
}
export interface SplitThread {
    threadId: string;
    repo: string;
    path: string;
}
export interface DistillResult {
    success: boolean;
    threadId: string;
    path: string;
    repo: string;
    repoSource: 'git' | 'history' | 'parent' | 'raw';
    parent?: string;
    stats: {
        decisions: number;
        changes: number;
        findings: number;
        next: number;
    };
    relatedBoardItems?: Array<{
        project: string;
        itemId: string;
        title: string;
    }>;
    hints?: DistillHint[];
    /** 多 repo 拆分时的其他 thread */
    splitThreads?: SplitThread[];
    sessionIndexPath?: string;
}
export declare function checkpoint(input: DistillInput): DistillResult;
export declare function formatDistillReceipt(result: DistillResult): string;
