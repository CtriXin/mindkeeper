/**
 * brain_bootstrap v2 — 任务启动入口
 *
 * v1 → v2 改进：
 * 1. 读真实 Git 上下文（branch, status, recent commits）
 * 2. 读项目规则文件（CLAUDE.md, AGENT.md, .ai/plan/）
 * 3. 任务分类（bugfix, refactor, doc, setup）
 * 4. 精准推荐 3 个文件（带理由）
 * 5. 真实 thread/TODO 恢复信息
 * 6. 只推荐最相关的 1-2 个 procedure
 * 7. 更具体的 next action（不是泛文案）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { getRealHome } from './env.js';
import { extractKeywords } from './utils.js';
import { loadFragments } from './fragments.js';
const SCE_DIR = join(getRealHome(), '.sce');
// ── Git 上下文 ──
function git(cmd, cwd) {
    try {
        // trimEnd 只去尾部换行，保留行首空格（porcelain 格式依赖前导空格）
        return execSync(`git ${cmd}`, {
            cwd,
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trimEnd();
    }
    catch {
        return '';
    }
}
function getCurrentBranch(repo) {
    return git('branch --show-current', repo) || git('rev-parse --short HEAD', repo) || 'unknown';
}
function parseThreadFrontmatter(content) {
    const meta = {};
    if (!content.startsWith('---'))
        return meta;
    const end = content.indexOf('---', 3);
    if (end < 0)
        return meta;
    const block = content.slice(3, end);
    block.split('\n').forEach(line => {
        const m = line.match(/^(\w+):\s*(.+)/);
        if (m) {
            const [, key, val] = m;
            meta[key] = val.trim();
        }
    });
    return meta;
}
function parseTtl(ttl) {
    const m = ttl.match(/^(\d+)(d|h|m)$/);
    if (!m)
        return 7 * 86400000; // 默认 7 天
    const [, n, unit] = m;
    const multiplier = unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000;
    return parseInt(n) * multiplier;
}
function extractThreadStatus(content) {
    const lines = content.split('\n');
    const statusIdx = lines.findIndex(l => /^##\s*当前状态/.test(l));
    if (statusIdx < 0)
        return '';
    for (let i = statusIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line)
            continue;
        if (line.startsWith('## '))
            break;
        return line;
    }
    return '';
}
function resolveThreadCreatedAt(meta, fallbackMs) {
    const createdAt = meta.created ? Date.parse(meta.created) : NaN;
    return Number.isFinite(createdAt) ? createdAt : fallbackMs;
}
/** 状态驱动 TTL：有未完成待续 14d，其他取 frontmatter 或默认 7d */
function deriveEffectiveTtl(content, metaTtl) {
    if (/^- \[ \]/m.test(content))
        return 14 * 86400000;
    return parseTtl(metaTtl || '7d');
}
function parseThreadFile(path, now) {
    try {
        const content = readFileSync(path, 'utf-8');
        const mtime = statSync(path).mtime.getTime();
        const meta = parseThreadFrontmatter(content);
        const createdAtMs = resolveThreadCreatedAt(meta, mtime);
        const status = extractThreadStatus(content);
        const ttlMs = deriveEffectiveTtl(content, meta.ttl);
        return {
            id: meta.id || basename(path, '.md'),
            root: meta.root || meta.id || basename(path, '.md'),
            repo: meta.repo || '',
            task: meta.task || basename(path, '.md'),
            status,
            path,
            createdAtMs,
            created: meta.created,
            branch: meta.branch,
            parent: meta.parent,
            ttl: meta.ttl,
            resumed: meta.resumed,
            cli: meta.cli,
            model: meta.model,
            folder: meta.folder,
            expired: now - createdAtMs > ttlMs,
        };
    }
    catch {
        return undefined;
    }
}
/** 标记 thread 已恢复：在 frontmatter 中插入 resumed 行 */
function markThreadResumed(thread) {
    try {
        const content = readFileSync(thread.path, 'utf-8');
        if (content.includes('\nresumed:'))
            return; // 已标记
        const timestamp = new Date().toISOString();
        // 在 --- 结束行前插入 resumed
        const updated = content.replace(/^(---\n)/, `$1resumed: ${timestamp}\n`);
        if (updated !== content) {
            // 插在第二个 --- 前
            const lines = content.split('\n');
            const result = [];
            let fmCount = 0;
            for (const line of lines) {
                if (line === '---') {
                    fmCount++;
                    if (fmCount === 2) {
                        result.push(`resumed: ${timestamp}`);
                    }
                }
                result.push(line);
            }
            writeFileSync(thread.path, result.join('\n'), 'utf-8');
        }
    }
    catch { /* 静默失败 */ }
}
function listThreads(repo, limit = 2, options) {
    const threadsDir = join(SCE_DIR, 'threads');
    if (!existsSync(threadsDir))
        return [];
    try {
        const now = Date.now();
        return readdirSync(threadsDir)
            .filter(f => f.endsWith('.md'))
            .map(f => parseThreadFile(join(threadsDir, f), now))
            .filter((thread) => Boolean(thread))
            .filter(t => (options?.includeExpired ? true : !t.expired))
            .filter(t => (options?.includeResumed ? true : !t.resumed))
            .filter(t => !repo || t.repo === repo)
            .sort((a, b) => b.createdAtMs - a.createdAtMs)
            .slice(0, limit)
            .map(({ expired: _expired, ...thread }) => thread);
    }
    catch {
        return [];
    }
}
/** 按 repo 过滤 thread；repo 为空时返回所有未恢复 thread */
export function listRecentThreads(repo, limit = 2, options) {
    return listThreads(repo, limit, options);
}
/** 项目 thread 历史：包含已恢复 thread，默认只保留未过期项 */
export function listThreadHistory(repo, limit = 100) {
    return listThreads(repo, limit, { includeResumed: true });
}
const GC_GRACE_DAYS = 30;
/** 清理过期 thread 文件：TTL 过期后再宽限 30 天删除 */
export function gcThreads() {
    const threadsDir = join(SCE_DIR, 'threads');
    if (!existsSync(threadsDir))
        return 0;
    const now = Date.now();
    const graceMs = GC_GRACE_DAYS * 86400000;
    let deleted = 0;
    try {
        for (const f of readdirSync(threadsDir)) {
            if (!f.endsWith('.md'))
                continue;
            const filePath = join(threadsDir, f);
            const parsed = parseThreadFile(filePath, now);
            if (!parsed)
                continue;
            if (!parsed.expired)
                continue;
            const ttlMs = parseTtl(parsed.ttl || '7d');
            const deadSince = parsed.createdAtMs + ttlMs;
            if (now - deadSince >= graceMs) {
                unlinkSync(filePath);
                deleted++;
            }
        }
    }
    catch { /* GC 失败不影响主流程 */ }
    return deleted;
}
function normalizeTaskText(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
// extractKeywords 已统一为 extractKeywords (utils.ts)
function isGenericResumeTask(task) {
    const normalized = normalizeTaskText(task);
    return /^(继续|继续上次|接着|接着来|恢复|resume|continue)$/.test(normalized);
}
function scoreTaskSimilarity(task, candidate) {
    const a = normalizeTaskText(task);
    const b = normalizeTaskText(candidate);
    if (!a || !b)
        return 0;
    let score = 0;
    if (a === b)
        score += 10;
    if (a.includes(b) || b.includes(a))
        score += 6;
    const aKeywords = extractKeywords(a);
    const bKeywords = extractKeywords(b);
    const shared = aKeywords.filter(token => bKeywords.includes(token));
    score += shared.length * 3;
    return score;
}
export function getThreadById(repo, threadId) {
    const threadsDir = join(SCE_DIR, 'threads');
    if (!existsSync(threadsDir))
        return undefined;
    const now = Date.now();
    const exactPath = join(threadsDir, `${threadId}.md`);
    const exact = parseThreadFile(exactPath, now);
    if (exact && !exact.expired) {
        // 优先匹配 repo，但不强制 — 支持任意位置恢复
        const { expired: _expired, ...thread } = exact;
        return thread;
    }
    // fallback: 扫描所有文件按 ID 查找（ID 可能和文件名不同）
    try {
        for (const file of readdirSync(threadsDir)) {
            if (!file.endsWith('.md') || file === `${threadId}.md`)
                continue;
            const parsed = parseThreadFile(join(threadsDir, file), now);
            if (parsed && parsed.id === threadId && !parsed.expired) {
                const { expired: _expired, ...thread } = parsed;
                return thread;
            }
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
export function findBestThread(repo, task, options) {
    const minScore = options?.minScore ?? 4;
    const candidates = listRecentThreads(repo, 50, { includeResumed: options?.includeResumed })
        .map(thread => ({
        thread,
        score: scoreTaskSimilarity(task, thread.task) +
            (options?.branch && thread.branch === options.branch ? 2 : 0),
    }))
        .filter(item => item.score >= minScore)
        .sort((a, b) => b.score - a.score || b.thread.createdAtMs - a.thread.createdAtMs);
    return candidates[0]?.thread;
}
export function findBestThreadAnyRepo(task, options) {
    const minScore = options?.minScore ?? 7;
    const candidates = listRecentThreads(undefined, 100, { includeResumed: options?.includeResumed })
        .map(thread => ({
        thread,
        score: scoreTaskSimilarity(task, thread.task) +
            (options?.branch && thread.branch === options?.branch ? 2 : 0),
    }))
        .filter(item => item.score >= minScore)
        .sort((a, b) => b.score - a.score || b.thread.createdAtMs - a.thread.createdAtMs);
    const best = candidates[0];
    const second = candidates[1];
    if (!best)
        return undefined;
    // 仅在跨 repo 候选明显领先时才自动推断，避免误绑错项目。
    if (second && second.thread.repo !== best.thread.repo && best.score - second.score < 3) {
        return undefined;
    }
    return best.thread;
}
function resolveTargetThread(input, options) {
    if (!input.repo)
        return undefined;
    const requestedThread = input.thread || input.task.match(/dst-\d{4,8}-\w+/)?.[0];
    if (requestedThread) {
        return getThreadById(input.repo, requestedThread);
    }
    if (isGenericResumeTask(input.task)) {
        return listRecentThreads(input.repo, 1)[0];
    }
    return findBestThread(input.repo, input.task, {
        branch: options?.branch || getCurrentBranch(input.repo),
    });
}
function extractThreadSection(content, header) {
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.startsWith(`## ${header}`));
    if (idx < 0)
        return [];
    const items = [];
    for (let i = idx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('## '))
            break;
        if (line.startsWith('- '))
            items.push(line.slice(2).replace(/^\[\s*[xX ]?\]\s*/, ''));
    }
    return items;
}
export function loadThreadDetails(t) {
    try {
        const content = readFileSync(t.path, 'utf-8');
        const recentFragments = loadFragments(t.root || t.id, 3);
        return {
            nextSteps: extractThreadSection(content, '待续'),
            decisions: extractThreadSection(content, '决策').slice(0, 3),
            findings: extractThreadSection(content, '发现').slice(0, 5),
            recentFragments: recentFragments.map(fragment => ({
                id: fragment.id,
                kind: fragment.kind,
                summary: fragment.summary,
                next: fragment.next,
            })),
        };
    }
    catch {
        return { nextSteps: [], decisions: [], findings: [], recentFragments: [] };
    }
}
export function bootstrapQuick(input) {
    const target = resolveTargetThread(input);
    if (!target) {
        return { task: input.task, otherThreads: [] };
    }
    const threads = listRecentThreads(input.repo, 5, {
        includeResumed: Boolean(input.thread),
    });
    // 标记已恢复，sce-ls 不再显示
    markThreadResumed(target);
    const details = loadThreadDetails(target);
    return {
        task: input.task,
        activeThread: {
            id: target.id,
            root: target.root,
            repo: target.repo,
            task: target.task,
            status: target.status || '进行中',
            nextSteps: details.nextSteps,
            decisions: details.decisions,
            findings: details.findings,
            recentFragments: details.recentFragments,
        },
        otherThreads: threads
            .filter(t => t.id !== target.id)
            .map(t => ({ id: t.id, repo: t.repo, task: t.task, status: t.status || '' })),
    };
}
export function formatQuickResume(qr) {
    if (!qr.activeThread) {
        return `> **任务**: ${qr.task}\n\n新任务，直接开始。`;
    }
    const t = qr.activeThread;
    const repoName = t.repo.split('/').pop() || t.repo;
    let text = `> **恢复**: ${t.task} (${repoName})\n`;
    text += `> **状态**: ${t.status}\n`;
    if (t.nextSteps.length > 0) {
        text += `\n**待续**:\n`;
        t.nextSteps.forEach(s => text += `- ${s}\n`);
    }
    if (t.decisions.length > 0) {
        text += `\n**关键决策**:\n`;
        t.decisions.forEach(d => text += `- ${d}\n`);
    }
    if (t.findings.length > 0) {
        text += `\n**重要发现**:\n`;
        t.findings.forEach(f => text += `- ${f}\n`);
    }
    if (t.recentFragments.length > 0) {
        text += `\n**最近片段**:\n`;
        t.recentFragments.forEach(fragment => {
            const nextHint = fragment.next[0] ? ` → ${fragment.next[0]}` : '';
            text += `- [${fragment.kind}] ${fragment.summary}${nextHint}\n`;
        });
    }
    // 同 repo 有其他 thread
    if (qr.otherThreads.length > 0) {
        text += `\n**同项目其他进度**（输入 \`/cr <id>\` 切换）:\n`;
        qr.otherThreads.forEach(o => {
            const oRepo = o.repo.split('/').pop() || o.repo;
            text += `- \`${o.id}\` (${oRepo}): ${o.task}${o.status ? ' — ' + o.status : ''}\n`;
        });
    }
    return text;
}
