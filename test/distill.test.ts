import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('distill checkpoint', () => {
  const testDir = join(tmpdir(), `brainkeeper-distill-test-${Date.now()}`);
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
    mkdirSync(join(testDir, '.sce', 'threads'), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create a thread file with correct frontmatter', async () => {
    const { checkpoint } = await import('../src/distill.js');

    const result = checkpoint({
      repo: '/tmp/test-repo',
      task: 'test checkpoint',
      status: '进行中',
      decisions: ['chose A over B'],
      changes: ['src/foo.ts: added bar()'],
      findings: ['discovered X'],
      next: ['implement Y'],
    });

    expect(result.success).toBe(true);
    expect(result.threadId).toMatch(/^dst-\d{4}-[a-z0-9]+$/);
    expect(result.stats.decisions).toBe(1);
    expect(result.stats.changes).toBe(1);
    expect(result.stats.findings).toBe(1);
    expect(result.stats.next).toBe(1);

    // 验证文件内容
    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain('repo: /tmp/test-repo');
    expect(content).toContain('task: test checkpoint');
    expect(content).toContain('## 决策');
    expect(content).toContain('chose A over B');
    expect(content).toContain('## 待续');
    expect(content).toContain('implement Y');
  });

  it('should enforce entry limits', async () => {
    const { checkpoint } = await import('../src/distill.js');

    const result = checkpoint({
      repo: '/tmp/test-repo',
      task: 'test limits',
      status: 'ok',
      decisions: Array(10).fill('decision'),
      changes: Array(20).fill('change'),
      findings: [],
      next: [],
    });

    expect(result.stats.decisions).toBeLessThanOrEqual(5);
    expect(result.stats.changes).toBeLessThanOrEqual(8);
  });

  it('should normalize repo to git root and write project session index', async () => {
    const repoDir = join(testDir, 'repo-root');
    const workDir = join(repoDir, 'src', 'auth');
    mkdirSync(workDir, { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    const canonicalRepoDir = realpathSync(repoDir);

    const { checkpoint } = await import('../src/distill.js');
    const result = checkpoint({
      repo: workDir,
      task: 'fix auth restore',
      status: '定位中',
      cli: 'codex',
      model: 'gpt-5.4',
      decisions: [],
      changes: [],
      findings: [],
      next: [],
    });

    const content = readFileSync(result.path, 'utf-8');
    expect(content).toContain(`repo: ${canonicalRepoDir}`);
    expect(content).toContain('folder: src/auth');
    expect(result.sessionIndexPath).toBe(join(canonicalRepoDir, '.ai', 'SESSION_INDEX.md'));

    const sessionIndex = readFileSync(result.sessionIndexPath!, 'utf-8');
    expect(sessionIndex).toContain('Session Index');
    expect(sessionIndex).toContain('fix auth restore');
    expect(sessionIndex).toContain('codex');
    expect(sessionIndex).toContain('gpt-5.4');
    expect(sessionIndex).toContain(result.threadId);
  });

  it('should reuse project from recent history when distill starts outside a repo', async () => {
    const repoDir = join(testDir, 'history-repo');
    const strayDir = join(testDir, 'random-folder');
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(strayDir, { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    const canonicalRepoDir = realpathSync(repoDir);

    const { checkpoint } = await import('../src/distill.js');
    const first = checkpoint({
      repo: repoDir,
      task: 'recover billing flow',
      status: '第一轮记录',
      decisions: [],
      changes: [],
      findings: [],
      next: [],
    });

    const second = checkpoint({
      repo: strayDir,
      task: 'recover billing flow',
      status: '第二轮继续',
      decisions: [],
      changes: [],
      findings: [],
      next: [],
    });

    const content = readFileSync(second.path, 'utf-8');
    expect(content).toContain(`repo: ${canonicalRepoDir}`);
    expect(second.repo).toBe(canonicalRepoDir);
    expect(second.repoSource).toBe('history');
    expect(second.parent).toBe(first.threadId);

    const sessionIndex = readFileSync(join(canonicalRepoDir, '.ai', 'SESSION_INDEX.md'), 'utf-8');
    expect(sessionIndex).toContain(first.threadId);
    expect(sessionIndex).toContain(second.threadId);
  });

  it('should keep root stable across thread snapshots', async () => {
    const { checkpoint } = await import('../src/distill.js');

    const first = checkpoint({
      repo: '/tmp/test-repo',
      task: 'stabilize auth flow',
      status: '第一轮',
      decisions: [],
      changes: [],
      findings: [],
      next: [],
    });

    const second = checkpoint({
      repo: '/tmp/test-repo',
      task: 'stabilize auth flow',
      status: '第二轮',
      decisions: [],
      changes: [],
      findings: [],
      next: [],
    });

    const firstContent = readFileSync(first.path, 'utf-8');
    const secondContent = readFileSync(second.path, 'utf-8');
    expect(firstContent).toContain(`root: ${first.threadId}`);
    expect(second.parent).toBe(first.threadId);
    expect(secondContent).toContain(`root: ${first.threadId}`);
  });

  it('should append fragments to a thread chain and surface them in bootstrap', async () => {
    const { handleFragment } = await import('../src/handlers.js');
    const { listRecentThreads, bootstrapQuick } = await import('../src/bootstrap.js');

    const first = handleFragment({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
      kind: 'debug',
      summary: '定位 401 根因',
      findings: ['token 过期后缓存未清'],
      next: ['补请求链日志'],
    });

    expect(first.isError).not.toBe(true);

    const thread = listRecentThreads('/tmp/test-repo', 1, { includeResumed: true })[0];
    expect(thread).toBeTruthy();

    const second = handleFragment({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
      thread: thread!.id,
      kind: 'fix',
      summary: '补上 token 失效后的 cache reset',
      changes: ['src/auth.ts'],
      next: ['回归登录态恢复'],
    });

    expect(second.isError).not.toBe(true);

    const qr = bootstrapQuick({
      repo: '/tmp/test-repo',
      task: 'debug auth flow',
      thread: thread!.id,
    });

    expect(qr.activeThread).toBeTruthy();
    expect(qr.activeThread!.root).toBe(thread!.root);
    expect(qr.activeThread!.recentFragments.length).toBe(2);
    expect(qr.activeThread!.recentFragments[0].summary).toContain('cache reset');
    expect(qr.activeThread!.recentFragments[1].summary).toContain('401 根因');
  });

  it('should allow explicit thread restore even after the thread was resumed once', async () => {
    const { checkpoint } = await import('../src/distill.js');
    const { bootstrapQuick } = await import('../src/bootstrap.js');

    const thread = checkpoint({
      repo: '/tmp/test-repo',
      task: 'resume exact thread',
      status: '第一次记录',
      decisions: [],
      changes: [],
      findings: [],
      next: [],
    });

    const first = bootstrapQuick({
      repo: '/tmp/test-repo',
      task: 'resume exact thread',
      thread: thread.threadId,
    });
    expect(first.activeThread?.id).toBe(thread.threadId);

    const second = bootstrapQuick({
      repo: '/tmp/test-repo',
      task: 'resume exact thread',
      thread: thread.threadId,
    });
    expect(second.activeThread?.id).toBe(thread.threadId);
  });
});
