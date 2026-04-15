/**
 * token-monitor.ts — 轻量 Token 监控与滑动窗口压缩
 *
 * 功能：
 * 1. 监控对话轮次和估算 token 使用量
 * 2. 超过阈值时自动触发滑动窗口压缩
 * 3. 异步调用国产模型做语义 distill
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getRealHome } from './env.js';

const SCE_DIR = join(getRealHome(), '.sce');
const TOKEN_STATE_PATH = join(SCE_DIR, 'token-state.json');

// ── 配置 ──

export interface TokenMonitorConfig {
  /** 对话轮次阈值，超过后触发警告 */
  turnWarning: number;
  /** 对话轮次阈值，超过后自动压缩 */
  turnCompress: number;
  /** Token 使用率阈值 (0-1)，超过后触发压缩 */
  tokenThreshold: number;
  /** 滑动窗口保留的最近轮次数 */
  windowSize: number;
  /** 是否启用异步 distill */
  enableAsyncDistill: boolean;
  /** 用于 distill 的模型 */
  distillModel: string;
}

const DEFAULT_CONFIG: TokenMonitorConfig = {
  turnWarning: 50,
  turnCompress: 100,
  tokenThreshold: 0.75,
  windowSize: 30,
  enableAsyncDistill: true,
  distillModel: 'kimi-k2.5',
};

// ── 状态 ──

export interface TokenState {
  sessionId: string;
  turnCount: number;
  estimatedTokens: number;
  lastReset: string;
  compressedCount: number;
  history: TurnRecord[];
}

export interface TurnRecord {
  timestamp: string;
  role: 'user' | 'assistant';
  tokens: number;
  summary?: string;
}

// ── 工具函数 ──

function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function estimateTokens(text: string): number {
  // 粗略估算：中文 ~1.5 tokens/字，英文 ~0.75 tokens/词
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/\b\w+\b/g) || []).length;
  const other = text.length - chineseChars - englishWords;
  return Math.round(chineseChars * 1.5 + englishWords * 0.75 + other * 0.5);
}

function loadState(): TokenState | null {
  if (!existsSync(TOKEN_STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_STATE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveState(state: TokenState): void {
  if (!existsSync(SCE_DIR)) mkdirSync(SCE_DIR, { recursive: true });
  writeFileSync(TOKEN_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// ── 核心 API ──

/** 初始化或获取当前 session 的 token 状态 */
export function initSession(): TokenState {
  const state = loadState();
  if (state) {
    // 检查是否是新 session（超过 1 小时视为新 session）
    const lastReset = new Date(state.lastReset);
    const now = new Date();
    if (now.getTime() - lastReset.getTime() > 3600000) {
      // 旧 session，重置
      const newState: TokenState = {
        sessionId: generateSessionId(),
        turnCount: 0,
        estimatedTokens: 0,
        lastReset: now.toISOString(),
        compressedCount: 0,
        history: [],
      };
      saveState(newState);
      return newState;
    }
    return state;
  }

  const newState: TokenState = {
    sessionId: generateSessionId(),
    turnCount: 0,
    estimatedTokens: 0,
    lastReset: new Date().toISOString(),
    compressedCount: 0,
    history: [],
  };
  saveState(newState);
  return newState;
}

/** 记录一轮对话 */
export function recordTurn(role: 'user' | 'assistant', content: string): TokenState {
  const state = initSession();
  const tokens = estimateTokens(content);

  state.turnCount++;
  state.estimatedTokens += tokens;
  state.history.push({
    timestamp: new Date().toISOString(),
    role,
    tokens,
  });

  // 保持历史记录在窗口大小内
  const config = loadConfig();
  if (state.history.length > config.windowSize * 2) {
    state.history = state.history.slice(-config.windowSize * 2);
  }

  saveState(state);
  return state;
}

/** 加载配置 */
export function loadConfig(): TokenMonitorConfig {
  const configPath = join(SCE_DIR, 'token-monitor-config.json');
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** 保存配置 */
export function saveConfig(config: Partial<TokenMonitorConfig>): void {
  const configPath = join(SCE_DIR, 'token-monitor-config.json');
  const current = loadConfig();
  writeFileSync(configPath, JSON.stringify({ ...current, ...config }, null, 2), 'utf-8');
}

/** 检查是否需要压缩，返回建议 */
export function checkCompression(state: TokenState): {
  shouldCompress: boolean;
  shouldWarn: boolean;
  reason: string;
} {
  const config = loadConfig();

  if (state.turnCount >= config.turnCompress) {
    return {
      shouldCompress: true,
      shouldWarn: false,
      reason: `对话轮次 ${state.turnCount} >= ${config.turnCompress}`,
    };
  }

  if (state.turnCount >= config.turnWarning) {
    return {
      shouldCompress: false,
      shouldWarn: true,
      reason: `对话轮次 ${state.turnCount} >= ${config.turnWarning}`,
    };
  }

  return {
    shouldCompress: false,
    shouldWarn: false,
    reason: `对话轮次 ${state.turnCount} < ${config.turnWarning}`,
  };
}

/** 应用滑动窗口压缩，返回被压缩的轮次 */
export function applySlidingWindow(state: TokenState): {
  compressedTurns: number;
  savedTokens: number;
  newHistory: TurnRecord[];
} {
  const config = loadConfig();
  const keepCount = config.windowSize;

  if (state.history.length <= keepCount) {
    return {
      compressedTurns: 0,
      savedTokens: 0,
      newHistory: state.history,
    };
  }

  const compressedTurns = state.history.slice(0, -keepCount);
  const savedTokens = compressedTurns.reduce((sum, r) => sum + r.tokens, 0);

  state.history = state.history.slice(-keepCount);
  state.estimatedTokens -= savedTokens;
  state.compressedCount++;

  saveState(state);

  return {
    compressedTurns: compressedTurns.length,
    savedTokens,
    newHistory: state.history,
  };
}

/** 生成当前状态摘要 */
export function formatStatus(state: TokenState): string {
  const config = loadConfig();
  const turnPct = Math.round((state.turnCount / config.turnCompress) * 100);
  const bar = '█'.repeat(Math.min(turnPct, 100) / 10) + '░'.repeat(10 - Math.min(turnPct, 100) / 10);

  return [
    `**Token 监控状态**`,
    `Session: \`${state.sessionId}\``,
    `对话轮次：${state.turnCount}/${config.turnCompress} [${bar}] ${turnPct}%`,
    `估算 Token: ~${state.estimatedTokens.toLocaleString()}`,
    `已压缩次数：${state.compressedCount}`,
    `滑动窗口：${state.history.length}/${config.windowSize * 2}`,
  ].join('\n');
}

/** 重置状态 */
export function resetState(): TokenState {
  const newState: TokenState = {
    sessionId: generateSessionId(),
    turnCount: 0,
    estimatedTokens: 0,
    lastReset: new Date().toISOString(),
    compressedCount: 0,
    history: [],
  };
  saveState(newState);
  return newState;
}
