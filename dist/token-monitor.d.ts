/**
 * token-monitor.ts — 轻量 Token 监控与滑动窗口压缩
 *
 * 功能：
 * 1. 监控对话轮次和估算 token 使用量
 * 2. 超过阈值时自动触发滑动窗口压缩
 * 3. 异步调用国产模型做语义 distill
 */
export interface TokenMonitorConfig {
    /** 对话轮次阈值，超过后触发警告 */
    turnWarning: number;
    /** 对话轮次阈值，超过后自动压缩 */
    turnCompress: number;
    /** Token 使用率阈值 (0-1)，超过后触发压缩 */
    tokenThreshold: number;
    /** 滑动窗口保留的最近轮次数 */
    windowSize: number;
    /** 是否启用异步 distill */
    enableAsyncDistill: boolean;
    /** 用于 distill 的模型 */
    distillModel: string;
}
export interface TokenState {
    sessionId: string;
    turnCount: number;
    estimatedTokens: number;
    lastReset: string;
    compressedCount: number;
    history: TurnRecord[];
}
export interface TurnRecord {
    timestamp: string;
    role: 'user' | 'assistant';
    tokens: number;
    summary?: string;
}
/** 初始化或获取当前 session 的 token 状态 */
export declare function initSession(): TokenState;
/** 记录一轮对话 */
export declare function recordTurn(role: 'user' | 'assistant', content: string): TokenState;
/** 加载配置 */
export declare function loadConfig(): TokenMonitorConfig;
/** 保存配置 */
export declare function saveConfig(config: Partial<TokenMonitorConfig>): void;
/** 检查是否需要压缩，返回建议 */
export declare function checkCompression(state: TokenState): {
    shouldCompress: boolean;
    shouldWarn: boolean;
    reason: string;
};
/** 应用滑动窗口压缩，返回被压缩的轮次 */
export declare function applySlidingWindow(state: TokenState): {
    compressedTurns: number;
    savedTokens: number;
    newHistory: TurnRecord[];
};
/** 生成当前状态摘要 */
export declare function formatStatus(state: TokenState): string;
/** 重置状态 */
export declare function resetState(): TokenState;
