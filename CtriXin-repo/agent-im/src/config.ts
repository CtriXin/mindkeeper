import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
  discord: {
    botToken: string;
    hubChannelId: string;
    allowedUsers: string[];
  };
  defaultFilter: FilterLevel;
  autoArchiveHours: number;
  heartbeatIntervalMs: number;
}

export type FilterLevel = 'full' | 'summary' | 'silent';

export const AGENT_IM_HOME = process.env.AGENT_IM_HOME
  || path.join(os.homedir(), '.agent-im');
export const CONFIG_PATH = path.join(AGENT_IM_HOME, 'config.env');
export const SOCKET_PATH = path.join(AGENT_IM_HOME, 'agent-im.sock');
export const DATA_DIR = path.join(AGENT_IM_HOME, 'data');
export const LOG_DIR = path.join(AGENT_IM_HOME, 'logs');
export const PID_FILE = path.join(AGENT_IM_HOME, 'daemon.pid');

function parseEnvFile(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export function loadConfig(): Config {
  let env = new Map<string, string>();
  try {
    env = parseEnvFile(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    // Config not found — will use defaults / empty
  }

  return {
    discord: {
      botToken: env.get('AGENT_IM_DISCORD_BOT_TOKEN') || '',
      hubChannelId: env.get('AGENT_IM_DISCORD_HUB_CHANNEL_ID') || '',
      allowedUsers: splitCsv(env.get('AGENT_IM_DISCORD_ALLOWED_USERS')),
    },
    defaultFilter: (env.get('AGENT_IM_DEFAULT_FILTER') as FilterLevel) || 'summary',
    autoArchiveHours: parseInt(env.get('AGENT_IM_AUTO_ARCHIVE_HOURS') || '24', 10),
    heartbeatIntervalMs: parseInt(env.get('AGENT_IM_HEARTBEAT_INTERVAL_MS') || '30000', 10),
  };
}

export function validateConfig(config: Config): string | null {
  if (!config.discord.botToken) return 'AGENT_IM_DISCORD_BOT_TOKEN is required';
  if (!config.discord.hubChannelId) return 'AGENT_IM_DISCORD_HUB_CHANNEL_ID is required';
  return null;
}
