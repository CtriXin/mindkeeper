import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('distill checkpoint', () => {
  const testDir = join(tmpdir(), `mindkeeper-distill-test-${Date.now()}`);
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
    expect(result.threadId).toMatch(/^dst-\d{8}-[a-z0-9]+$/);
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
});
