import type { ThreadSummary } from './bootstrap.js';
export interface IssueLinkInput {
    rootId: string;
    project: string;
    issue: string;
    repo?: string;
}
export interface IssueLinkRecord extends IssueLinkInput {
    updated: string;
}
export declare function saveIssueLink(record: IssueLinkInput): IssueLinkRecord;
export declare function loadIssueLink(rootId: string): IssueLinkRecord | null;
export interface SyncIssueDigestResult {
    path: string;
    rootId: string;
    issue: string;
    project: string;
    fragmentCount: number;
}
export declare function syncIssueDigest(thread: ThreadSummary): SyncIssueDigestResult;
export declare function defaultIssueProject(repo: string): string;
