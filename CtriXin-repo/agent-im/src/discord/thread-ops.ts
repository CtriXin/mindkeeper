import os from 'node:os';
import type {
  Client,
  Message,
  TextChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import type { CLISession } from '../store.js';
import { getAgentBrand } from '../config.js';

export type HubStatus = 'pending' | 'active' | 'idle';

const HOME_DIR = os.homedir();

/** Map autoArchiveHours config to Discord's allowed durations */
function archiveDuration(hours: number): ThreadAutoArchiveDuration {
  if (hours <= 1) return 60;      // 1 hour
  if (hours <= 24) return 1440;   // 24 hours
  if (hours <= 72) return 4320;   // 3 days
  return 10080;                    // 7 days
}

/** Format thread name: `project / branch [short-id]` */
export function threadName(session: CLISession): string {
  const shortId = session.sessionId.slice(0, 6);
  const name = `${session.project} / ${session.branch} [${shortId}]`;
  // Discord thread names max 100 chars
  return name.length > 100 ? name.slice(0, 97) + '...' : name;
}

function formatDirectory(dir: string): string {
  if (!dir) return dir;
  if (dir === HOME_DIR) return '~';
  if (dir.startsWith(`${HOME_DIR}/`)) {
    return `~${dir.slice(HOME_DIR.length)}`;
  }
  return dir;
}

export async function createSessionThread(
  client: Client,
  hubChannelId: string,
  session: CLISession,
  autoArchiveHours: number,
): Promise<{ threadId: string; starterMessageId: string }> {
  const channel = await client.channels.fetch(hubChannelId);
  if (!channel || !('threads' in channel)) {
    throw new Error(`Hub channel ${hubChannelId} not found or not a text channel`);
  }
  const textChannel = channel as TextChannel;

  // Send a starter message in hub channel
  const brand = getAgentBrand(session.agent);
  const author = {
    name: brand.label,
    ...(brand.iconUrl ? { icon_url: brand.iconUrl } : {}),
  };
  const starterMsg = await textChannel.send({
    embeds: [hubEmbed(session, 'pending')],
  });

  // Create thread from the starter message
  const thread = await starterMsg.startThread({
    name: threadName(session),
    autoArchiveDuration: archiveDuration(autoArchiveHours),
    reason: `agent-im: CLI session ${session.sessionId}`,
  });

  await thread.send(`📋 Session started. Filter: **${session.filterLevel}**\nUse \`/filter full|summary|silent\` to change.`);

  return { threadId: thread.id, starterMessageId: starterMsg.id };
}

export async function updateThreadName(
  client: Client,
  threadId: string,
  name: string,
): Promise<void> {
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread && 'setName' in thread) {
      const truncated = name.length > 100 ? name.slice(0, 97) + '...' : name;
      await (thread as ThreadChannel).setName(truncated);
    }
  } catch (err) {
    console.warn(`[thread-ops] Failed to update thread name:`, err);
  }
}

export async function archiveThread(
  client: Client,
  threadId: string,
): Promise<void> {
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread && 'setArchived' in thread) {
      await (thread as ThreadChannel).send('📦 Session ended. Thread archived.');
      await (thread as ThreadChannel).setArchived(true);
    }
  } catch (err) {
    console.warn(`[thread-ops] Failed to archive thread ${threadId}:`, err);
  }
}

export async function deleteHubMessage(
  client: Client,
  hubChannelId: string,
  messageId: string,
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(hubChannelId);
    if (!channel || !('messages' in channel)) return false;
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    await (msg as Message).delete();
    return true;
  } catch (err) {
    if (isDiscordUnknownMessage(err)) {
      // Already deleted on Discord side; treat as success to stop repeated cleanup retries.
      return true;
    }
    return deleteHubMessageViaThread(client, hubChannelId, messageId, err);
  }
}

export async function updateHubMessage(
  client: Client,
  hubChannelId: string,
  messageId: string,
  session: CLISession,
  status: HubStatus,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(hubChannelId);
    if (!channel || !('messages' in channel)) return;
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    await msg.edit({
      embeds: [hubEmbed(session, status)],
    });
  } catch (err) {
    console.warn(`[thread-ops] Failed to update hub message:`, err);
  }
}

function hubEmbed(session: CLISession, status: HubStatus) {
  const brand = getAgentBrand(session.agent);
  const author = {
    name: brand.label,
    ...(brand.iconUrl ? { icon_url: brand.iconUrl } : {}),
  };
  let statusText = '⚪ 等待中';
  let color = 0xFEE75C;
  if (status === 'active') {
    statusText = '\ud83d\udfe2 进行中';
    color = brand.color;
  } else if (status === 'idle') {
    statusText = '\ud83d\udfe1 空闲等待…';
    color = 0xFAA307;
  } else if (status === 'pending') {
    statusText = '\ud83d\udfe0 等待激活';
    color = 0xFEE75C;
  }

  return {
    author,
    title: `${brand.emoji} ${session.project} / ${session.branch}`,
    description: [
      `**会话:** \`${session.sessionId.slice(0, 8)}\``,
      `**目录:** \`${formatDirectory(session.cwd)}\``,
      `**过滤:** ${session.filterLevel}`,
      `**状态:** ${statusText}`,
    ].join('\n'),
    color,
    timestamp: new Date().toISOString(),
  };
}

async function deleteHubMessageViaThread(
  client: Client,
  hubChannelId: string,
  threadId: string,
  originalError: unknown,
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(threadId);
    if (!channel || !('fetchStarterMessage' in channel)) {
      if (isDiscordUnknownMessage(originalError)) return true;
      console.warn(`[thread-ops] Failed to delete hub message:`, originalError);
      return false;
    }

    const thread = channel as ThreadChannel;
    if (thread.parentId !== hubChannelId) {
      if (isDiscordUnknownMessage(originalError)) return true;
      console.warn(`[thread-ops] Failed to delete hub message:`, originalError);
      return false;
    }

    const starter = await thread.fetchStarterMessage();
    if (!starter) {
      if (isDiscordUnknownMessage(originalError)) return true;
      console.warn(`[thread-ops] Failed to delete hub message:`, originalError);
      return false;
    }

    await starter.delete();
    return true;
  } catch {
    if (isDiscordUnknownMessage(originalError)) return true;
    console.warn(`[thread-ops] Failed to delete hub message:`, originalError);
    return false;
  }
}

function isDiscordUnknownMessage(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeErr = err as {
    code?: unknown;
    rawError?: { code?: unknown };
  };
  return maybeErr.code === 10008 || maybeErr.rawError?.code === 10008;
}
