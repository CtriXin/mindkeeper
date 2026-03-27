import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('storage', () => {
  const testDir = join(tmpdir(), `mindkeeper-test-${Date.now()}`);
  let originalHome: string | undefined;

  beforeEach(() => {
    // 模拟 HOME 指向临时目录，让 storage 用临时 .sce/brain/
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
    mkdirSync(join(testDir, '.sce', 'brain', 'units'), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('metaFromUnit should preserve tags in index', async () => {
    // 动态导入以获取当前 HOME 下的模块
    const { metaFromUnit } = await import('../src/storage.js');
    const unit = {
      id: 'test',
      triggers: ['foo'],
      summary: 'test unit',
      content: 'body text',
      created: new Date().toISOString(),
      accessCount: 0,
      confidence: 0.8,
      tags: ['tag1', 'tag2'],
    };

    const meta = metaFromUnit(unit);
    expect(meta.tags).toEqual(['tag1', 'tag2']);
    expect((meta as any).content).toBeUndefined();
  });
});
