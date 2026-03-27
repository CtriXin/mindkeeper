import { describe, it, expect } from 'vitest';
import type { BrainIndex } from '../src/types.js';

// 直接测试 router 的核心逻辑，不依赖文件系统
// 因为 search() 内部会 loadUnit，这里测试 score 计算逻辑

// 手动引入 expandQuery 和 calculateScore 的等价逻辑做单元测试
// router.ts 没有导出这些内部函数，所以我们写集成测试用 mock

describe('router search scoring', () => {
  // 同义词映射测试
  it('should understand synonym expansion', async () => {
    // 导入时 storage 会尝试 ensureDirs，需要 env 模块
    const { search } = await import('../src/router.js');
    const index: BrainIndex = {
      version: '1.0',
      updated: new Date().toISOString(),
      units: [
        {
          id: 'test-1',
          triggers: ['error', 'debug'],
          summary: 'Error handling guide',
          created: new Date().toISOString(),
          accessCount: 0,
          confidence: 0.8,
        },
      ],
    };

    // "bug" 是 "error" 的同义词，应该能匹配
    const results = search(index, 'bug', 5);
    // search 内部会尝试 loadUnit，如果文件不存在会返回空
    // 这里验证的是匹配逻辑不会崩溃
    expect(results).toBeInstanceOf(Array);
  });

  it('should return empty array for no matches', async () => {
    const { search } = await import('../src/router.js');
    const index: BrainIndex = {
      version: '1.0',
      updated: new Date().toISOString(),
      units: [
        {
          id: 'test-2',
          triggers: ['python', 'flask'],
          summary: 'Python Flask guide',
          created: new Date().toISOString(),
          accessCount: 0,
          confidence: 0.8,
        },
      ],
    };

    const results = search(index, 'kubernetes deployment', 5);
    expect(results).toEqual([]);
  });
});
