/**
 * 📌 Pin 机制
 *
 * 识别用户想要保存的关键信息，追加到 HIGHLIGHTS.md
 *
 * 触发词：
 * - "📌" / "pin" / "pin this"
 * - "这个很重要" / "记住这个"
 * - "highlight" / "mark this"
 */
/** Pin 条目 */
export interface PinEntry {
    /** 标题（加粗） */
    title: string;
    /** 内容 */
    content: string;
    /** 日期 */
    date: string;
    /** 来源（可选） */
    source?: string;
    /** 分类（可选） */
    category?: string;
}
/** 检测是否是 pin 请求 */
export declare function isPinRequest(text: string): boolean;
/** 解析 pin 请求，提取内容 */
export declare function parsePinRequest(text: string): {
    content: string;
    category?: string;
} | null;
/** 从内容中提取标题（第一个加粗部分或前 30 字符） */
export declare function extractTitle(content: string): string;
/** 格式化 pin 条目为 markdown 行 */
export declare function formatPinEntry(entry: PinEntry): string;
/** 读取 HIGHLIGHTS.md */
export declare function loadHighlights(): string;
/** 追加 pin 条目到 HIGHLIGHTS.md */
export declare function appendPin(entry: PinEntry): {
    success: boolean;
    error?: string;
};
/** 快捷方法：直接 pin 一段文字 */
export declare function pin(text: string, options?: {
    source?: string;
    category?: string;
}): {
    success: boolean;
    entry?: PinEntry;
    error?: string;
};
/** 直接 pin 内容（不需要触发词） */
export declare function pinDirect(content: string, options?: {
    title?: string;
    source?: string;
    category?: string;
}): {
    success: boolean;
    entry?: PinEntry;
    error?: string;
};
