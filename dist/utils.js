/**
 * 共享工具函数（无内部依赖，供所有模块引用）
 */
/** 从文本提取关键词：英文单词 + 中文双字词 */
export function extractKeywords(text) {
    return [...new Set(text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g)?.filter(t => t.length >= 2) || [])];
}
