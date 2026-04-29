import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('search', () => {
  const testDir = join(tmpdir(), `brainkeeper-search-${Date.now()}`);
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = testDir;

    // Create mock data
    mkdirSync(join(testDir, '.sce', 'threads'), { recursive: true });
    mkdirSync(join(testDir, '.sce', 'fragments'), { recursive: true });
    mkdirSync(join(testDir, '.sce', 'brain'), { recursive: true });

    // Mock thread
    writeFileSync(join(testDir, '.sce', 'threads', 'dst-0101-abc123.md'), `---
id: dst-0101-abc123
root: dst-0101-abc123
repo: /Users/test/project
task: 实现广告延迟加载功能
branch: feature/ad-lazy-load
created: 2026-01-15T10:00:00Z
ttl: 7d
---

## 变更

- src/ads.ts — 添加 lazy load 逻辑
- config/ads.json — 更新配置

## 决策

- 使用 IntersectionObserver 代替 scroll 事件

## 当前状态

广告延迟加载基本完成，待优化性能
`, 'utf-8');

    // Mock fragment
    writeFileSync(join(testDir, '.sce', 'fragments', 'dst-0101-abc123.jsonl'),
      JSON.stringify({
        id: 'frg-test1', rootId: 'dst-0101-abc123', threadId: 'dst-0101-abc123',
        repo: '/Users/test/project', task: '广告延迟加载', branch: 'feature/ad-lazy-load',
        kind: 'dev', created: '2026-01-15T11:00:00Z',
        summary: '修复 IntersectionObserver 回调性能问题',
        decisions: ['使用 requestIdleCallback 节流'], changes: ['src/ads.ts'],
        findings: ['Observer 回调频率过高会导致卡顿'], next: [],
      }) + '\n',
      'utf-8');

    // Mock index (empty recipes — we just need the file to exist)
    writeFileSync(join(testDir, '.sce', 'brain', 'index.json'),
      JSON.stringify({ version: '2', updated: new Date().toISOString(), recipes: [] }),
      'utf-8');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('searchThreads should find thread by keyword', async () => {
    const { searchAll } = await import('../src/search.js');
    const results = searchAll('广告延迟加载', { repo: '/Users/test/project' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe('thread');
    expect(results[0].matched.length).toBeGreaterThan(0);
  });

  it('searchFragments should find fragment by summary', async () => {
    const { searchAll } = await import('../src/search.js');
    const results = searchAll('IntersectionObserver 性能', { repo: '/Users/test/project' });
    const fragResults = results.filter(r => r.type === 'fragment');
    expect(fragResults.length).toBeGreaterThan(0);
  });

  it('search should return empty for no matches', async () => {
    const { searchAll } = await import('../src/search.js');
    const results = searchAll('完全无关的关键词xxxxx');
    expect(results).toEqual([]);
  });

  it('formatSearchResults should format properly', async () => {
    const { searchAll, formatSearchResults } = await import('../src/search.js');
    const results = searchAll('广告', { repo: '/Users/test/project' });
    const text = formatSearchResults(results);
    expect(text).toContain('广告');
    expect(text).toContain('dst-0101-abc123');
  });
});
