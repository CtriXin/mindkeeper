/**
 * brainkeeper-guide — 下一步建议
 *
 * 灵感来源：BMAD bmad-help
 * 设计理念：不是 AI 决定一切，是 AI 帮你理清思路
 *
 * 读取：
 * - 当前 TODO
 * - 最近的 observations
 * - 项目状态
 * - 未完成的 Thread
 *
 * 输出：一条建议
 */
/** 建议类型 */
export type SuggestionType = 'continue_thread' | 'review_observation' | 'promote_belief' | 'maintain_knowledge' | 'capture_signal' | 'run_procedure' | 'rest';
/** 建议 */
export interface Suggestion {
    type: SuggestionType;
    title: string;
    reason: string;
    action?: string;
    priority: 'high' | 'medium' | 'low';
}
/** 获取上下文状态 */
export declare function getContextState(repo?: string): {
    recentObservations: string[];
    recentEvidence: string[];
    activeThreads: string[];
    activeThreadPaths: string[];
    pendingBeliefs: string[];
    availableProcedures: string[];
};
/** 生成建议 */
export declare function generateSuggestion(context?: string, repo?: string): Suggestion;
/** 格式化建议为可读文本 */
export declare function formatSuggestion(suggestion: Suggestion): string;
/** 快捷方法：获取下一步建议 */
export declare function guide(context?: string, repo?: string): string;
