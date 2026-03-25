/**
 * brain_bootstrap v2 — 任务启动入口
 *
 * v1 → v2 改进：
 * 1. 读真实 Git 上下文（branch, status, recent commits）
 * 2. 读项目规则文件（CLAUDE.md, AGENT.md, .ai/plan/）
 * 3. 任务分类（bugfix, refactor, doc, setup）
 * 4. 精准推荐 3 个文件（带理由）
 * 5. 真实 thread/TODO 恢复信息
 * 6. 只推荐最相关的 1-2 个 procedure
 * 7. 更具体的 next action（不是泛文案）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { execSync } from 'child_process';
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

// ── Git 上下文 ──

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

function readGitContext(repo: string): GitContext {
  const branch = git('branch --show-current', repo) || git('rev-parse --short HEAD', repo) || 'unknown';

  // uncommitted files (staged + unstaged + untracked)
  const statusRaw = git('status --porcelain', repo);
  const uncommittedFiles = statusRaw
    ? statusRaw.split('\n').map(l => l.slice(3).trim()).filter(Boolean).slice(0, 15)
    : [];

  // recent commits (last 5)
  const logRaw = git('log --oneline -5 --no-decorate', repo);
  const recentCommits = logRaw ? logRaw.split('\n').filter(Boolean) : [];

  return {
    branch,
    uncommittedFiles,
    recentCommits,
    hasUncommitted: uncommittedFiles.length > 0,
  };
}

// ── 任务分类 ──

export function classifyTask(task: string): TaskType {
  const t = task.toLowerCase();
  if (/fix|bug|修|报错|crash|error|broken|坏了|不对|问题/.test(t)) return 'bugfix';
  if (/refactor|重构|rename|拆分|cleanup|整理/.test(t)) return 'refactor';
  if (/doc|文档|readme|注释|comment|说明/.test(t)) return 'doc';
  if (/setup|init|install|配置|集成|deploy|ci|cd/.test(t)) return 'setup';
  if (/add|feat|新增|实现|implement|支持/.test(t)) return 'feature';
  return 'unknown';
}

// ── 项目规则 ──

function readFileIfExists(path: string, maxLines: number = 50): string {
  if (!existsSync(path)) return '';
  try {
    const content = readFileSync(path, 'utf-8');
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch {
    return '';
  }
}

function extractRules(content: string): string[] {
  const rules: string[] = [];
  const rulePattern = /^-\s+(?:\*\*)?(?:不要|禁止|不能|NEVER|不准|ALWAYS|必须)/i;
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (rulePattern.test(trimmed) && trimmed.length > 10 && trimmed.length < 150) {
      rules.push(trimmed.replace(/^-\s+/, '').replace(/\*\*/g, ''));
    }
  });
  return rules;
}

function loadProjectPolicies(repo?: string): string[] {
  if (!repo) return [];

  const rules: string[] = [];
  const candidates = [
    'CLAUDE.md', 'AGENT.md', 'AGENTS.md',
    '.claude/settings.json',  // 不读内容，只检测存在
  ];

  for (const rel of candidates) {
    const full = join(repo, rel);
    if (existsSync(full) && !rel.endsWith('.json')) {
      rules.push(...extractRules(readFileIfExists(full)));
    }
  }

  // 也读 ~/.sce/policies/
  const policiesDir = join(SCE_DIR, 'policies');
  if (existsSync(policiesDir)) {
    readdirSync(policiesDir).filter(f => f.endsWith('.md')).forEach(f => {
      rules.push(...extractRules(readFileIfExists(join(policiesDir, f))));
    });
  }

  return [...new Set(rules)].slice(0, 8);
}

// ── 风险推断 ──

function inferRisks(taskType: TaskType, gitCtx: GitContext, repo?: string): string[] {
  const risks: string[] = [];

  // uncommitted changes 冲突风险
  if (gitCtx.hasUncommitted) {
    risks.push(`有 ${gitCtx.uncommittedFiles.length} 个未提交文件 — 先确认是否和当前任务冲突`);
  }

  // 按任务类型
  if (taskType === 'bugfix') {
    risks.push('先复现 bug，确认修复后不引入新问题');
  }
  if (taskType === 'refactor') {
    risks.push('重构前确认有测试覆盖，避免静默破坏');
  }

  // 检查 uncommitted 中是否有敏感文件
  const sensitivePatterns = /core|bridge|auth|config|\.env|secret|migration/i;
  gitCtx.uncommittedFiles.forEach(f => {
    if (sensitivePatterns.test(f)) {
      risks.push(`${f} 在未提交列表中且是敏感文件`);
    }
  });

  return [...new Set(risks)].slice(0, 5);
}

// ── 精准文件推荐（最多 3 个，带理由） ──

