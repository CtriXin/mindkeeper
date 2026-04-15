import { type ThreadSummary } from './bootstrap.js';
export declare const SESSION_INDEX_REL_PATH = ".ai/SESSION_INDEX.md";
export declare function syncProjectSessionIndex(repo: string, threads?: ThreadSummary[]): {
    path?: string;
    count: number;
};
