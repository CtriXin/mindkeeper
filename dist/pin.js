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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getRealHome } from './env.js';
const SCE_DIR = join(getRealHome(), '.sce');
const HIGHLIGHTS_PATH = join(SCE_DIR, 'highlights', 'HIGHLIGHTS.md');
/** Pin 触发词正则 */
const PIN_TRIGGERS = [
    /^📌\s*/,
    /^pin(?:\s+this)?[:\s]+/i,
    /^highlight[:\s]+/i,
    /^mark(?:\s+this)?[:\s]+/i,
    /这个很重要[：:]\s*/,
    /记住这个[：:]\s*/,
    /保存这个[：:]\s*/,
];
/** 检测是否是 pin 请求 */
export function isPinRequest(text) {
    return PIN_TRIGGERS.some(re => re.test(text.trim()));
}
/** 解析 pin 请求，提取内容 */
export function parsePinRequest(text) {
    const trimmed = text.trim();
    for (const re of PIN_TRIGGERS) {
        if (re.test(trimmed)) {
            let content = trimmed.replace(re, '').trim();
            // 检查是否有分类标签 [category]
            const categoryMatch = content.match(/\[([^\]]+)\]\s*$/);
            let category;
            if (categoryMatch) {
                category = categoryMatch[1];
                content = content.replace(/\[([^\]]+)\]\s*$/, '').trim();
            }
            return content ? { content, category } : null;
        }
    }
    return null;
}
/** 从内容中提取标题（第一个加粗部分或前 30 字符） */
export function extractTitle(content) {
    // 尝试提取 **xxx** 格式
    const boldMatch = content.match(/\*\*([^*]+)\*\*/);
    if (boldMatch) {
        return boldMatch[1];
    }
    // 尝试提取 — 前面的部分
    const dashMatch = content.match(/^([^—]+)—/);
    if (dashMatch) {
        return dashMatch[1].trim();
    }
    // 截取前 30 字符
    const firstLine = content.split('\n')[0];
    if (firstLine.length <= 30) {
        return firstLine;
    }
    return firstLine.slice(0, 30) + '...';
}
/** 格式化 pin 条目为 markdown 行 */
export function formatPinEntry(entry) {
    const parts = [`- **${entry.title}**`];
    // 如果标题和内容不同，添加内容
    if (entry.content !== entry.title && !entry.content.startsWith(`**${entry.title}**`)) {
        parts.push(`— ${entry.content}`);
    }
    else if (entry.content.includes('—')) {
        // 内容已包含格式
        parts[0] = `- ${entry.content}`;
    }
    // 添加日期
    parts.push(`[${entry.date}]`);
    // 添加来源
    if (entry.source) {
        parts.push(`[${entry.source}]`);
    }
    return parts.join(' ');
}
/** 确保 SCE 目录存在 */
function ensureSceDir() {
    const highlightsDir = join(SCE_DIR, 'highlights');
    if (!existsSync(highlightsDir)) {
        mkdirSync(highlightsDir, { recursive: true });
    }
}
/** 读取 HIGHLIGHTS.md */
export function loadHighlights() {
    ensureSceDir();
    if (!existsSync(HIGHLIGHTS_PATH)) {
        return createDefaultHighlights();
    }
    return readFileSync(HIGHLIGHTS_PATH, 'utf-8');
}
/** 创建默认 HIGHLIGHTS.md */
function createDefaultHighlights() {
    const content = `# Highlights — 精华速查

> 📌 pin 的内容会自动追加到这里
> 快速定位值得分享的亮点

---

## Uncategorized

---

*使用方法：说 "📌 这个很重要" 自动追加到这里*
`;
    writeFileSync(HIGHLIGHTS_PATH, content);
    return content;
}
/** 追加 pin 条目到 HIGHLIGHTS.md */
export function appendPin(entry) {
    try {
        ensureSceDir();
        let content = loadHighlights();
        const category = entry.category || 'Uncategorized';
        const formattedEntry = formatPinEntry(entry);
        // 查找分类标题
        const categoryHeader = `## ${category}`;
        const categoryIndex = content.indexOf(categoryHeader);
        if (categoryIndex !== -1) {
            // 找到分类，在分类下追加
            const afterHeader = content.indexOf('\n', categoryIndex);
            const nextSection = content.indexOf('\n## ', afterHeader);
            const insertPos = nextSection !== -1 ? nextSection : content.lastIndexOf('\n---');
            // 在分类末尾插入
            const before = content.slice(0, insertPos);
            const after = content.slice(insertPos);
            content = before + '\n' + formattedEntry + after;
        }
        else {
            // 没找到分类，在 --- 前创建新分类
            const lastDash = content.lastIndexOf('\n---');
            if (lastDash !== -1) {
                const before = content.slice(0, lastDash);
                const after = content.slice(lastDash);
                content = before + `\n\n${categoryHeader}\n\n${formattedEntry}` + after;
            }
            else {
                // fallback: 追加到末尾
                content += `\n\n${categoryHeader}\n\n${formattedEntry}\n`;
            }
        }
        writeFileSync(HIGHLIGHTS_PATH, content);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: String(err) };
    }
}
/** 快捷方法：直接 pin 一段文字 */
export function pin(text, options) {
    const parsed = parsePinRequest(text);
    if (!parsed) {
        return { success: false, error: 'Not a valid pin request' };
    }
    const entry = {
        title: extractTitle(parsed.content),
        content: parsed.content,
        date: new Date().toISOString().split('T')[0],
        source: options?.source,
        category: parsed.category || options?.category,
    };
    const result = appendPin(entry);
    if (result.success) {
        return { success: true, entry };
    }
    return result;
}
/** 直接 pin 内容（不需要触发词） */
export function pinDirect(content, options) {
    const entry = {
        title: options?.title || extractTitle(content),
        content,
        date: new Date().toISOString().split('T')[0],
        source: options?.source,
        category: options?.category,
    };
    const result = appendPin(entry);
    if (result.success) {
        return { success: true, entry };
    }
    return result;
}
