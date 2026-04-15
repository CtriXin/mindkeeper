import type { FragmentKind, FragmentRecord } from './types.js';
export interface FragmentAppendInput {
    rootId: string;
    threadId: string;
    repo: string;
    task: string;
    branch?: string;
    cli?: string;
    model?: string;
    kind?: FragmentKind;
    summary: string;
    decisions?: string[];
    changes?: string[];
    findings?: string[];
    next?: string[];
}
export declare function appendFragment(input: FragmentAppendInput): FragmentRecord;
export declare function loadFragments(rootId: string, limit?: number): FragmentRecord[];
