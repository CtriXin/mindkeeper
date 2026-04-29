/**
 * brainkeeper-guide — 下一步建议
 *
 * 灵感来源：BMAD bmad-help
 * 设计理念：不是 AI 决定一切，是 AI 帮你理清思路
 *
 * 读取：
 * - 当前 TODO
 * - 最近的 observations
 * - 项目状态
 * - 未完成的 Thread
 *
 * 输出：一条建议
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { listProcedures } from './procedure.js';
import { listRecentThreads } from './bootstrap.js';
import { getRealHome } from './env.js';
const SCE_DIR = join(getRealHome(), '.sce');
/** 读取最近的文件 */
function getRecentFiles(dir, limit = 5) {
    if (!existsSync(dir))
        return [];
    try {
        const files = readdirSync(dir)
            .filter(f => f.endsWith('.md') || f.endsWith('.json'))
            .map(f => ({
            name: f,
            mtime: statSync(join(dir, f)).mtime.getTime(),
        }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit)
            .map(f => f.name);
        return files;
    }
    catch {
        return [];
    }
}
/** 读取文件内容摘要 */
function readSummary(path, maxLines = 10) {
    if (!existsSync(path))
        return '';
    try {
        const content = readFileSync(path, 'utf-8');
        return content.split('\n').slice(0, maxLines).join('\n');
    }
    catch {
        return '';
    }
}
/** 获取上下文状态 */
export function getContextState(repo) {
    const threads = listRecentThreads(repo, 3);
    return {
        recentObservations: getRecentFiles(join(SCE_DIR, 'observations')),
        recentEvidence: getRecentFiles(join(SCE_DIR, 'evidence')),
        activeThreads: threads.map(t => `${t.id}: ${t.task}${t.status ? ' — ' + t.status : ''}`),
        activeThreadPaths: threads.map(t => t.path),
        pendingBeliefs: [], // TODO: 实现待确认的 belief 列表
        availableProcedures: listProcedures().map(p => p.name),
    };
}
/** 生成建议 */
export function generateSuggestion(context, repo) {
    const state = getContextState(repo);
    // 优先级 1：有未完成的 thread
    if (state.activeThreads.length > 0) {
        return {
            type: 'continue_thread',
            title: '继续未完成的 Thread',
            reason: `你有 ${state.activeThreads.length} 个未完成的 thread，最近的是 ${state.activeThreads[0]}`,
            action: state.activeThreadPaths[0] ? `查看 ${state.activeThreadPaths[0]}` : undefined,
            priority: 'high',
        };
    }
    // 优先级 2：有最近的 observation 需要 review
    if (state.recentObservations.length > 0) {
        const recent = state.recentObservations[0];
        const summary = readSummary(join(SCE_DIR, 'observations', recent), 3);
        return {
            type: 'review_observation',
            title: '回顾最近的观察',
            reason: `你最近记录了观察 "${recent}"，可以考虑是否需要升级为 belief`,
            action: summary ? `内容预览：${summary.slice(0, 100)}...` : undefined,
            priority: 'medium',
        };
    }
    // 优先级 3：有 evidence 但没有 observation
    if (state.recentEvidence.length > 0 && state.recentObservations.length === 0) {
        return {
            type: 'capture_signal',
            title: '蒸馏最近的 Evidence',
            reason: `你有 ${state.recentEvidence.length} 条原始 evidence，可以运行学习回路将它们蒸馏为 observation`,
            action: '使用 brain_learn 工具开始学习回路',
            priority: 'medium',
        };
    }
    // 优先级 4：可以运行某个 procedure
    if (state.availableProcedures.length > 0 && context) {
        return {
            type: 'run_procedure',
            title: '运行学习回路',
            reason: `根据你提供的上下文，可以运行 "${state.availableProcedures[0]}" 来处理`,
            action: `使用 brain_procedure 查看详情`,
            priority: 'low',
        };
    }
    // 默认：没什么紧急的
    return {
        type: 'rest',
        title: '暂时没有紧急事项',
        reason: '所有 thread 都已完成，没有待处理的 observation。可以继续当前工作，或者主动记录新的发现。',
        priority: 'low',
    };
}
/** 格式化建议为可读文本 */
export function formatSuggestion(suggestion) {
    const priorityEmoji = {
        high: '🔴',
        medium: '🟡',
        low: '🟢',
    };
    let text = `${priorityEmoji[suggestion.priority]} **${suggestion.title}**\n\n`;
    text += `${suggestion.reason}\n`;
    if (suggestion.action) {
        text += `\n💡 ${suggestion.action}`;
    }
    return text;
}
/** 快捷方法：获取下一步建议 */
export function guide(context, repo) {
    const suggestion = generateSuggestion(context, repo);
    return formatSuggestion(suggestion);
}
