import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('issue sync', () => {
  const testDir = join(tmpdir(), `brainkeeper-issue-sync-test-${Date.now()}`);
  const issueRoot = join(testDir, 'issue-tracking');
  let originalHome: string | undefined;
  let originalIssueRoot: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalIssueRoot = process.env.BRAINKEEPER_ISSUE_TRACKING_ROOT;
    process.env.HOME = testDir;
    process.env.BRAINKEEPER_ISSUE_TRACKING_ROOT = issueRoot;
    mkdirSync(join(testDir, '.sce', 'threads'), { recursive: true });
    mkdirSync(join(issueRoot, 'issues', 'brainkeeper', 'test-issue'), { recursive: true });
    writeFileSync(join(issueRoot, 'issues', 'brainkeeper', 'test-issue', 'issue.md'), '# Issue\n', 'utf-8');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.BRAINKEEPER_ISSUE_TRACKING_ROOT = originalIssueRoot;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should link a root to issue-tracking and sync digest sections', async () => {
    const { handleFragment, handleLinkIssue, handleSyncIssue } = await import('../src/handlers.js');

    const fragmentResult = handleFragment({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
      kind: 'debug',
      summary: '定位 401 根因',
      findings: ['token cache 未清'],
      next: ['补认证链路日志'],
    });
    expect(fragmentResult.isError).not.toBe(true);

    const linkResult = handleLinkIssue({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
      project: 'brainkeeper',
      issue: 'test-issue',
    });
    expect(linkResult.isError).not.toBe(true);

    const syncResult = handleSyncIssue({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
    });
    expect(syncResult.isError).not.toBe(true);

    const issueMd = readFileSync(join(issueRoot, 'issues', 'brainkeeper', 'test-issue', 'issue.md'), 'utf-8');
    expect(issueMd).toContain('## Mindkeeper Thread');
    expect(issueMd).toContain('## Mindkeeper Fragments');
    expect(issueMd).toContain('root: `');
    expect(issueMd).toContain('thread status:');
    expect(issueMd).toContain('[debug] 定位 401 根因');
  });

  it('should not seed a new thread when sync issue fails without any existing thread', async () => {
    const { handleSyncIssue } = await import('../src/handlers.js');

    const result = handleSyncIssue({
      repo: '/tmp/no-history-repo',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('当前 repo 还没有可用的 thread');
    expect(readdirSync(join(testDir, '.sce', 'threads')).filter(name => name.endsWith('.md'))).toHaveLength(0);
  });

  it('should reject unsafe issue path segments', async () => {
    const { handleFragment, handleLinkIssue } = await import('../src/handlers.js');

    const fragmentResult = handleFragment({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
      kind: 'debug',
      summary: '准备绑定 issue',
    });
    expect(fragmentResult.isError).not.toBe(true);

    const linkResult = handleLinkIssue({
      repo: '/tmp/test-repo',
      project: '../escape',
      issue: 'test-issue',
    });

    expect(linkResult.isError).toBe(true);
    expect(linkResult.content[0].text).toContain('project 非法');
  });
});