function recommendFiles(task: string, taskType: TaskType, gitCtx: GitContext, repo?: string): FileRecommendation[] {
  const recs: FileRecommendation[] = [];

  // 1. 规则文件（如果任务涉及核心改动）
  if (repo && taskType !== 'doc') {
    const claudeMd = join(repo, 'CLAUDE.md');
    if (existsSync(claudeMd)) {
      recs.push({ path: 'CLAUDE.md', reason: '了解项目约束和受保护文件' });
    }
  }

  // 2. 从 uncommitted files 中找和任务最相关的
  const taskKeywords = task.toLowerCase().split(/[\s,/\\.-]+/).filter(w => w.length > 2);
  const scored = gitCtx.uncommittedFiles
    .map(f => {
      const name = f.toLowerCase();
      const score = taskKeywords.filter(kw => name.includes(kw)).length;
      return { path: f, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    recs.push({ path: scored[0].path, reason: '文件名和任务关键词匹配，且有未提交改动' });
  }

  // 3. 从最近 commit 推断热点文件
  if (repo) {
    const diffFiles = git('diff --name-only HEAD~3 HEAD 2>/dev/null', repo);
    if (diffFiles) {
      const hotFiles = diffFiles.split('\n').filter(Boolean);
      // 找和任务最相关的
      const hotScored = hotFiles
        .map(f => {
          const name = f.toLowerCase();
          const score = taskKeywords.filter(kw => name.includes(kw)).length;
          return { path: f, score };
        })
        .sort((a, b) => b.score - a.score);

      if (hotScored.length > 0 && hotScored[0].score > 0) {
        const f = hotScored[0].path;
        if (!recs.find(r => r.path === f)) {
          recs.push({ path: f, reason: '最近 commit 中被频繁修改，和任务关键词匹配' });
        }
      }
    }
  }

  // 4. 如果还不够 3 个，根据任务类型补充
  if (recs.length < 3 && repo) {
    const typeFiles: Record<TaskType, string[]> = {
      bugfix: ['src/server.ts', 'src/index.ts', 'src/main.ts'],
      refactor: ['src/types.ts', 'tsconfig.json'],
      feature: ['src/types.ts', 'package.json'],
      doc: ['README.md', 'docs/'],
      setup: ['package.json', 'tsconfig.json', '.env.example'],
      unknown: [],
    };
    for (const f of typeFiles[taskType] || []) {
      if (recs.length >= 3) break;
      if (existsSync(join(repo, f)) && !recs.find(r => r.path === f)) {
        recs.push({ path: f, reason: `${taskType} 类型任务的常用入口` });
      }
    }
  }

  return recs.slice(0, 3);
}

// ── 连续性恢复（TODO, plan, thread） ──

function loadContinuity(repo?: string): string[] {
  const items: string[] = [];

  // 1. 项目 TODO.md
  if (repo) {
    for (const rel of ['TODO.md', '.ai/plan/TODO.md', '.ai/plan/current.md']) {
      const path = join(repo, rel);
      if (existsSync(path)) {
        const content = readFileIfExists(path, 20);
        // 提取未完成的 TODO 项
        const todos = content.split('\n')
          .filter(l => /^\s*-\s*\[\s*\]/.test(l))
          .slice(0, 3)
          .map(l => l.trim());
        if (todos.length > 0) {
          items.push(`📋 ${rel} 中有 ${todos.length} 项待办:`);
          todos.forEach(t => items.push(`  ${t}`));
        }
        break; // 只读第一个找到的
      }
    }
  }

  // 2. ~/.sce/threads/
  const threadsDir = join(SCE_DIR, 'threads');
  if (existsSync(threadsDir)) {
    try {
      const threads = readdirSync(threadsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({
          name: f,
          mtime: statSync(join(threadsDir, f)).mtime.getTime(),
          summary: readFileIfExists(join(threadsDir, f), 3)
            .split('\n').find(l => l.trim().length > 0)?.replace(/^#\s*/, '') || f,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 2);

      if (threads.length > 0) {
        items.push('🧵 最近的 thread:');
        threads.forEach(t => items.push(`  ${t.name}: ${t.summary.slice(0, 60)}`));
      }
    } catch { /* skip */ }
  }

  // 3. .ai/plan/progress.md 或 findings.md
  if (repo) {
    for (const rel of ['.ai/plan/progress.md', 'progress.md', 'findings.md']) {
      const path = join(repo, rel);
      if (existsSync(path)) {
        const stat = statSync(path);
        const ageHours = (Date.now() - stat.mtime.getTime()) / 3600000;
        if (ageHours < 48) {
          const summary = readFileIfExists(path, 5).split('\n').filter(l => l.trim()).slice(0, 2).join(' ');
          items.push(`📝 ${rel} (${Math.round(ageHours)}h 前更新): ${summary.slice(0, 80)}`);
        }
        break;
      }
    }
  }

  return items;
}

// ── Procedure 筛选 ──

function recommendProcedures(taskType: TaskType, task: string): string[] {
  const allProcs = listProcedures();
  if (allProcs.length === 0) return [];

  const taskLower = task.toLowerCase();

  // 按任务类型和关键词匹配
  const scored = allProcs.map(p => {
    let score = 0;
    const triggers = Array.isArray(p.trigger) ? p.trigger : [p.trigger];
    // 触发词匹配
    triggers.forEach(t => {
      if (t && taskLower.includes(t.toLowerCase())) score += 3;
    });
    // 标签匹配
    if (p.tags) {
      if (p.tags.includes(taskType)) score += 2;
      if (p.tags.includes('core')) score += 1;
    }
    return { name: p.name, description: p.description || '', score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  return scored.slice(0, 2).map(p => `${p.name}: ${p.description}`);
}

// ── 生成 next action ──

function generateNextAction(taskType: TaskType, gitCtx: GitContext, continuity: string[], risks: string[]): string {
  // 最高优先：有未提交改动可能冲突
  if (gitCtx.hasUncommitted && gitCtx.uncommittedFiles.length > 3) {
    return `先 git stash 或 commit 当前 ${gitCtx.uncommittedFiles.length} 个未提交文件，避免和新任务混淆`;
  }

  // 有连续性信息 → 恢复
  if (continuity.some(c => c.startsWith('📋'))) {
    return '先检查项目 TODO 中的待办项，确认当前任务是否在列表中，避免重复工作';
  }
  if (continuity.some(c => c.startsWith('🧵'))) {
    return '先回顾最近的 thread，看是否有未完成的相关工作可以衔接';
  }

  // 按任务类型
  switch (taskType) {
    case 'bugfix':
      return '先复现问题，确认 error message 和触发路径，再定位代码';
    case 'refactor':
      return '先确认有测试覆盖目标代码，然后小步重构、每步验证';
    case 'feature':
      return '先读相关模块的现有实现，理解数据流和接口，再动手';
    case 'doc':
      return '先检查现有文档的准确性，再补充新内容';
    case 'setup':
      return '先检查依赖版本和环境要求，避免兼容性问题';
    default:
      return '先读 CLAUDE.md 了解项目约束，再开始';
  }
}

// ── 核心函数 ──

export function bootstrap(input: BootstrapInput): WorkingSet {
  const repo = input.repo;
  const taskType = classifyTask(input.task);

  // Git 上下文
  const gitCtx = repo ? readGitContext(repo) : {
    branch: 'unknown', uncommittedFiles: [], recentCommits: [], hasUncommitted: false,
  };

  // 项目规则
  const policies = loadProjectPolicies(repo);

  // 风险
  const risks = inferRisks(taskType, gitCtx, repo);

  // 连续性
  const continuity = loadContinuity(repo);

  // 文件推荐
  const files = recommendFiles(input.task, taskType, gitCtx, repo);

  // 知识检索
  const index = loadIndex();
  const searchResults = search(index, input.task, 3);
  const knowledge = searchResults.map(r => `${r.unit.summary} (${r.score.toFixed(2)})`);

  // Procedure 筛选
  const procedures = recommendProcedures(taskType, input.task);

  // 下一步
  const nextAction = generateNextAction(taskType, gitCtx, continuity, risks);

  return {
    task: input.task,
    taskType,
    git: gitCtx,
    policies,
    risks,
    continuity,
    procedures,
    files,
    knowledge,
    nextAction,
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
  text += `> **分支**: \`${ws.git.branch}\``;
  if (ws.git.hasUncommitted) {
    text += ` | ${ws.git.uncommittedFiles.length} 个未提交文件`;
  }
  text += `\n\n---\n\n`;

  // 规则
  if (ws.policies.length > 0) {
    text += `## 📋 规则\n\n`;
    ws.policies.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  // 风险
  if (ws.risks.length > 0) {
    text += `## ⚠️ 风险\n\n`;
    ws.risks.forEach(r => text += `- ${r}\n`);
    text += `\n`;
  }

  // 连续性
  if (ws.continuity.length > 0) {
    text += `## 🔄 恢复上下文\n\n`;
    ws.continuity.forEach(c => text += `${c}\n`);
    text += `\n`;
  }

  // 文件推荐
  if (ws.files.length > 0) {
    text += `## 📂 先看这 ${ws.files.length} 个文件\n\n`;
    ws.files.forEach(f => text += `- \`${f.path}\` — ${f.reason}\n`);
    text += `\n`;
  }

  // 相关知识
  if (ws.knowledge.length > 0) {
    text += `## 🔍 相关知识\n\n`;
    ws.knowledge.forEach(k => text += `- ${k}\n`);
    text += `\n`;
  }

  // Procedure
  if (ws.procedures.length > 0) {
    text += `## 📝 推荐 Procedure\n\n`;
    ws.procedures.forEach(p => text += `- ${p}\n`);
    text += `\n`;
  }

  // 最近 commits（简略）
  if (ws.git.recentCommits.length > 0) {
    text += `## 📜 最近提交\n\n`;
    ws.git.recentCommits.slice(0, 3).forEach(c => text += `- ${c}\n`);
    text += `\n`;
  }

  // 下一步
  text += `## 💡 下一步\n\n`;
  text += `**${ws.nextAction}**\n`;

  return text;
}
