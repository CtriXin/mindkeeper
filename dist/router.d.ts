/**
 * 语义路由器
 *
 * v2.1 — 增强匹配
 * - 50+ 同义词组（按领域分类）
 * - Trigram 模糊匹配（fallback）
 * - Tags 参与评分
 * - CamelCase/kebab-case 拆分 + 缩写展开
 * - 导出 extractKeywords 供其他模块复用
 */
import type { BrainIndex, RecipeSearchResult } from './types.js';
export { extractKeywords } from './utils.js';
export declare function searchRecipes(index: BrainIndex, query: string, limit?: number): RecipeSearchResult[];
