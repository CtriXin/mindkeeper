import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { getRealHome } from './env.js';
import { loadFragments } from './fragments.js';
const SCE_DIR = join(getRealHome(), '.sce');
const ISSUE_LINKS_DIR = join(SCE_DIR, 'issue-links');
function ensureIssueLinksDir() {
    if (!existsSync(ISSUE_LINKS_DIR)) {
        mkdirSync(ISSUE_LINKS_DIR, { recursive: true });
    }
}
function normalizeScalar(value) {
    return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeSegment(value, field) {
    const normalized = normalizeScalar(value);
    if (!normalized) {
        throw new Error(`${field} 不能为空。`);
    }
    if (normalized === '.'
        || normalized === '..'
        || normalized.includes('/')
        || normalized.includes('\\')
        || normalized.includes('\0')) {
        throw new Error(`${field} 非法: ${normalized}`);
    }
    return normalized;
}
function issueLinkPath(rootId) {
    return join(ISSUE_LINKS_DIR, `${rootId}.json`);
}
export function saveIssueLink(record) {
    ensureIssueLinksDir();
    const normalized = {
        rootId: normalizeScalar(record.rootId),
        project: normalizeSegment(record.project, 'project'),
        issue: normalizeSegment(record.issue, 'issue'),
        repo: record.repo ? normalizeScalar(record.repo) : undefined,
        updated: new Date().toISOString(),
    };
    writeFileSync(issueLinkPath(normalized.rootId), JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
}
export function loadIssueLink(rootId) {
    ensureIssueLinksDir();
    const path = issueLinkPath(rootId);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
function issueTrackingRoot() {
    const explicit = process.env.BRAINKEEPER_ISSUE_TRACKING_ROOT || process.env.MINDKEEPER_ISSUE_TRACKING_ROOT;
    if (!explicit)
        return null;
    const normalized = explicit.trim();
    if (!normalized)
        return null;
    return normalized;
}
function issueMdPath(root, project, issue) {
    const safeProject = normalizeSegment(project, 'project');
    const safeIssue = normalizeSegment(issue, 'issue');
    const trackingRoot = resolve(root);
    const target = resolve(trackingRoot, 'issues', safeProject, safeIssue, 'issue.md');
    const prefix = `${trackingRoot}${sep}`;
    if (target !== trackingRoot && !target.startsWith(prefix)) {
        throw new Error(`issue 路径越界: ${target}`);
    }
    return target;
}
function upsertSection(text, title, bodyLines) {
    const normalizedBody = bodyLines.length > 0 ? bodyLines.join('\n') : '- (empty)';
    const sectionBlock = `## ${title}\n${normalizedBody}\n`;
    const lines = text.split('\n');
    const header = `## ${title}`;
    const start = lines.findIndex(line => line.trim() === header);
    if (start < 0) {
        const trimmed = text.trimEnd();
        return `${trimmed}\n\n${sectionBlock}`.trimEnd() + '\n';
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
            end = i;
            break;
        }
    }
    const before = lines.slice(0, start).join('\n').replace(/\s*$/, '');
    const after = lines.slice(end).join('\n').replace(/^\s*/, '');
    const middle = sectionBlock.trimEnd();
    return [before, middle, after].filter(Boolean).join('\n\n').trimEnd() + '\n';
}
function formatFragmentLine(fragment) {
    const stamp = fragment.created.replace('T', ' ').slice(0, 16);
    const nextHint = fragment.next[0] ? ` -> ${fragment.next[0]}` : '';
    return `- ${stamp} [${fragment.kind}] ${fragment.summary}${nextHint}`;
}
export function syncIssueDigest(thread) {
    const rootId = thread.root || thread.id;
    const link = loadIssueLink(rootId);
    if (!link) {
        throw new Error(`root ${rootId} 尚未绑定 issue。请先调用 brain_link_issue。`);
    }
    const trackingRoot = issueTrackingRoot();
    if (!trackingRoot) {
        throw new Error('未设置 BRAINKEEPER_ISSUE_TRACKING_ROOT（兼容 MINDKEEPER_ISSUE_TRACKING_ROOT），无法同步 issue digest。');
    }
    const issueMd = issueMdPath(trackingRoot, link.project, link.issue);
    if (!existsSync(issueMd)) {
        throw new Error(`issue 文件不存在: ${issueMd}`);
    }
    const recentFragments = loadFragments(rootId, 8);
    const reflections = recentFragments.filter(fragment => fragment.kind === 'reflect');
    const normalFragments = recentFragments.filter(fragment => fragment.kind !== 'reflect');
    let text = readFileSync(issueMd, 'utf-8');
    text = upsertSection(text, 'Mindkeeper Thread', [
        `- root: \`${rootId}\``,
        `- latest snapshot: \`${thread.id}\``,
        `- repo: \`${thread.repo}\``,
        `- task: ${thread.task}`,
        `- thread status: ${thread.status || '进行中'}`,
    ]);
    text = upsertSection(text, 'Mindkeeper Fragments', normalFragments.length > 0 ? normalFragments.map(formatFragmentLine) : ['- 暂无 fragment']);
    text = upsertSection(text, 'Mindkeeper Reflections', reflections.length > 0 ? reflections.map(formatFragmentLine) : ['- 暂无 reflection']);
    writeFileSync(issueMd, text, 'utf-8');
    return {
        path: issueMd,
        rootId,
        issue: link.issue,
        project: link.project,
        fragmentCount: recentFragments.length,
    };
}
export function defaultIssueProject(repo) {
    return basename(repo) || 'unknown';
}
