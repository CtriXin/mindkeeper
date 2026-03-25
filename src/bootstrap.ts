/**
 * brain_bootstrap — 任务启动入口（Community Edition）
 *
 * 输入 repo + task，输出 Working Set。
 * 社区版提供基础的知识检索和 procedure 推荐。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadIndex } from './storage.js';
import { search } from './router.js';
import { listProcedures } from './procedure.js';

const SCE_DIR = join(homedir(), '.sce');

// ── 类型 ──

export type TaskType = 'bugfix' | 'refactor' | 'feature' | 'doc' | 'setup' | 'unknown';

export interface GitContext {
  branch: string;
  uncommittedFiles: string[];
  recentCommits: string[];
  hasUncommitted: boolean;
}

export interface FileRecommendation {
  path: string;
  reason: string;
}

export interface WorkingSet {
  task: string;
  taskType: TaskType;
  git: GitContext;
  policies: string[];
  risks: string[];
  continuity: string[];
  procedures: string[];
  files: FileRecommendation[];
  knowledge: string[];
  nextAction: string;
}

export interface BootstrapInput {
  task: string;
  repo?: string;
}

// ── 基础实现 ──

export function classifyTask(task: string): TaskType {
  const t = task.toLowerCase();
  if (/fix|bug|修|报错|crash|error|broken/.test(t)) return 'bugfix';
  if (/refactor|重构|rename|cleanup/.test(t)) return 'refactor';
  if (/doc|文档|readme/.test(t)) return 'doc';
  if (/setup|init|install|配置|deploy/.test(t)) return 'setup';
  if (/add|feat|新增|实现|implement/.test(t)) return 'feature';
  return 'unknown';
}

function readFileIfExists(path: string, maxLines: number = 50): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf-8').split('\n').slice(0, maxLines).join('\n');
  } catch {
    return '';
  }
}

// ── 核心函数 ──

export function bootstrap(input: BootstrapInput): WorkingSet {
  const taskType = classifyTask(input.task);

  const gitCtx: GitContext = {
    branch: 'unknown',
    uncommittedFiles: [],
    recentCommits: [],
    hasUncommitted: false,
  };

  // 基础知识检索
  const index = loadIndex();
  const searchResults = search(index, input.task, 3);
  const knowledge = searchResults.map(r => `${r.unit.summary} (${r.score.toFixed(2)})`);

  // 基础 procedure 列表
  const allProcs = listProcedures();
  const procedures = allProcs.slice(0, 2).map(p => `${p.name}: ${p.description || ''}`);

  // 基础规则（读 CLAUDE.md 标题）
  const policies: string[] = [];
  if (input.repo) {
    const claudeMd = join(input.repo, 'CLAUDE.md');
    if (existsSync(claudeMd)) {
      policies.push('项目有 CLAUDE.md 约束文件，请先阅读');
    }
  }

  return {
    task: input.task,
    taskType,
    git: gitCtx,
    policies,
    risks: [],
    continuity: [],
    procedures,
    files: [],
    knowledge,
    nextAction: '先了解项目结构和约束，再开始工作',
  };
}

// ── 格式化输出 ──

export function formatWorkingSet(ws: WorkingSet): string {
  const typeLabel: Record<TaskType, string> = {
    bugfix: '🐛 Bug 修复',
    refactor: '🔧 重构',
    feature: '✨ 新功能',
    doc: '📝 文档',
    setup: '⚙️ 配置/集成',
    unknown: '📦 任务',
  };

  let text = `# 🧠 MindKeeper Bootstrap\n\n`;
  text += `> **${typeLabel[ws.taskType]}**: ${ws.task}\n`;
  if (ws.git.branch !== 'unknown') {
    text += `> **分支**: \`${ws.git.branch}\``;
    if (ws.git.hasUncommitted) {
      text += ` | ${ws.git.uncommittedFiles.length} 个未提交文件`;
    }
  }
  text += `\n\n---\n\n`;

  if (ws.policies.length > 0) {
    text += `## 📋 规则\n\n`;
    ws.policies.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  if (ws.risks.length > 0) {
    text += `## ⚠️ 风险\n\n`;
    ws.risks.forEach(r => text += `- ${r}\n`);
    text += `\n`;
  }

  if (ws.continuity.length > 0) {
    text += `## 🔄 恢复上下文\n\n`;
    ws.continuity.forEach(c => text += `${c}\n`);
    text += `\n`;
  }

  if (ws.files.length > 0) {
    text += `## 📂 先看这 ${ws.files.length} 个文件\n\n`;
    ws.files.forEach(f => text += `- \`${f.path}\` — ${f.reason}\n`);
    text += `\n`;
  }

  if (ws.knowledge.length > 0) {
    text += `## 🔍 相关知识\n\n`;
    ws.knowledge.forEach(k => text += `- ${k}\n`);
    text += `\n`;
  }

  if (ws.procedures.length > 0) {
    text += `## 📝 推荐 Procedure\n\n`;
    ws.procedures.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  if (ws.git.recentCommits.length > 0) {
    text += `## 📜 最近提交\n\n`;
    ws.git.recentCommits.slice(0, 3).forEach(c => text += `- ${c}\n`);
    text += `\n`;
  }

  text += `## 💡 下一步\n\n`;
  text += `**${ws.nextAction}**\n`;

  return text;
}
