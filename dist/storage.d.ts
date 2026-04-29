/**
 * 存储层
 *
 * v2 — Recipe 驱动
 * - brain/index.json: 极简索引（recipes + 旧 units）
 * - brain/recipes/*.md: Recipe 文件（frontmatter + 结构化 markdown）
 * - brain/units/*.md: 旧知识单元（只读，不再新增）
 */
import type { BrainIndex, Recipe, RecipeMeta, Unit, UnitMeta, Board, BoardItem, BoardMemo, BoardSignal, QuadrantKey, RecipeStalenessSignal, DigestEntry } from './types.js';
export declare function loadIndex(): BrainIndex;
export declare function saveIndex(index: BrainIndex): void;
export declare function loadRecipe(id: string): Recipe | null;
export declare function saveRecipe(recipe: Recipe): void;
export declare function deleteRecipe(id: string): boolean;
export declare function recipeMetaFrom(recipe: Recipe): RecipeMeta;
/** 批量更新访问统计 */
export declare function touchRecipes(index: BrainIndex, ids: string[]): void;
/** 列出所有 recipe 文件 */
export declare function listRecipeFiles(): string[];
export declare function loadUnit(id: string): Unit | null;
export declare function saveUnit(unit: Unit): void;
export declare function deleteUnit(id: string): boolean;
export declare function metaFromUnit(unit: Unit): UnitMeta;
export declare function listUnitFiles(): string[];
export declare function boardPath(projectSlug: string): string;
/** 列出所有 board 的 project slug */
export declare function listBoardSlugs(): string[];
/** 加载指定项目的 board */
export declare function loadBoard(projectSlug: string): Board | null;
/** 保存 board */
export declare function saveBoard(board: Board): void;
/** 创建新 board */
export declare function createBoard(project: string, repo?: string, staleWarningDays?: number): Board;
/** 添加条目到 board */
export declare function addBoardItem(projectSlug: string, title: string, quadrant: QuadrantKey, options?: {
    deadline?: string;
    assignee?: string;
    source?: string;
    source_ref?: string;
}): BoardItem | null;
/** 更新 board 条目（仅更新提供的字段） */
export declare function updateBoardItem(projectSlug: string, itemId: string, changes: Partial<Pick<BoardItem, 'title' | 'deadline' | 'status' | 'quadrant' | 'assignee'>>): BoardItem | null;
/** 添加备忘 */
export declare function addBoardMemo(projectSlug: string, text: string, source?: string): BoardMemo | null;
/** 获取 board 文件修改时间 */
export declare function getBoardMtime(projectSlug: string): number | null;
/** 扫描所有 board，返回信号（只返回有信号的项） */
export declare function checkBoards(options?: {
    deadlineDays?: number;
}): BoardSignal[];
/** 自动归档：将 done 超 30 天的条目移入 archive 文件 */
export declare function archiveStaleItems(projectSlug: string): number;
/** 列出所有 board 摘要 */
export declare function listBoardSummaries(): Array<{
    slug: string;
    project: string;
    activeCount: number;
    doneCount: number;
    lastUpdated: string;
}>;
/** 检测过时 recipe，返回有问题的列表 */
export declare function checkRecipeStaleness(index: BrainIndex): RecipeStalenessSignal[];
/** 自动降权：accessCount=0 且 180+ 天的 recipe → confidence 降到 0.3 */
export declare function deprecateStaleRecipes(index: BrainIndex): {
    deprecated: string[];
    total: number;
    active: number;
    stale: number;
    deprecatedCount: number;
};
/** 获取 recipe 健康摘要 */
export declare function getRecipeHealthSummary(index: BrainIndex): {
    total: number;
    active: number;
    stale: number;
    deprecated: number;
};
/** 查找与任务文本匹配的活跃 board items */
export declare function findMatchingBoardItems(taskText: string): Array<{
    project: string;
    itemId: string;
    title: string;
}>;
export declare function storeDigest(input: {
    name: string;
    keywords: string[];
    content: string;
    project?: string;
    repo?: string;
    global?: boolean;
    ttlHours?: number;
}): DigestEntry;
export declare function recallDigests(query: {
    keywords: string[];
    project?: string;
    limit?: number;
}): Array<DigestEntry & {
    score: number;
}>;
export declare function invalidateDigest(id: string): boolean;
export declare function listDigestSummaries(project?: string): Array<{
    id: string;
    name: string;
    keywords: string[];
    accessCount: number;
    created: string;
}>;
