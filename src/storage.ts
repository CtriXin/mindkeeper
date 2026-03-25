/**
 * 存储层
 *
 * 设计：
 * - brain/index.json: 极简索引，启动时加载（<1KB）
 * - brain/units/*.md: 知识单元，按需加载
 * - 使用 YAML frontmatter 存储元数据
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BrainIndex, Unit, UnitMeta } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = join(__dirname, '..', 'brain');
const INDEX_PATH = join(BRAIN_DIR, 'index.json');
const UNITS_DIR = join(BRAIN_DIR, 'units');

/** 确保目录存在 */
function ensureDirs() {
  if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true });
  if (!existsSync(UNITS_DIR)) mkdirSync(UNITS_DIR, { recursive: true });
}

/** 加载索引（启动时唯一 IO） */
export function loadIndex(): BrainIndex {
  ensureDirs();
  if (!existsSync(INDEX_PATH)) {
    const empty: BrainIndex = { version: '1.0', updated: new Date().toISOString(), units: [] };
    writeFileSync(INDEX_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
}

/** 保存索引 */
export function saveIndex(index: BrainIndex): void {
  index.updated = new Date().toISOString();
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

/** 解析 Markdown frontmatter */
function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, any> = {};
  match[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      let value: any = rest.join(':').trim();
      // 解析数组
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
      }
      // 解析数字
      else if (!isNaN(Number(value))) {
        value = Number(value);
      }
      meta[key.trim()] = value;
    }
  });

  return { meta, body: match[2] };
}

/** 生成 Markdown frontmatter */
function toFrontmatter(meta: Record<string, any>, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map(s => `"${s}"`).join(', ')}]`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** 加载单个知识单元（按需调用） */
export function loadUnit(id: string): Unit | null {
  const path = join(UNITS_DIR, `${id}.md`);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  return {
    id,
    triggers: meta.triggers || [],
    summary: meta.summary || '',
    project: meta.project,
    created: meta.created || new Date().toISOString(),
    lastAccessed: meta.lastAccessed,
    accessCount: meta.accessCount || 0,
    confidence: meta.confidence || 0.5,
    content: body.trim(),
    related: meta.related,
    tags: meta.tags,
  };
}

/** 保存知识单元 */
export function saveUnit(unit: Unit): void {
  ensureDirs();
  const { content, ...meta } = unit;
  const path = join(UNITS_DIR, `${unit.id}.md`);
  writeFileSync(path, toFrontmatter(meta, content));
}

/** 删除知识单元 */
export function deleteUnit(id: string): boolean {
  const path = join(UNITS_DIR, `${id}.md`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** 更新访问统计 */
export function touchUnit(index: BrainIndex, id: string): void {
  const meta = index.units.find(u => u.id === id);
  if (meta) {
    meta.lastAccessed = new Date().toISOString();
    meta.accessCount = (meta.accessCount || 0) + 1;
    saveIndex(index);
  }
}

/** 从元数据生成索引条目 */
export function metaFromUnit(unit: Unit): UnitMeta {
  const { content, related, tags, ...meta } = unit;
  return meta;
}

/** 列出所有单元文件 */
export function listUnitFiles(): string[] {
  ensureDirs();
  return readdirSync(UNITS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}
