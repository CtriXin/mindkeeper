/**
 * BrainKeeper 核心类型定义
 *
 * v2 — Recipe 驱动
 * 知识不再是自由 markdown，而是结构化 Recipe：
 * steps / files / gotchas / corrections + changelog
 */
/** Recipe 文件条目 */
export interface RecipeFile {
    path: string;
    description: string;
}
/** Changelog 条目 */
export interface ChangelogEntry {
    date: string;
    description: string;
}
/** 知识类型：recipe（实现经验）或 insight（产品/设计认知） */
export type KnowledgeType = 'recipe' | 'insight';
/** Recipe 元数据（存在 index.json 中） */
export interface RecipeMeta {
    id: string;
    /** 知识类型，默认 recipe */
    type?: KnowledgeType;
    triggers: string[];
    summary: string;
    /** 来源仓库完整路径（LLM 回溯代码用） */
    repo?: string;
    /** 来源分支 */
    branch?: string;
    project?: string;
    framework?: string;
    created: string;
    updated: string;
    lastAccessed?: string;
    accessCount: number;
    confidence: number;
    tags?: string[];
    /** 上次人工验证日期 */
    lastVerified?: string;
    /** 关联的 board item ID */
    boardItemId?: string;
    /** 关联的 recipe IDs（经常一起使用的） */
    related?: string[];
}
/** 完整 Recipe（元数据 + 内容） */
export interface Recipe extends RecipeMeta {
    steps: string[];
    files: RecipeFile[];
    gotchas: string[];
    corrections: string[];
    changelog: ChangelogEntry[];
    /** insight 类型专用：核心结论 */
    conclusion?: string;
    /** insight 类型专用：为什么得出这个结论 */
    why?: string;
    /** insight 类型专用：什么场景下应用 */
    when_to_apply?: string;
}
/** Recipe 检索结果 */
export interface RecipeSearchResult {
    recipe: Recipe;
    score: number;
    matchedTriggers: string[];
}
export interface BrainIndex {
    version: string;
    updated: string;
    recipes: RecipeMeta[];
    /** @deprecated 旧 units，保留兼容 */
    units?: UnitMeta[];
}
/** @deprecated 用 RecipeMeta 代替 */
export interface UnitMeta {
    id: string;
    triggers: string[];
    summary: string;
    project?: string;
    created: string;
    lastAccessed?: string;
    accessCount: number;
    confidence: number;
    tags?: string[];
}
/** @deprecated 用 Recipe 代替 */
export interface Unit extends UnitMeta {
    content: string;
    related?: string[];
    tags?: string[];
}
/** @deprecated */
export interface SearchResult {
    unit: Unit;
    score: number;
    matchedTriggers: string[];
}
export type FragmentKind = 'dev' | 'explore' | 'debug' | 'fix' | 'note' | 'reflect';
export interface FragmentRecord {
    id: string;
    rootId: string;
    threadId: string;
    repo: string;
    task: string;
    branch?: string;
    cli?: string;
    model?: string;
    kind: FragmentKind;
    created: string;
    summary: string;
    decisions: string[];
    changes: string[];
    findings: string[];
    next: string[];
}
export declare const TOOLS: {
    /** 任务完成后提取 recipe */
    readonly LEARN: "brain_learn";
    /** 根据任务描述召回 recipe */
    readonly RECALL: "brain_recall";
    /** 列出所有 recipe */
    readonly LIST: "brain_list";
    /** 轻量启动入口 */
    readonly BOOTSTRAP: "brain_bootstrap";
    /** 蒸馏 checkpoint */
    readonly CHECKPOINT: "brain_checkpoint";
    /** 追加持续工作片段 */
    readonly FRAGMENT: "brain_fragment";
    /** 绑定 issue-tracking issue */
    readonly LINK_ISSUE: "brain_link_issue";
    /** 同步 digest 到 issue-tracking */
    readonly SYNC_ISSUE: "brain_sync_issue";
    /** 列出 threads */
    readonly THREADS: "brain_threads";
    /** 读写项目看板 */
    readonly BOARD: "brain_board";
    /** 扫描项目信号 */
    readonly CHECK: "brain_check";
    /** 分析结果缓存 */
    readonly DIGEST: "brain_digest";
    /** 全文搜索 */
    readonly SEARCH: "brain_search";
};
export declare const QUADRANT_KEYS: readonly ["q1", "q2", "q3", "q4"];
export type QuadrantKey = typeof QUADRANT_KEYS[number];
export declare const QUADRANT_LABELS: Record<QuadrantKey, string>;
export interface BoardItem {
    id: string;
    title: string;
    deadline?: string;
    status: 'active' | 'done' | 'archived';
    quadrant: QuadrantKey;
    assignee?: string;
    repo?: string;
    created: string;
    updated?: string;
    source?: string;
    source_ref?: string;
}
export interface BoardMemo {
    text: string;
    created: string;
    source?: string;
}
export interface Board {
    project: string;
    description?: string;
    repo?: string;
    aliases?: string[];
    sub_projects?: Record<string, {
        repo?: string;
        description?: string;
    }>;
    last_updated: string;
    stale_warning_days?: number;
    quadrants: Record<QuadrantKey, BoardItem[]>;
    memos: BoardMemo[];
}
/** brain_check 信号 */
export interface BoardSignal {
    project: string;
    type: 'deadline_soon' | 'overdue' | 'stale' | 'active' | 'stale_item';
    message: string;
    days?: number;
    item_count?: number;
}
/** Recipe 过时信号 */
export interface RecipeStalenessSignal {
    recipeId: string;
    summary: string;
    reasons: string[];
}
export interface DigestEntry {
    id: string;
    /** 语义化名称，如 "project-a-auth-audit" */
    name: string;
    /** 主题关键词，用于召回匹配 */
    keywords: string[];
    /** 缓存内容 */
    content: string;
    /** 来源项目 */
    project?: string;
    /** 来源 repo */
    repo?: string;
    /** 创建时间 */
    created: string;
    /** 最后访问时间 */
    lastAccessed: string;
    /** 访问次数 */
    accessCount: number;
    /** 过期时间（ISO），可选 */
    expiresAt?: string;
    /** 是否全局可见（跨项目） */
    global: boolean;
}
