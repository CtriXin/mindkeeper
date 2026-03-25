/**
 * brain_bootstrap — 任务启动入口
 *
 * 用户开始一个任务前，先过 MindKeeper。
 * 输入 repo + task + branch + recent files
 * 输出一个可直接工作的 Working Set。
 *
 * 这是 MindKeeper 的第一性价值：
 * "帮你在任务开始的前 30 秒内进入正确工作状态"
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { loadIndex, loadUnit } from './storage.js';
import { search } from './router.js';
import { listProcedures, loadProcedure } from './procedure.js';
import type { SearchResult } from './types.js';

const SCE_DIR = join(homedir(), '.sce');

/** Bootstrap 输入 */
export interface BootstrapInput {
  /** 当前仓库路径 */
  repo?: string;
  /** 当前任务描述 */
  task: string;
  /** 当前 Git 分支 */
  branch?: string;
  /** 最近修改的文件 */
  recentFiles?: string[];
}

/** Working Set 输出 */
export interface WorkingSet {
  /** 任务目标 */
  task: string;
  /** 相关规则 / red lines */
  policies: string[];
  /** 相关 procedure */
  procedures: string[];
  /** 最近的 thread / 上下文 */
  threads: string[];
  /** 风险点 */
  risks: string[];
  /** 建议先看的文件 */
  suggestedFiles: string[];
  /** 相关知识 */
  relevantKnowledge: string[];
  /** 下一步建议 */
  nextAction: string;
}

/** 读取 policies */
function loadPolicies(): string[] {
  const dir = join(SCE_DIR, 'policies');
  if (!existsSync(dir)) return [];

  const policies: string[] = [];
  readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f => {
    try {
      const content = readFileSync(join(dir, f), 'utf-8');
      // 提取每条规则（以 - 开头的行）
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') && trimmed.length > 5) {
          policies.push(trimmed.slice(2));
        }
      });
    } catch { /* skip */ }
  });

  return policies;
}

/** 读取 CLAUDE.md / 项目规则 */
function loadProjectRules(repo?: string): string[] {
  if (!repo) return [];

  const rules: string[] = [];
  const candidates = [
    join(repo, 'CLAUDE.md'),
    join(repo, '.claude', 'rules', '*.md'),
    join(repo, 'AGENT.md'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        // 只提取 "- 不要..." 格式的规则行
        const rulePattern = /^-\s+(?:不要|禁止|不能|never|不准)/i;
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (rulePattern.test(trimmed) && trimmed.length > 10 && trimmed.length < 120) {
            rules.push(trimmed.replace(/^-\s+/, ''));
          }
        });
      } catch { /* skip */ }
    }
  }

  return rules;
}

/** 从任务描述和文件列表推断风险点 */
function inferRisks(task: string, recentFiles: string[], projectRules: string[]): string[] {
  const risks: string[] = [];

  // 检查是否涉及核心文件
  const corePatterns = [
    /core|main|index|server|config|auth|security/i,
    /\.env|secret|credential|key/i,
    /migration|schema|database/i,
    /deploy|ci|cd|pipeline/i,
  ];

  recentFiles.forEach(f => {
    const name = basename(f);
    corePatterns.forEach(pattern => {
      if (pattern.test(name)) {
        risks.push(`⚠️ ${name} 是核心/敏感文件，修改前请确认影响范围`);
      }
    });
  });

  // 从任务描述推断
  if (/delete|remove|drop|reset|force/i.test(task)) {
    risks.push('⚠️ 任务包含破坏性操作，请确认有备份/可回滚');
  }
  if (/refactor|重构|migrate/i.test(task)) {
    risks.push('⚠️ 重构任务，建议先写测试，再改代码');
  }

  return [...new Set(risks)].slice(0, 8);
}

