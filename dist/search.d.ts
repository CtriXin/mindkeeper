/**
 * brain_search — 全文搜索 thread / fragment / recipe
 *
 * 零依赖实现：基于关键词匹配 + 评分排序，不用 SQLite/FTS5。
 * 搜索范围：threads（~/.sce/threads/）、fragments（~/.sce/fragments/）、recipes（index.json）。
 */
export interface SearchResult {
    type: 'thread' | 'fragment' | 'recipe';
    id: string;
    score: number;
    summary: string;
    /** 命中的关键词 */
    matched: string[];
    /** 额外元数据 */
    meta: Record<string, string>;
}
export interface SearchOptions {
    types?: ('thread' | 'fragment' | 'recipe')[];
    repo?: string;
    limit?: number;
}
export declare function searchAll(query: string, options?: SearchOptions): SearchResult[];
export declare function formatSearchResults(results: SearchResult[]): string;
