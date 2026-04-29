/**
 * MCP Tool Handlers — 8 tools
 *
 * 从 server.ts 拆出的业务逻辑，每个 tool 一个函数。
 * server.ts 只负责 MCP 协议层和路由分发。
 */
import type { BrainIndex } from './types.js';
type ToolResponse = {
    content: {
        type: string;
        text: string;
    }[];
    isError?: boolean;
};
export declare function handleLearn(args: Record<string, unknown>, index: BrainIndex): ToolResponse;
export declare function handleRecall(args: Record<string, unknown>, index: BrainIndex): ToolResponse;
export declare function handleList(args: Record<string, unknown>, index: BrainIndex): ToolResponse;
export declare function handleBootstrap(args: Record<string, unknown>, index: BrainIndex): ToolResponse;
export declare function handleCheckpoint(args: Record<string, unknown>): ToolResponse;
export declare function handleFragment(args: Record<string, unknown>): ToolResponse;
export declare function handleLinkIssue(args: Record<string, unknown>): ToolResponse;
export declare function handleSyncIssue(args: Record<string, unknown>): ToolResponse;
export declare function handleThreads(args: Record<string, unknown>): ToolResponse;
export declare function handleBoard(args: Record<string, unknown>): ToolResponse;
export declare function handleCheck(args: Record<string, unknown>, index: BrainIndex): ToolResponse;
export declare function handleDigest(args: Record<string, unknown>): ToolResponse;
export declare function handleSearch(args: Record<string, unknown>): ToolResponse;
export {};
