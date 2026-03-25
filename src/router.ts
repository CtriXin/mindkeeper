/**
 * 语义路由器
 *
 * 核心创新：
 * 1. 基于触发词的快速匹配（无需 embedding）
 * 2. 支持模糊匹配和同义词
 * 3. 按访问频率和置信度加权
 * 4. 未来可插入 embedding 增强
 */

import type { BrainIndex, UnitMeta, SearchResult, Unit } from './types.js';
import { loadUnit, touchUnit } from './storage.js';

/** 同义词映射（可扩展） */
const SYNONYMS: Record<string, string[]> = {
  'provider': ['供应商', '服务商', 'vendor'],
  'routing': ['路由', 'route', '分发'],
  'error': ['错误', '报错', 'bug', '异常', 'exception'],
  'config': ['配置', 'configuration', 'settings', '设置'],
  'api': ['接口', 'endpoint'],
  'key': ['密钥', 'secret', 'token'],
  'model': ['模型', 'llm'],
  'memory': ['记忆', '存储', 'storage'],
  'context': ['上下文', '语境'],
};

/** 扩展查询词（加入同义词） */
function expandQuery(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/);
  const expanded = new Set(words);

  for (const word of words) {
    // 查找同义词
    for (const [key, synonyms] of Object.entries(SYNONYMS)) {
      if (word === key || synonyms.includes(word)) {
        expanded.add(key);
        synonyms.forEach(s => expanded.add(s));
      }
    }
  }

  return Array.from(expanded);
}

/** 计算匹配得分 */
function calculateScore(
  triggers: string[],
  queryTerms: string[],
  meta: UnitMeta
): { score: number; matched: string[] } {
  const matched: string[] = [];
  let rawScore = 0;

  const lowerTriggers = triggers.map(t => t.toLowerCase());

  for (const term of queryTerms) {
    for (const trigger of lowerTriggers) {
      // 精确匹配
      if (trigger === term) {
        rawScore += 1.0;
        matched.push(trigger);
      }
      // 包含匹配
      else if (trigger.includes(term) || term.includes(trigger)) {
        rawScore += 0.5;
        matched.push(trigger);
      }
    }
  }

  if (rawScore === 0) return { score: 0, matched: [] };

  // 归一化
  let score = rawScore / Math.max(queryTerms.length, triggers.length);

  // 置信度加权
  score *= meta.confidence;

  // 访问频率加权（常用的排前面）
  const accessBoost = Math.min(meta.accessCount / 100, 0.2);
  score += accessBoost;

  // 最近访问加权
  if (meta.lastAccessed) {
    const daysSinceAccess = (Date.now() - new Date(meta.lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess < 7) score += 0.1;
  }

  return { score: Math.min(score, 1), matched: [...new Set(matched)] };
}

/** 搜索知识库 */
export function search(
  index: BrainIndex,
  query: string,
  limit: number = 5
): SearchResult[] {
  const queryTerms = expandQuery(query);
  const results: SearchResult[] = [];

  for (const meta of index.units) {
    const { score, matched } = calculateScore(meta.triggers, queryTerms, meta);

    if (score > 0) {
      // 按需加载完整单元
      const unit = loadUnit(meta.id);
      if (unit) {
        // 更新访问统计
        touchUnit(index, meta.id);

        results.push({
          unit,
          score,
          matchedTriggers: matched,
        });
      }
    }
  }

  // 按得分排序
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

/** 根据上下文自动召回（更智能的检索） */
export function recall(
  index: BrainIndex,
  context: {
    project?: string;
    files?: string[];
    errors?: string[];
    recentQueries?: string[];
  },
  limit: number = 3
): SearchResult[] {
  const queryParts: string[] = [];

  // 从项目名提取关键词
  if (context.project) {
    queryParts.push(context.project);
  }

  // 从文件名提取关键词
  if (context.files) {
    for (const file of context.files) {
      // 提取文件名中的关键词
      const name = file.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      queryParts.push(...name.split(/[-_]/));
    }
  }

  // 从错误信息提取关键词
  if (context.errors) {
    for (const error of context.errors) {
      // 提取错误关键词
      const keywords = error.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) || [];
      queryParts.push(...keywords.map(k => k.toLowerCase()));
    }
  }

  // 最近查询
  if (context.recentQueries) {
    queryParts.push(...context.recentQueries);
  }

  if (queryParts.length === 0) return [];

  // 去重并搜索
  const query = [...new Set(queryParts)].join(' ');
  return search(index, query, limit);
}

/** 查找相关单元 */
export function findRelated(
  index: BrainIndex,
  unitId: string,
  limit: number = 3
): SearchResult[] {
  const unit = loadUnit(unitId);
  if (!unit) return [];

  // 用当前单元的触发词搜索
  const query = unit.triggers.join(' ');
  const results = search(index, query, limit + 1);

  // 排除自己
  return results.filter(r => r.unit.id !== unitId).slice(0, limit);
}
