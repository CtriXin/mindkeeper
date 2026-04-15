import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getRealHome } from './env.js';
import type { FragmentKind, FragmentRecord } from './types.js';

const SCE_DIR = join(getRealHome(), '.sce');
const FRAGMENTS_DIR = join(SCE_DIR, 'fragments');

function ensureFragmentsDir(): void {
  if (!existsSync(FRAGMENTS_DIR)) {
    mkdirSync(FRAGMENTS_DIR, { recursive: true });
  }
}

function fragmentFilePath(rootId: string): string {
  return join(FRAGMENTS_DIR, `${rootId}.jsonl`);
}

function sanitizeScalar(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeList(items: string[] | undefined, limit: number = 8): string[] {
  return (items || [])
    .map(item => sanitizeScalar(String(item)))
    .filter(Boolean)
    .slice(0, limit);
}

function generateFragmentId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `frg-${rand}`;
}

function parseFragmentLines(raw: string): FragmentRecord[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as FragmentRecord];
      } catch {
        return [];
      }
    });
}

export interface FragmentAppendInput {
  rootId: string;
  threadId: string;
  repo: string;
  task: string;
  branch?: string;
  cli?: string;
  model?: string;
  kind?: FragmentKind;
  summary: string;
  decisions?: string[];
  changes?: string[];
  findings?: string[];
  next?: string[];
}

export function appendFragment(input: FragmentAppendInput): FragmentRecord {
  ensureFragmentsDir();

  const record: FragmentRecord = {
    id: generateFragmentId(),
    rootId: sanitizeScalar(input.rootId),
    threadId: sanitizeScalar(input.threadId),
    repo: sanitizeScalar(input.repo),
    task: sanitizeScalar(input.task),
    branch: input.branch ? sanitizeScalar(input.branch) : undefined,
    cli: input.cli ? sanitizeScalar(input.cli) : undefined,
    model: input.model ? sanitizeScalar(input.model) : undefined,
    kind: input.kind || 'note',
    created: new Date().toISOString(),
    summary: sanitizeScalar(input.summary),
    decisions: sanitizeList(input.decisions, 5),
    changes: sanitizeList(input.changes, 8),
    findings: sanitizeList(input.findings, 8),
    next: sanitizeList(input.next, 8),
  };

  const path = fragmentFilePath(record.rootId);
  const prefix = existsSync(path) && readFileSync(path, 'utf-8').trim().length > 0 ? '\n' : '';
  writeFileSync(path, `${existsSync(path) ? readFileSync(path, 'utf-8') : ''}${prefix}${JSON.stringify(record)}`, 'utf-8');
  return record;
}

export function loadFragments(rootId: string, limit: number = 5): FragmentRecord[] {
  ensureFragmentsDir();
  const path = fragmentFilePath(rootId);
  if (!existsSync(path)) return [];

  const records = parseFragmentLines(readFileSync(path, 'utf-8'));
  return records.slice(-limit).reverse();
}