/** 从任务和文件推断建议先看的文件 */
function suggestFiles(task: string, recentFiles: string[], repo?: string): string[] {
  const suggested: string[] = [];

  // 最近修改的文件优先
  if (recentFiles.length > 0) {
    suggested.push(...recentFiles.slice(0, 3));
  }

  // 如果有 repo，检查常见入口文件
  if (repo) {
    const entryPoints = [
      'README.md', 'CLAUDE.md', 'package.json',
      'src/index.ts', 'src/main.ts', 'src/server.ts',
    ];
    entryPoints.forEach(f => {
      const fullPath = join(repo, f);
      if (existsSync(fullPath) && !suggested.includes(f)) {
        suggested.push(f);
      }
    });
  }

  return [...new Set(suggested)].slice(0, 6);
}

/** 查找相关的 threads */
function findRelevantThreads(task: string): string[] {
  const threadsDir = join(SCE_DIR, 'threads');
  if (!existsSync(threadsDir)) return [];

  try {
    return readdirSync(threadsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const content = readFileSync(join(threadsDir, f), 'utf-8');
        const firstLine = content.split('\n').find(l => l.trim().length > 0) || f;
        return { name: f, summary: firstLine.replace(/^#\s*/, ''), mtime: statSync(join(threadsDir, f)).mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3)
      .map(t => `${t.name}: ${t.summary.slice(0, 80)}`);
  } catch {
    return [];
  }
}

/** 核心函数：生成 Working Set */
export function bootstrap(input: BootstrapInput): WorkingSet {
  const index = loadIndex();

  // 1. 搜索相关知识
  const searchResults = search(index, input.task, 5);
  const relevantKnowledge = searchResults.map(r =>
    `**${r.unit.summary}** (score: ${r.score.toFixed(2)})`
  );

  // 2. 加载 policies
  const scePolices = loadPolicies();
  const projectRules = loadProjectRules(input.repo);
  const policies = [...scePolices.slice(0, 5), ...projectRules.slice(0, 5)];

  // 3. 查找相关 procedures
  const allProcedures = listProcedures();
  const procedures = allProcedures.map(p => `${p.name}: ${p.description || ''}`);

  // 4. 查找相关 threads
  const threads = findRelevantThreads(input.task);

  // 5. 推断风险点
  const risks = inferRisks(input.task, input.recentFiles || [], projectRules);

  // 6. 推荐文件
  const suggestedFiles = suggestFiles(input.task, input.recentFiles || [], input.repo);

  // 7. 生成下一步建议
  let nextAction = '开始执行任务';
  if (risks.length > 0) {
    nextAction = '先检查上述风险点，确认安全后再开始';
  }
  if (threads.length > 0) {
    nextAction = '先回顾最近的 thread，避免重复工作';
  }
  if (suggestedFiles.length > 0) {
    nextAction = `建议先读 ${suggestedFiles[0]}，了解当前状态后再动手`;
  }

  return {
    task: input.task,
    policies,
    procedures,
    threads,
    risks,
    suggestedFiles,
    relevantKnowledge,
    nextAction,
  };
}

/** 格式化 Working Set 为可读文本 */
export function formatWorkingSet(ws: WorkingSet): string {
  let text = `# 🧠 MindKeeper Bootstrap\n\n`;
  text += `> **任务**: ${ws.task}\n\n`;
  text += `---\n\n`;

  if (ws.policies.length > 0) {
    text += `## 📋 相关规则\n\n`;
    ws.policies.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  if (ws.risks.length > 0) {
    text += `## ⚠️ 风险点\n\n`;
    ws.risks.forEach(r => text += `- ${r}\n`);
    text += `\n`;
  }

  if (ws.threads.length > 0) {
    text += `## 🧵 最近的 Thread\n\n`;
    ws.threads.forEach(t => text += `- ${t}\n`);
    text += `\n`;
  }

  if (ws.relevantKnowledge.length > 0) {
    text += `## 🔍 相关知识\n\n`;
    ws.relevantKnowledge.forEach(k => text += `- ${k}\n`);
    text += `\n`;
  }

  if (ws.procedures.length > 0) {
    text += `## 📝 可用 Procedure\n\n`;
    ws.procedures.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  if (ws.suggestedFiles.length > 0) {
    text += `## 📂 建议先看的文件\n\n`;
    ws.suggestedFiles.forEach(f => text += `- \`${f}\`\n`);
    text += `\n`;
  }

  text += `## 💡 下一步\n\n`;
  text += `**${ws.nextAction}**\n`;

  return text;
}
