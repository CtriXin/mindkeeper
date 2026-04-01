/**
 * MCP Tool Handlers — 8 tools
 *
 * 从 server.ts 拆出的业务逻辑，每个 tool 一个函数。
 * server.ts 只负责 MCP 协议层和路由分发。
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadIndex, saveIndex, loadRecipe, saveRecipe, recipeMetaFrom, touchRecipes } from './storage.js';
import { searchRecipes } from './router.js';
import { bootstrapQuick, formatQuickResume, getThreadById, listRecentThreads, findBestThread, loadThreadDetails } from './bootstrap.js';
import { checkpoint, formatDistillReceipt } from './distill.js';
import { loadBoard, createBoard, addBoardItem, updateBoardItem, addBoardMemo, checkBoards, listBoardSummaries, archiveStaleItems, saveBoard, checkRecipeStaleness, deprecateStaleRecipes, getRecipeHealthSummary, findMatchingBoardItems, } from './storage.js';
import { QUADRANT_KEYS, QUADRANT_LABELS } from './types.js';
import { getRealHome } from './env.js';
// ── 自动检测 cli/model ──
function detectCli() {
    // MMS 环境：HOME 路径包含 gateway 类型
    const home = process.env.HOME || '';
    const mmsMatch = home.match(/\/([^/]+)-gateway\/s\//);
    if (mmsMatch) {
        const gateway = mmsMatch[1]; // claude, codex, cursor 等
        return `${gateway}-code`;
    }
    // 非 MMS：检查常见环境变量
    if (process.env.CLAUDE_CODE_ENTRYPOINT)
        return 'claude-code';
    if (process.env.CURSOR_SESSION_ID)
        return 'cursor';
    return undefined;
}
function detectModel() {
    // MMS 环境注入的模型变量
    const model = process.env.ANTHROPIC_MODEL
        || process.env.OPENAI_MODEL
        || process.env.MMS_MODEL;
    if (!model)
        return undefined;
    // 去掉尾部的 context window 标记 [1m] 等
    return model.replace(/\[[\w]+\]$/, '');
}
function ok(text) {
    return { content: [{ type: 'text', text }] };
}
function err(text) {
    return { content: [{ type: 'text', text }], isError: true };
}
// ── 可选集成: 飞书推送 ──
const FEISHU_CONFIG_PATH = join(getRealHome(), '.sce', 'feishu.json');
function readFeishuTarget() {
    try {
        if (!existsSync(FEISHU_CONFIG_PATH))
            return null;
        const cfg = JSON.parse(readFileSync(FEISHU_CONFIG_PATH, 'utf-8'));
        if (cfg.user_id)
            return { type: 'user', id: cfg.user_id };
        if (cfg.chat_id)
            return { type: 'chat', id: cfg.chat_id };
        return null;
    }
    catch {
        return null;
    }
}
function findLarkCli() {
    const explicit = process.env.LARK_CLI_PATH;
    if (explicit && existsSync(explicit))
        return explicit;
    try {
        return execSync('which lark-cli', { encoding: 'utf-8', timeout: 2000 }).trim();
    }
    catch {
        return '';
    }
}
// ── ID 生成 ──
function generateRecipeId(idx, project) {
    const prefix = project
        ? project.split(/[_\-/]/).filter(Boolean).pop().toLowerCase()
        : 'mk';
    const pattern = new RegExp(`^(?:rcp-)?${prefix}-(\\d+)$`);
    let max = 0;
    for (const r of idx.recipes) {
        const m = r.id.match(pattern);
        if (m)
            max = Math.max(max, Number(m[1]));
    }
    return `rcp-${prefix}-${String(max + 1).padStart(3, '0')}`;
}
// ── Board 格式化 ──
function formatBoard(board) {
    const lines = [];
    lines.push(`# ${board.project}`);
    if (board.repo)
        lines.push(`repo: ${board.repo}`);
    lines.push(`更新: ${board.last_updated} | stale 警告: ${board.stale_warning_days || 14} 天`);
    const icons = ['🔴', '🟡', '🟢', '⚪'];
    for (let i = 0; i < QUADRANT_KEYS.length; i++) {
        const qk = QUADRANT_KEYS[i];
        const items = board.quadrants[qk].filter(item => item.status !== 'archived');
        lines.push(`\n${icons[i]} ${QUADRANT_LABELS[qk]}`);
        if (items.length === 0) {
            lines.push('  (空)');
            continue;
        }
        for (const item of items) {
            const statusMark = item.status === 'done' ? '~~' : '';
            let line = `  - [${item.id}] ${statusMark}${item.title}${statusMark}`;
            if (item.deadline)
                line += ` (${item.deadline})`;
            if (item.assignee)
                line += ` @${item.assignee}`;
            if (item.status === 'done')
                line += ' ✓';
            lines.push(line);
        }
    }
    if (board.memos.length > 0) {
        lines.push('\n📝 备忘');
        for (const m of board.memos) {
            lines.push(`  - ${m.text} (${m.created})`);
        }
    }
    return lines;
}
// ── Tool Handlers ──
export function handleLearn(args, index) {
    // Unpack compressed meta and files params
    if (args.meta && typeof args.meta === 'string') {
        try {
            Object.assign(args, JSON.parse(args.meta));
        }
        catch { /* ignore malformed meta */ }
    }
    if (args.files && typeof args.files === 'string') {
        try {
            args.files = JSON.parse(args.files);
        }
        catch {
            args.files = [];
        }
    }
    const knowledgeType = args.type === 'insight' ? 'insight' : 'recipe';
    const triggers = args.triggers || [];
    const summary = String(args.summary);
    const steps = args.steps || [];
    const files = (args.files || []).map((f) => ({
        path: String(f.path),
        description: String(f.description || ''),
    }));
    const gotchas = args.gotchas || [];
    const corrections = args.corrections || [];
    const conclusion = args.conclusion ? String(args.conclusion) : undefined;
    const why = args.why ? String(args.why) : undefined;
    const when_to_apply = args.when_to_apply ? String(args.when_to_apply) : undefined;
    const repo = args.repo ? String(args.repo) : undefined;
    const branch = args.branch ? String(args.branch) : undefined;
    const framework = args.framework ? String(args.framework) : undefined;
    const project = args.project ? String(args.project) : undefined;
    const tags = args.tags || undefined;
    const confidence = Number(args.confidence) || 0.9;
    const changelogNote = args.changelog_note ? String(args.changelog_note) : undefined;
    const id = args.id ? String(args.id) : generateRecipeId(index, project);
    const existing = loadRecipe(id);
    const now = new Date().toISOString().slice(0, 10);
    if (existing) {
        existing.type = knowledgeType;
        existing.triggers = triggers;
        existing.summary = summary;
        existing.steps = steps;
        existing.files = files;
        existing.gotchas = gotchas;
        existing.corrections = corrections;
        existing.conclusion = conclusion;
        existing.why = why;
        existing.when_to_apply = when_to_apply;
        if (repo)
            existing.repo = repo;
        if (branch)
            existing.branch = branch;
        if (framework)
            existing.framework = framework;
        if (project)
            existing.project = project;
        if (tags)
            existing.tags = tags;
        existing.confidence = confidence;
        existing.updated = new Date().toISOString();
        existing.changelog.push({ date: now, description: changelogNote || '更新' });
        saveRecipe(existing);
        const metaIdx = index.recipes.findIndex(r => r.id === id);
        if (metaIdx >= 0) {
            index.recipes[metaIdx] = recipeMetaFrom(existing);
        }
        else {
            index.recipes.push(recipeMetaFrom(existing));
        }
        saveIndex(index);
        return ok(`已更新 recipe: ${id}\n` +
            `步骤: ${steps.length} | 文件: ${files.length} | 坑点: ${gotchas.length} | 纠正: ${corrections.length}\n` +
            `Changelog: +1 (共 ${existing.changelog.length} 条)`);
    }
    // 新建
    const recipe = {
        id, type: knowledgeType, triggers, summary, repo, branch,
        steps, files, gotchas, corrections, conclusion, why, when_to_apply,
        framework, project, tags, confidence,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        accessCount: 0,
        changelog: [{ date: now, description: changelogNote || '首次记录' }],
    };
    const boardMatches = findMatchingBoardItems(summary + ' ' + triggers.join(' '));
    if (boardMatches.length > 0) {
        recipe.boardItemId = boardMatches[0].itemId;
    }
    saveRecipe(recipe);
    index.recipes = index.recipes.filter(r => r.id !== id);
    index.recipes.push(recipeMetaFrom(recipe));
    saveIndex(index);
    const typeLabel = knowledgeType === 'insight' ? 'insight' : 'recipe';
    let learnText = `已存入 ${typeLabel}: ${id}\n触发词: ${triggers.join(', ')}`;
    if (knowledgeType === 'insight') {
        learnText += `\n结论: ${conclusion || '-'} | 原因: ${why ? '✓' : '-'} | 适用场景: ${when_to_apply ? '✓' : '-'}`;
    }
    else {
        learnText += `\n步骤: ${steps.length} | 文件: ${files.length} | 坑点: ${gotchas.length} | 纠正: ${corrections.length}`;
    }
    if (recipe.boardItemId) {
        const match = boardMatches[0];
        learnText += `\n📌 已关联看板: [${match.project}] ${match.title}`;
    }
    return ok(learnText);
}
export function handleRecall(args, index) {
    const query = String(args.query || '');
    const limit = Number(args.limit) || 3;
    const results = searchRecipes(index, query, limit);
    if (results.length === 0) {
        return ok('未找到相关 recipe。');
    }
    touchRecipes(index, results.map(r => r.recipe.id));
    const recallStaleSignals = checkRecipeStaleness(index);
    const recallStaleMap = new Map(recallStaleSignals.map(s => [s.recipeId, s.reasons]));
    const text = results.map((r, i) => {
        const rec = r.recipe;
        const parts = [];
        const typeLabel = rec.type === 'insight' ? '💡 insight' : '📋 recipe';
        parts.push(`## ${i + 1}. ${rec.summary} [${typeLabel}] (score: ${r.score.toFixed(2)})`);
        parts.push(`**ID**: ${rec.id} | **框架**: ${rec.framework || '通用'} | **项目**: ${rec.project || '-'}`);
        if (rec.repo || rec.branch) {
            const repoShort = rec.repo?.replace(/^\/Users\/[^/]+\//, '~/') || '-';
            parts.push(`**源码位置**: ${repoShort} @ \`${rec.branch || 'main'}\``);
        }
        parts.push(`**触发词匹配**: ${r.matchedTriggers.join(', ')}`);
        if (rec.conclusion) {
            parts.push('', '### 结论', rec.conclusion);
        }
        if (rec.why) {
            parts.push('', '### 原因', rec.why);
        }
        if (rec.when_to_apply) {
            parts.push('', '### 适用场景', rec.when_to_apply);
        }
        const steps = Array.isArray(rec.steps) ? rec.steps : [];
        const files = Array.isArray(rec.files) ? rec.files : [];
        const gotchas = Array.isArray(rec.gotchas) ? rec.gotchas : [];
        const corrections = Array.isArray(rec.corrections) ? rec.corrections : [];
        const changelog = Array.isArray(rec.changelog) ? rec.changelog : [];
        if (steps.length > 0) {
            parts.push('', '### 实现步骤');
            steps.forEach((s, j) => parts.push(`${j + 1}. ${s}`));
        }
        if (files.length > 0) {
            parts.push('', '### 涉及文件');
            files.forEach(f => parts.push(`- \`${f.path}\` — ${f.description}`));
        }
        if (gotchas.length > 0) {
            parts.push('', '### 已知坑点');
            gotchas.forEach(g => parts.push(`- ⚠️ ${g}`));
        }
        if (corrections.length > 0) {
            parts.push('', '### 用户纠正');
            corrections.forEach(c => parts.push(`- 🔴 ${c}`));
        }
        if (changelog.length > 0) {
            parts.push('', '### Changelog');
            changelog.forEach(e => parts.push(`- ${e.date}: ${e.description}`));
        }
        const staleReasons = recallStaleMap.get(rec.id);
        if (staleReasons) {
            parts.push('', `> ⚠️ 注意: 此 recipe 可能过时 — ${staleReasons.join(', ')}`);
        }
        return parts.join('\n');
    }).join('\n\n---\n\n');
    return ok(text);
}
export function handleList(args, index) {
    let recipes = index.recipes;
    if (args.project)
        recipes = recipes.filter(r => r.project === String(args.project));
    if (args.tag) {
        const tag = String(args.tag).toLowerCase();
        recipes = recipes.filter(r => r.tags?.some(t => t.toLowerCase() === tag));
    }
    if (args.framework) {
        const fw = String(args.framework).toLowerCase();
        recipes = recipes.filter(r => r.framework?.toLowerCase() === fw);
    }
    if (recipes.length === 0) {
        return ok('Recipe 库为空。');
    }
    const staleSignals = checkRecipeStaleness(index);
    const staleMap = new Map(staleSignals.map(s => [s.recipeId, s.reasons]));
    const text = recipes.map(r => {
        const typeIcon = r.type === 'insight' ? '💡' : '📋';
        const fw = r.framework ? `[${r.framework}]` : '';
        const proj = r.project ? `(${r.project})` : '';
        const staleTag = staleMap.has(r.id) ? ` ⚠️[${staleMap.get(r.id).join(', ')}]` : '';
        return `- ${typeIcon} **${r.id}**: ${r.summary} ${fw} ${proj} — ${r.triggers.slice(0, 3).join(', ')}${staleTag}`;
    }).join('\n');
    const health = getRecipeHealthSummary(index);
    const healthLine = `\n---\n**健康**: ${health.total} recipes — ${health.active} 活跃, ${health.stale} 过时, ${health.deprecated} 已降权`;
    return ok(`共 ${recipes.length} 个 recipe:\n\n${text}${healthLine}`);
}
export function handleBootstrap(args, index) {
    if (!args.repo) {
        return err('brain_bootstrap 需要 repo 路径。');
    }
    if (args.thread) {
        if (!getThreadById(String(args.repo), String(args.thread))) {
            return err(`thread 不存在或不属于当前 repo: ${String(args.thread)}`);
        }
        const qr = bootstrapQuick({
            task: String(args.task),
            repo: String(args.repo),
            thread: String(args.thread),
        });
        return ok(formatQuickResume(qr));
    }
    const signals = checkBoards();
    const threads = listRecentThreads(String(args.repo), 5);
    const lines = [];
    lines.push(`> **任务**: ${String(args.task)}`);
    const recallHints = searchRecipes(index, String(args.task), 3).filter(r => r.score > 0.5);
    if (recallHints.length > 0) {
        lines.push('\n**相关经验**');
        for (const r of recallHints) {
            lines.push(`  - \`${r.recipe.id}\` — ${r.recipe.summary}`);
        }
    }
    if (signals.length > 0) {
        lines.push('\n**项目看板**');
        for (const s of signals.slice(0, 5)) {
            const icon = s.type === 'overdue' ? '🔴' : s.type === 'deadline_soon' ? '🟡' : s.type === 'stale' ? '⚠️' : '📋';
            lines.push(`  ${icon} **${s.project}** — ${s.message}`);
        }
    }
    const bestThread = findBestThread(String(args.repo), String(args.task));
    if (bestThread) {
        const details = loadThreadDetails(bestThread);
        const repoName = bestThread.repo.split('/').pop() || bestThread.repo;
        lines.push(`\n**上次进度** (${repoName})`);
        lines.push(`  \`${bestThread.id}\` — ${bestThread.task}`);
        if (details.nextSteps.length > 0) {
            lines.push('  待续:');
            details.nextSteps.forEach(s => lines.push(`    - ${s}`));
        }
        if (details.decisions.length > 0) {
            lines.push('  决策:');
            details.decisions.forEach(d => lines.push(`    - ${d}`));
        }
    }
    else if (threads.length > 0) {
        lines.push('\n**最近对话**');
        const grouped = new Map();
        for (const t of threads) {
            const key = t.repo.split('/').pop() || t.repo;
            if (!grouped.has(key))
                grouped.set(key, []);
            grouped.get(key).push(t);
        }
        for (const [repoName, repoThreads] of grouped) {
            const ids = repoThreads.map(t => t.id).join('  ');
            lines.push(`  ${repoName}/  ${ids}`);
        }
        lines.push('');
    }
    else if (signals.length === 0) {
        lines.push('\n新任务，直接开始。');
    }
    return ok(lines.join('\n'));
}
export function handleCheckpoint(args) {
    if (!args.repo || !args.task || !args.status) {
        return err('brain_checkpoint 需要 repo、task、status。');
    }
    const result = checkpoint({
        repo: String(args.repo),
        task: String(args.task),
        branch: args.branch ? String(args.branch) : undefined,
        parent: args.parent ? String(args.parent) : undefined,
        cli: args.cli ? String(args.cli) : detectCli(),
        model: args.model ? String(args.model) : detectModel(),
        decisions: args.decisions || [],
        changes: args.changes || [],
        findings: args.findings || [],
        next: args.next || [],
        status: String(args.status),
    });
    // 自动提取 recipe：findings ≥ 3 触发，增量追加
    const recipeHint = result.hints?.find(h => h.type === 'recipe_candidate');
    let autoRecipeNote = '';
    if (recipeHint) {
        try {
            const index = loadIndex();
            const repoStr = String(args.repo);
            const projectName = repoStr.split('/').filter(Boolean).pop() || 'unknown';
            const newFindings = recipeHint.data?.findings || [];
            const newDecisions = args.decisions || [];
            const autoId = `rcp-${projectName.split(/[_\-/]/).filter(Boolean).pop().toLowerCase()}-001`;
            const existing = loadRecipe(autoId);
            // 增量：合并已有内容，去重
            const mergedSteps = existing
                ? [...existing.steps, ...newDecisions.filter(d => !existing.steps.includes(d))]
                : newDecisions;
            const mergedGotchas = existing
                ? [...existing.gotchas, ...newFindings.filter(f => !existing.gotchas.includes(f))]
                : newFindings;
            const mergedTriggers = existing
                ? [...new Set([...existing.triggers, String(args.task)])]
                : [String(args.task)];
            const autoResult = handleLearn({
                id: autoId,
                triggers: mergedTriggers,
                summary: existing
                    ? existing.summary
                    : `${projectName} 自动提取经验`,
                steps: mergedSteps,
                gotchas: mergedGotchas,
                repo: repoStr,
                branch: args.branch,
                project: projectName,
                confidence: 0.6,
                changelog_note: `distill 自动追加 (${result.threadId})`,
            }, index);
            if (autoResult.content?.[0]?.type === 'text') {
                autoRecipeNote = '\n\n**[auto-recipe]** ' + autoResult.content[0].text;
            }
        }
        catch { /* 自动提取失败不影响蒸馏 */ }
    }
    const receipt = formatDistillReceipt(result) + autoRecipeNote;
    // 推送飞书（可选，静默）
    try {
        const envChat = process.env.MINDKEEPER_FEISHU_CHAT;
        const target = envChat ? { type: 'chat', id: envChat } : readFeishuTarget();
        if (target) {
            const larkBin = findLarkCli();
            if (larkBin) {
                const repoName = String(args.repo).split('/').pop() || '';
                const msg = `**MindKeeper** · ${repoName}\\n${String(args.status)}\\n${result.threadId}`;
                const targetFlag = target.type === 'user' ? `--user-id "${target.id}"` : `--chat-id "${target.id}"`;
                execSync(`printf '${msg.replace(/'/g, "'\\''")}' | xargs -0 ${larkBin} im +messages-send ${targetFlag} --as bot --markdown`, { timeout: 5000, stdio: 'ignore', shell: '/bin/bash' });
            }
        }
    }
    catch { /* 推送失败不影响蒸馏 */ }
    return ok(receipt);
}
export function handleThreads(args) {
    const repo = args.repo ? String(args.repo) : undefined;
    const threads = listRecentThreads(repo, 50);
    if (threads.length === 0) {
        return ok(repo ? `${repo} 没有待恢复的 thread。` : '没有待恢复的 thread。');
    }
    const grouped = new Map();
    for (const t of threads) {
        const key = t.repo || '(unknown)';
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(t);
    }
    const lines = [`共 ${threads.length} 个待恢复 thread:\n`];
    for (const [repoName, repoThreads] of grouped) {
        const short = repoName.replace(/^\/Users\/[^/]+\//, '~/');
        lines.push(`**${short}**`);
        for (const t of repoThreads) {
            const age = Math.round((Date.now() - t.createdAtMs) / 86400000);
            const ageStr = age === 0 ? '今天' : `${age}天前`;
            lines.push(`  \`${t.id}\` ${ageStr} — ${t.task.slice(0, 60)}`);
        }
        lines.push('');
    }
    lines.push('恢复方式：发送 thread id（如 `dst-20260326-xxx`）');
    return ok(lines.join('\n'));
}
export function handleBoard(args) {
    const project = String(args.project || '');
    const action = String(args.action || 'read');
    switch (action) {
        case 'list': {
            const summaries = listBoardSummaries();
            if (summaries.length === 0) {
                return ok('没有项目看板。用 brain_board 添加第一个项目。');
            }
            const lines = [`共 ${summaries.length} 个项目看板:\n`];
            for (const s of summaries) {
                const statusIcon = s.activeCount === 0 ? '✅' : '📋';
                lines.push(`  ${statusIcon} **${s.project}** — ${s.activeCount} 项待办 (更新: ${s.lastUpdated})`);
            }
            return ok(lines.join('\n'));
        }
        case 'read': {
            const board = loadBoard(project);
            if (!board) {
                return ok(`项目 "${project}" 的看板不存在。用 action="write" 创建。`);
            }
            return ok(formatBoard(board).join('\n'));
        }
        case 'write': {
            let rawData = args.data;
            if (typeof rawData === 'string') {
                try {
                    rawData = JSON.parse(rawData);
                }
                catch {
                    return err('action="write" 的 data 参数 JSON 解析失败。');
                }
            }
            const data = rawData;
            if (!data) {
                return err('action="write" 需要 data 参数。');
            }
            const board = createBoard(data.project || project, data.repo, data.stale_warning_days);
            board.quadrants = (data.quadrants || board.quadrants);
            board.memos = (data.memos || board.memos);
            saveBoard(board);
            return ok(`已创建/更新项目看板: ${board.project}`);
        }
        case 'add_item': {
            const title = String(args.title || '');
            const quadrant = args.quadrant || 'q2';
            const item = addBoardItem(project, title, quadrant, {
                deadline: args.deadline ? String(args.deadline) : undefined,
                assignee: args.assignee ? String(args.assignee) : undefined,
                source: args.source ? String(args.source) : undefined,
                source_ref: args.source_ref ? String(args.source_ref) : undefined,
            });
            if (!item) {
                return err('添加失败。');
            }
            return ok(`已添加到 ${QUADRANT_LABELS[quadrant]}: [${item.id}] ${item.title}${item.deadline ? ` (截止: ${item.deadline})` : ''}`);
        }
        case 'update_item': {
            const itemId = String(args.item_id || '');
            let rawChanges = args.changes;
            if (typeof rawChanges === 'string') {
                try {
                    rawChanges = JSON.parse(rawChanges);
                }
                catch {
                    rawChanges = {};
                }
            }
            const changes = (rawChanges || {});
            const item = updateBoardItem(project, itemId, changes);
            if (!item) {
                return err(`未找到条目: ${itemId}`);
            }
            const changeDesc = Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(', ');
            let resultText = `已更新 [${itemId}]: ${changeDesc}`;
            if (changes.status === 'done') {
                resultText += '\n\n💡 如果这项工作有可复用模式，考虑用 brain_learn 提取 recipe。';
            }
            return ok(resultText);
        }
        case 'add_memo': {
            const text = String(args.text || '');
            if (!text) {
                return err('add_memo 需要 text 参数。');
            }
            const memo = addBoardMemo(project, text, args.source ? String(args.source) : undefined);
            if (!memo) {
                return err('添加备忘失败。');
            }
            return ok(`已添加备忘: ${text}`);
        }
        case 'archive': {
            const count = archiveStaleItems(project);
            return ok(count > 0 ? `已归档 ${count} 个过期条目。` : '没有需要归档的条目。');
        }
        default:
            return err(`未知操作: ${action}`);
    }
}
export function handleCheck(args, index) {
    const deadlineDays = Number(args.deadline_days) || undefined;
    const signals = checkBoards({ deadlineDays });
    const deprecation = deprecateStaleRecipes(index);
    const lines = [];
    if (signals.length > 0) {
        const projectSignals = new Map();
        for (const s of signals) {
            const existing = projectSignals.get(s.project);
            const priorityMap = { overdue: 0, deadline_soon: 1, stale: 2, stale_item: 3, active: 4 };
            const priority = priorityMap[s.type] ?? 5;
            const existingPriority = existing ? (priorityMap[existing.type] ?? 5) : 99;
            if (priority < existingPriority) {
                projectSignals.set(s.project, s);
            }
        }
        lines.push('**项目看板**\n');
        for (const [, signal] of projectSignals) {
            const icon = signal.type === 'overdue' ? '🔴' : signal.type === 'deadline_soon' ? '🟡' : signal.type === 'stale' ? '⚠️' : signal.type === 'stale_item' ? '💤' : '📋';
            lines.push(`  ${icon} **${signal.project}** — ${signal.message}`);
        }
        const urgentSignals = signals.filter(s => s.type === 'overdue' || s.type === 'deadline_soon');
        if (urgentSignals.length > 1) {
            lines.push('\n紧急事项:');
            for (const s of urgentSignals) {
                const icon = s.type === 'overdue' ? '🔴' : '🟡';
                lines.push(`  ${icon} [${s.project}] ${s.message}`);
            }
        }
    }
    const recipeStaleSignals = checkRecipeStaleness(index);
    if (recipeStaleSignals.length > 0 || deprecation.deprecated.length > 0) {
        lines.push('\n**Recipe 健康**');
        lines.push(`  ${deprecation.total} 个 — ${deprecation.active} 活跃, ${deprecation.stale} 过时, ${deprecation.deprecatedCount} 已降权`);
        if (deprecation.deprecated.length > 0) {
            lines.push(`  🔻 本次降权: ${deprecation.deprecated.join(', ')}`);
        }
        const topStale = recipeStaleSignals.slice(0, 3);
        for (const s of topStale) {
            lines.push(`  ⚠️ ${s.recipeId}: ${s.reasons.join(', ')}`);
        }
    }
    if (lines.length === 0) {
        return ok('所有项目状态正常，无信号。');
    }
    return ok(lines.join('\n'));
}
