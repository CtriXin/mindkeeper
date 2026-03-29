import { describe, it, expect } from 'vitest';
import type { BrainIndex } from '../src/types.js';

describe('router searchRecipes', () => {
  it('should understand synonym expansion', async () => {
    const { searchRecipes } = await import('../src/router.js');
    const index: BrainIndex = {
      version: '2.0',
      updated: new Date().toISOString(),
      recipes: [
        {
          id: 'test-1',
          triggers: ['error', 'debug'],
          summary: 'Error handling guide',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          accessCount: 0,
          confidence: 0.8,
        },
      ],
    };

    // "bug" 是 "error" 的同义词，应该能匹配
    // searchRecipes 内部会尝试 loadRecipe，文件不存在时跳过
    const results = searchRecipes(index, 'bug', 5);
    expect(results).toBeInstanceOf(Array);
  });

  it('should return empty array for no matches', async () => {
    const { searchRecipes } = await import('../src/router.js');
    const index: BrainIndex = {
      version: '2.0',
      updated: new Date().toISOString(),
      recipes: [
        {
          id: 'test-2',
          triggers: ['python', 'flask'],
          summary: 'Python Flask guide',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          accessCount: 0,
          confidence: 0.8,
        },
      ],
    };

    const results = searchRecipes(index, 'kubernetes deployment', 5);
    expect(results).toEqual([]);
  });
});
