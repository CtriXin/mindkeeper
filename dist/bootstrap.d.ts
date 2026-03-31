/**
 * brain_bootstrap v2 — 任务启动入口
 *
 * v1 → v2 改进：
 * 1. 读真实 Git 上下文（branch, status, recent commits）
 * 2. 读项目规则文件（CLAUDE.md, AGENT.md, .ai/plan/）
 * 3. 任务分类（bugfix, refactor, doc, setup）
 * 4. 精准推荐 3 个文件（带理由）
 * 5. 真实 thread/TODO 恢复信息
 * 6. 只推荐最相关的 1-2 个 procedure
 * 7. 更具体的 next action（不是泛文案）
 */
export interface BootstrapInput {
    task: string;
    repo?: string;
    thread?: string;
}
export interface ThreadSummary {
    id: string;
    repo: string;
    task: string;
    status: string;
    path: string;
    createdAtMs: number;
    branch?: string;
    parent?: string;
    ttl?: string;
    resumed?: string;
}
/** 按 repo 过滤 thread；repo 为空时返回所有 */
export declare function listRecentThreads(repo?: string, limit?: number): ThreadSummary[];
/** 清理过期 thread 文件：TTL 过期后再宽限 30 天删除 */
export declare function gcThreads(): number;
export declare function getThreadById(repo: string, threadId: string): ThreadSummary | undefined;
export declare function findBestThread(repo: string, task: string, options?: {
    branch?: string;
    minScore?: number;
}): ThreadSummary | undefined;
export interface QuickResume {
    task: string;
    /** 主 thread（最近的或指定的） */
    activeThread?: {
        id: string;
        repo: string;
        task: string;
        status: string;
        nextSteps: string[];
        decisions: string[];
    };
    /** 其他可恢复的 thread */
    otherThreads: {
        id: string;
        repo: string;
        task: string;
        status: string;
    }[];
}
export declare function loadThreadDetails(t: ThreadSummary): {
    nextSteps: string[];
    decisions: string[];
};
export declare function bootstrapQuick(input: BootstrapInput): QuickResume;
export declare function formatQuickResume(qr: QuickResume): string;
