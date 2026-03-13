import type {
  Client,
  TextChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import type { CLISession } from '../store.js';

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
  const starterMsg = await textChannel.send({
    embeds: [{
      title: `🖥️ ${session.project} / ${session.branch}`,
      description: [
        `**Session:** \`${session.sessionId.slice(0, 8)}\``,
        `**Directory:** \`${session.cwd}\``,
        `**Filter:** ${session.filterLevel}`,
        `**Status:** 🟢 Active`,
      ].join('\n'),
      color: 0x5865F2, // Discord blurple
      timestamp: new Date().toISOString(),
    }],
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

export async function updateHubMessage(
  client: Client,
  hubChannelId: string,
  messageId: string,
  session: CLISession,
  status: 'active' | 'dead',
): Promise<void> {
  try {
    const channel = await client.channels.fetch(hubChannelId);
    if (!channel || !('messages' in channel)) return;
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    const statusEmoji = status === 'active' ? '🟢 Active' : '🔴 Ended';
    const color = status === 'active' ? 0x5865F2 : 0x95A5A6;

    await msg.edit({
      embeds: [{
        title: `🖥️ ${session.project} / ${session.branch}`,
        description: [
          `**Session:** \`${session.sessionId.slice(0, 8)}\``,
          `**Directory:** \`${session.cwd}\``,
          `**Filter:** ${session.filterLevel}`,
          `**Status:** ${statusEmoji}`,
        ].join('\n'),
        color,
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (err) {
    console.warn(`[thread-ops] Failed to update hub message:`, err);
  }
}
