/**
 * agents-brain 核心类型定义
 *
 * 设计哲学：
 * 1. 每个知识单元是自描述的（Self-Describing）
 * 2. 索引只存触发词，不存内容（Zero-Load）
 * 3. 文件即知识，Git 即版本控制（Never Lose）
 */

/** 知识单元元数据（存在 index.json 中） */
export interface UnitMeta {
  /** 唯一标识符 */
  id: string;
  /** 触发词列表（语义路由用） */
  triggers: string[];
  /** 一句话摘要 */
  summary: string;
  /** 来源项目 */
  project?: string;
  /** 创建时间 */
  created: string;
  /** 最后访问时间 */
  lastAccessed?: string;
  /** 访问次数 */
  accessCount: number;
  /** 置信度 0-1 */
  confidence: number;
}

/** 完整知识单元（存在 units/*.md 中的 frontmatter） */
export interface Unit extends UnitMeta {
  /** 完整内容（Markdown） */
  content: string;
  /** 相关单元 ID */
  related?: string[];
  /** 标签 */
  tags?: string[];
}

/** 极简索引（启动时唯一加载的文件） */
export interface BrainIndex {
  version: string;
  /** 最后更新时间 */
  updated: string;
  /** 单元元数据列表 */
  units: UnitMeta[];
}

/** 检索结果 */
export interface SearchResult {
  unit: Unit;
  /** 匹配得分 0-1 */
  score: number;
  /** 匹配的触发词 */
  matchedTriggers: string[];
}

/** MCP 工具定义 */
export const TOOLS = {
  /** 语义检索 */
  SEARCH: 'brain_search',
  /** 存入新知识 */
  STORE: 'brain_store',
  /** 更新已有知识 */
  UPDATE: 'brain_update',
  /** 删除知识 */
  FORGET: 'brain_forget',
  /** 列出所有主题 */
  LIST: 'brain_list',
  /** 根据上下文自动召回 */
  RECALL: 'brain_recall',
} as const;
