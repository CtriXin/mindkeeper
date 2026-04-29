/**
 * distill.ts — 上下文蒸馏 & checkpoint
 *
 * 单一 pipeline，两个入口：
 * - brain_checkpoint (MCP tool) — AI 自己调用
 * - /distill (planned skill) — 用户手动触发
 *
 * 输出和 bootstrap reader 对齐的 thread frontmatter。
 */
import { writeFileSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve, dirname, relative } from 'path';
import { execSync } from 'child_process';
import { findBestThread, findBestThreadAnyRepo, getThreadById, gcThreads } from './bootstrap.js';
import { syncProjectSessionIndex } from './session-index.js';
import { findMatchingBoardItems } from './storage.js';
import { getRealHome } from './env.js';
const SCE_DIR = join(getRealHome(), '.sce');
const THREADS_DIR = join(SCE_DIR, 'threads');
// ── ID 生成 ──
function generateThreadId() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 8);
    return `dst-${mm}${dd}-${rand}`;
}
// ── 输入约束 ──
const ENTRY_LIMITS = {
    decisions: 5,
    changes: 8,
    findings: 8,
    next: 8,
};
function sanitizeScalar(value) {
    return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}
function sanitizeList(items, limit) {
    return items
        .map(item => sanitizeScalar(item).replace(/^[-*]\s+/, '').replace(/^\[\s*[xX ]?\]\s+/, ''))
        .filter(Boolean)
        .slice(0, limit);
}
function resolveParent(input) {
    if (input.parent) {
        const exact = getThreadById(input.repo, input.parent);
        if (!exact) {
            // debug: parent 指定了但找不到，降级为无 parent
            console.error(`[brainkeeper] resolveParent: parent "${input.parent}" not found, skipping`);
        }
        return exact?.id;
    }
    return findBestThread(input.repo, input.task, {
        branch: input.branch,
        minScore: 4,
        includeResumed: true,
    })?.id;
}
// ── Repo 自动检测 ──
/** 从 change 条目提取文件路径：`src/foo.ts — 描述` → `src/foo.ts` */
function extractFilePath(change) {
    // 取 — / – / - 前的部分（优先全角破折号）
    const sep = change.match(/\s[—–]\s/);
    const pathPart = sep ? change.slice(0, sep.index).trim() : change.trim();
    // 看起来像文件路径：含 . 或 /
    if (/[./]/.test(pathPart) && !/\s{2,}/.test(pathPart))
        return pathPart;
    return undefined;
}
const _gitRootCache = new Map();
/** 获取路径所属的 git repo root，带缓存 */
function gitRepoRoot(filePath) {
    const dir = existsSync(filePath)
        ? (filePath.includes('.') ? dirname(filePath) : filePath)
        : dirname(filePath);
    if (_gitRootCache.has(dir))
        return _gitRootCache.get(dir);
    try {
        const root = execSync('git rev-parse --show-toplevel', {
            cwd: dir,
            encoding: 'utf-8',
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        _gitRootCache.set(dir, root);
        return root;
    }
    catch {
        _gitRootCache.set(dir, null);
        return null;
    }
}
function normalizePathForFrontmatter(value) {
    return value.replace(/\\/g, '/');
}
function resolveRepoContext(inputRepo) {
    const requestedRepo = resolve(sanitizeScalar(inputRepo));
    const absoluteRepo = existsSync(requestedRepo) ? realpathSync(requestedRepo) : requestedRepo;
    const gitRoot = gitRepoRoot(absoluteRepo);
    if (!gitRoot) {
        return {
            repo: normalizePathForFrontmatter(absoluteRepo),
            source: 'raw',
            isGitRepo: false,
        };
    }
    const normalizedRoot = normalizePathForFrontmatter(gitRoot);
    const normalizedRepo = normalizePathForFrontmatter(absoluteRepo);
    const folderHint = normalizedRepo !== normalizedRoot && normalizedRepo.startsWith(normalizedRoot + '/')
        ? normalizePathForFrontmatter(relative(normalizedRoot, normalizedRepo)) || undefined
        : undefined;
    return {
        repo: normalizedRoot,
        folderHint,
        source: 'git',
        isGitRepo: true,
    };
}
function inferRepoContext(input, task, branch, current) {
    if (current.isGitRepo)
        return current;
    if (input.parent) {
        const parentThread = getThreadById(current.repo, input.parent);
        if (parentThread?.repo) {
            return {
                repo: parentThread.repo,
                folderHint: parentThread.folder,
                source: 'parent',
                isGitRepo: true,
            };
        }
    }
    const matchedThread = findBestThreadAnyRepo(task, {
        branch,
        minScore: branch ? 6 : 8,
        includeResumed: true,
    });
    if (matchedThread?.repo) {
        return {
            repo: matchedThread.repo,
            folderHint: matchedThread.folder,
            source: 'history',
            isGitRepo: true,
        };
    }
    return current;
}
/** 将 change 的文件路径解析为绝对路径，尝试 fallbackRepo 和 cwd */
function resolveAbsPath(relPath, fallbackRepo) {
    if (relPath.startsWith('/'))
        return relPath;
    // 尝试 fallbackRepo
    const fromRepo = resolve(fallbackRepo, relPath);
    if (existsSync(fromRepo))
        return fromRepo;
    // 尝试 cwd
    const fromCwd = resolve(process.cwd(), relPath);
    if (existsSync(fromCwd))
        return fromCwd;
    // 都找不到，用 fallbackRepo 路径（至少 git rev-parse 可能能工作）
    return fromRepo;
}
/**
 * 检测 changes 中涉及的 repo，返回 Map<repoRoot, changeEntries>
 * 无法检测的 change 归入 fallbackRepo
 */
function detectReposFromChanges(changes, fallbackRepo) {
    const repoMap = new Map();
    for (const change of changes) {
        const filePath = extractFilePath(change);
        let repo = fallbackRepo;
        if (filePath) {
            const absPath = resolveAbsPath(filePath, fallbackRepo);
            if (absPath) {
                const root = gitRepoRoot(absPath);
                // 只在 git root 不是 fallbackRepo 的严格祖先时才采用
                // 否则说明 fallbackRepo 目录本身没有 .git，git 向上找到了更高层的 repo
                // 此时 fallbackRepo 更精确，应保留
                if (root && !fallbackRepo.startsWith(root + '/')) {
                    repo = root;
                }
            }
        }
        if (!repoMap.has(repo))
            repoMap.set(repo, []);
        repoMap.get(repo).push(change);
    }
    return repoMap;
}
// ── Folder 推断 ──
/** 从 changes 的文件路径推断公共子目录 */
function extractFolder(changes) {
    const paths = changes
        .map(c => extractFilePath(c))
        .filter((p) => !!p && !p.startsWith('/'));
    if (paths.length === 0)
        return undefined;
    const dirs = paths.map(p => {
        const parts = p.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    }).filter(Boolean);
    // 所有文件都在根目录，无公共子目录
    if (dirs.length === 0)
        return undefined;
    // 路径分散度检查：如果顶层目录超过 3 个不同的，说明太分散，不推断
    const topDirs = new Set(dirs.map(d => d.split('/')[0]));
    if (topDirs.size > 3)
        return undefined;
    // 找公共前缀目录
    const first = dirs[0].split('/');
    let common = 0;
    for (let i = 0; i < first.length; i++) {
        if (dirs.every(d => d.split('/')[i] === first[i])) {
            common = i + 1;
        }
        else
            break;
    }
    return common > 0 ? first.slice(0, common).join('/') : undefined;
}
// ── 核心 pipeline ──
/** 写入单个 thread 文件，返回 { threadId, path } */
function writeThread(opts) {
    const threadId = generateThreadId();
    const root = opts.root || threadId;
    const frontmatter = [
        '---',
        `id: ${threadId}`,
        `root: ${root}`,
        `repo: ${opts.repo}`,
        `task: ${opts.task}`,
        opts.branch ? `branch: ${opts.branch}` : null,
        opts.parent ? `parent: ${opts.parent}` : null,
        opts.cli ? `cli: ${opts.cli}` : null,
        opts.model ? `model: ${opts.model}` : null,
        opts.folder ? `folder: ${opts.folder}` : null,
        `created: ${opts.created}`,
        `ttl: 7d`,
        '---',
    ].filter(Boolean).join('\n');
    const sections = [];
    if (opts.decisions.length > 0) {
        sections.push('## 决策\n');
        opts.decisions.forEach(d => sections.push(`- ${d}`));
        sections.push('');
    }
    if (opts.changes.length > 0) {
        sections.push('## 变更\n');
        opts.changes.forEach(c => sections.push(`- ${c}`));
        sections.push('');
    }
    if (opts.findings.length > 0) {
        sections.push('## 发现\n');
        opts.findings.forEach(f => sections.push(`- ${f}`));
        sections.push('');
    }
    if (opts.next.length > 0) {
        sections.push('## 待续\n');
        opts.next.forEach(n => sections.push(`- [ ] ${n}`));
        sections.push('');
    }
    sections.push('## 当前状态\n');
    sections.push(opts.status);
    const content = frontmatter + '\n\n' + sections.join('\n') + '\n';
    const filePath = join(THREADS_DIR, `${threadId}.md`);
    writeFileSync(filePath, content, 'utf-8');
    return { threadId, path: filePath };
}
function syncProjectIndexIfPossible(repo) {
    const root = gitRepoRoot(repo);
    if (!root)
        return undefined;
    const normalizedRepo = normalizePathForFrontmatter(repo);
    const normalizedRoot = normalizePathForFrontmatter(root);
    if (normalizedRepo !== normalizedRoot)
        return undefined;
    return syncProjectSessionIndex(normalizedRoot).path;
}
export function checkpoint(input) {
    if (!existsSync(THREADS_DIR)) {
        mkdirSync(THREADS_DIR, { recursive: true });
    }
    const created = new Date().toISOString();
    const task = sanitizeScalar(input.task);
    const branch = input.branch ? sanitizeScalar(input.branch) : undefined;
    const cli = input.cli ? sanitizeScalar(input.cli) : undefined;
    const model = input.model ? sanitizeScalar(input.model) : undefined;
    const status = sanitizeScalar(input.status || '进行中');
    const decisions = sanitizeList(input.decisions || [], ENTRY_LIMITS.decisions);
    const changes = sanitizeList(input.changes || [], ENTRY_LIMITS.changes);
    const findings = sanitizeList(input.findings || [], ENTRY_LIMITS.findings);
    const next = sanitizeList(input.next || [], ENTRY_LIMITS.next);
    const repoContext = inferRepoContext(input, task, branch, resolveRepoContext(input.repo));
    const fallbackRepo = repoContext.repo;
    const parent = resolveParent({
        ...input,
        repo: fallbackRepo,
        task,
        branch,
        cli,
        model,
        status,
        decisions,
        changes,
        findings,
        next,
    });
    const parentThread = parent ? getThreadById(fallbackRepo, parent) : undefined;
    const chainRoot = parentThread?.root || parentThread?.id;
    // 自动检测 changes 中涉及的 repo
    const repoMap = changes.length > 0
        ? detectReposFromChanges(changes, fallbackRepo)
        : new Map([[fallbackRepo, changes]]);
    const repos = [...repoMap.keys()];
    // 单 repo：直接写（可能修正了 repo 字段）
    if (repos.length <= 1) {
        const actualRepo = repos[0] || fallbackRepo;
        const folder = extractFolder(changes) || (actualRepo === fallbackRepo ? repoContext.folderHint : undefined);
        const { threadId, path: filePath } = writeThread({
            repo: actualRepo, task, branch, parent, root: chainRoot, cli, model, folder, created,
            decisions, changes, findings, next, status,
        });
        const sessionIndexPath = syncProjectIndexIfPossible(actualRepo);
        const relatedBoardItems = findMatchingBoardItems(task);
        const hints = detectHints({ status, findings, next, decisions }, relatedBoardItems);
        return {
            success: true, threadId, path: filePath, repo: actualRepo,
            repoSource: actualRepo === fallbackRepo ? repoContext.source : 'git',
            parent,
            stats: { decisions: decisions.length, changes: changes.length, findings: findings.length, next: next.length },
            relatedBoardItems: relatedBoardItems.length > 0 ? relatedBoardItems : undefined,
            hints: hints.length > 0 ? hints : undefined,
            sessionIndexPath,
        };
    }
    // 多 repo：拆分，每个 repo 一个 thread，共享 decisions/findings/next
    const splitThreads = [];
    let primaryResult;
    let primaryRepo;
    for (const [repo, repoChanges] of repoMap) {
        const isPrimary = repo === fallbackRepo || !primaryResult;
        const repoFolder = extractFolder(repoChanges) || (isPrimary ? repoContext.folderHint : undefined);
        const result = writeThread({
            repo, task, branch: isPrimary ? branch : undefined,
            parent: isPrimary ? parent : undefined,
            root: chainRoot,
            cli: isPrimary ? cli : undefined,
            model: isPrimary ? model : undefined,
            folder: repoFolder,
            created, decisions, changes: repoChanges,
            findings, next, status,
        });
        if (isPrimary) {
            primaryResult = result;
            primaryRepo = repo;
        }
        else {
            splitThreads.push({ threadId: result.threadId, repo, path: result.path });
        }
    }
    const primary = primaryResult;
    for (const repo of repos) {
        syncProjectIndexIfPossible(repo);
    }
    const sessionIndexPath = primaryRepo ? syncProjectIndexIfPossible(primaryRepo) : undefined;
    const relatedBoardItems = findMatchingBoardItems(task);
    const hints = detectHints({ status, findings, next, decisions }, relatedBoardItems);
    // 顺便 GC 过期 thread
    gcThreads();
    return {
        success: true,
        threadId: primary.threadId,
        path: primary.path,
        repo: primaryRepo || fallbackRepo,
        repoSource: primaryRepo === fallbackRepo || !primaryRepo ? repoContext.source : 'git',
        parent,
        stats: { decisions: decisions.length, changes: changes.length, findings: findings.length, next: next.length },
        relatedBoardItems: relatedBoardItems.length > 0 ? relatedBoardItems : undefined,
        hints: hints.length > 0 ? hints : undefined,
        splitThreads: splitThreads.length > 0 ? splitThreads : undefined,
        sessionIndexPath,
    };
}
// ── 后处理提示检测 ──
const DONE_KEYWORDS = /完成|done|搞定|finished|已实现|shipped|merged/i;
function detectHints(ctx, boardItems) {
    const hints = [];
    // 1. Recipe 提炼提示：findings ≥ 3 条即触发
    if (ctx.findings.length >= 3) {
        hints.push({
            type: 'recipe_candidate',
            message: `检测到 ${ctx.findings.length} 条发现，建议存为 recipe`,
            data: { findings: ctx.findings },
        });
    }
    // 2. Board 联动：状态为完成 + 有关联 board item
    if (DONE_KEYWORDS.test(ctx.status) && boardItems.length > 0) {
        const items = boardItems.map(i => `[${i.project}] ${i.title}`);
        hints.push({
            type: 'board_done',
            message: `任务已完成，关联看板项可标记 done: ${items.join(', ')}`,
            data: { items: boardItems },
        });
    }
    // 3. Next → Board：有待续事项，建议加入看板
    if (ctx.next.length >= 2) {
        hints.push({
            type: 'next_to_board',
            message: `${ctx.next.length} 项待续，建议加入看板跟踪`,
            data: { next: ctx.next },
        });
    }
    return hints;
}
// ── 格式化回执 ──
export function formatDistillReceipt(result) {
    const { threadId, parent, stats } = result;
    let text = `已蒸馏 — ${stats.decisions}决策 ${stats.changes}变更 ${stats.findings}发现 ${stats.next}待续`;
    if (parent) {
        text += ` (链接: ${parent})`;
    }
    // 多 repo 拆分信息
    if (result.splitThreads && result.splitThreads.length > 0) {
        text += '\n\n**多 repo 拆分**:';
        for (const st of result.splitThreads) {
            const repoName = st.repo.split('/').pop() || st.repo;
            text += `\n- \`${st.threadId}\` → ${repoName}`;
        }
    }
    if (result.relatedBoardItems && result.relatedBoardItems.length > 0) {
        const items = result.relatedBoardItems.map(i => `[${i.project}] ${i.title}`).join(', ');
        text += `\n**关联看板**: ${items}`;
    }
    // 显示后处理提示
    if (result.hints && result.hints.length > 0) {
        text += '\n\n---\n**建议**';
        const HINT_ICONS = { recipe_candidate: '[recipe]', board_done: '[done]', next_to_board: '[board]' };
        for (const hint of result.hints) {
            text += `\n${HINT_ICONS[hint.type] || '•'} ${hint.message}`;
        }
    }
    if (result.sessionIndexPath) {
        text += `\n**Session Index**: ${result.sessionIndexPath}`;
    }
    if (result.repoSource === 'raw') {
        text += `\n**注意**: repo 未校验为 git root，当前记录绑定到 ${result.repo}`;
    }
    text += `\n\n**恢复口令: \`${threadId}\`**`;
    return text;
}
