import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
  type ThreadChannel,
  type Interaction,
  type Message,
} from 'discord.js';
import type { Config } from '../config.js';
import type { SessionRegistry } from '../session-registry.js';
import type { CLISession } from '../store.js';
import {
  createSessionThread,
  archiveThread,
  updateHubMessage,
  updateThreadName,
} from './thread-ops.js';

const DISCORD_CHAR_LIMIT = 2000;

/** Rendered message from content router — plain text or Discord embed */
export interface RenderedMessage {
  text?: string;
  embed?: {
    author?: { name: string; icon_url?: string };
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  };
}

export class DiscordAdapter {
  private client: Client;
  private config: Config;
  private registry: SessionRegistry;
  private running = false;

  constructor(config: Config, registry: SessionRegistry) {
    this.config = config;
    this.registry = registry;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.client.on('messageCreate', (msg) => this.onMessage(msg));
    this.client.on('interactionCreate', (interaction) => this.onInteraction(interaction));
    this.client.once('ready', () => {
      console.log(`[discord] Bot ready as ${this.client.user?.tag}`);
    });

    await this.client.login(this.config.discord.botToken);
    this.running = true;

    // Wire session lifecycle events
    this.registry.on('session:registered', (session) => this.onSessionRegistered(session));
    this.registry.on('session:unregistered', (session) => this.onSessionEnded(session));
    this.registry.on('session:dead', (session) => this.onSessionEnded(session));
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.client.destroy();
    console.log('[discord] Bot stopped');
  }

  // ── Outbound: send to Discord ──

  async sendToThread(threadId: string, message: string | RenderedMessage): Promise<string | undefined> {
    try {
      const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
      if (!thread) return undefined;

      // Embed message
      if (typeof message !== 'string' && message.embed) {
        const sent = await thread.send({ embeds: [message.embed] });
        return sent.id;
      }

      // Plain text
      const text = typeof message === 'string' ? message : (message.text || '');
      if (!text) return undefined;

      const chunks = this.chunkText(text, DISCORD_CHAR_LIMIT);
      let lastMsgId: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        let chunk = chunks[i];
        if (chunks.length > 1) {
          if (i > 0) chunk = `*[...continued]*\n${chunk}`;
          if (i < chunks.length - 1) chunk = `${chunk}\n*[continued...]*`;
        }
        const sent = await thread.send(chunk);
        lastMsgId = sent.id;
      }
      return lastMsgId;
    } catch (err) {
      console.error(`[discord] Failed to send to thread ${threadId}:`, err);
      return undefined;
    }
  }

  async sendPermissionButtons(
    threadId: string,
    permissionId: string,
    toolName: string,
    toolInput: unknown,
  ): Promise<string | undefined> {
    try {
      const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
      if (!thread) return undefined;

      const inputStr = typeof toolInput === 'string'
        ? toolInput
        : JSON.stringify(toolInput, null, 2);
      const truncated = inputStr.length > 800
        ? inputStr.slice(0, 800) + '...'
        : inputStr;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`perm:allow:${permissionId}`)
          .setLabel('Allow')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`perm:deny:${permissionId}`)
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger),
      );

      const sent = await thread.send({
        embeds: [{
          title: `⚠️ Permission Request: ${toolName}`,
          description: `\`\`\`json\n${truncated}\n\`\`\``,
          color: 0xFFA500,
          timestamp: new Date().toISOString(),
        }],
        components: [row],
      });

      return sent.id;
    } catch (err) {
      console.error(`[discord] Failed to send permission buttons:`, err);
      return undefined;
    }
  }

  async updateThreadTitle(threadId: string, title: string): Promise<void> {
    await updateThreadName(this.client, threadId, title);
  }

  // ── Inbound handlers ──

  /** Callback for incoming messages: (session, text, userId) => void */
  onInboundMessage: ((session: CLISession, text: string, userId: string) => void) | null = null;

  /** Callback for permission decisions: (permissionId, decision) => void */
  onPermissionDecision: ((permissionId: string, decision: 'allow' | 'deny') => void) | null = null;

  private async onMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;

    // Authorization check
    if (this.config.discord.allowedUsers.length > 0
      && !this.config.discord.allowedUsers.includes(msg.author.id)) {
      return;
    }

    // Hub channel commands
    if (msg.channelId === this.config.discord.hubChannelId) {
      await this.handleHubCommand(msg);
      return;
    }

    // Thread messages → route to CLI session
    const session = this.registry.getByThreadId(msg.channelId);
    if (session && this.onInboundMessage) {
      this.onInboundMessage(session, msg.content, msg.author.id);
    }
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('perm:')) return;

    const parts = customId.split(':');
    const decision = parts[1] as 'allow' | 'deny';
    const permissionId = parts.slice(2).join(':');

    // Authorization check
    if (this.config.discord.allowedUsers.length > 0
      && !this.config.discord.allowedUsers.includes(interaction.user.id)) {
      await interaction.reply({ content: 'Unauthorized.', ephemeral: true });
      return;
    }

    if (this.onPermissionDecision) {
      this.onPermissionDecision(permissionId, decision);
    }

    const emoji = decision === 'allow' ? '✅' : '❌';
    await interaction.update({
      components: [], // Remove buttons
      embeds: [{
        ...interaction.message.embeds[0]?.toJSON(),
        title: `${emoji} Permission ${decision === 'allow' ? 'Allowed' : 'Denied'}`,
        color: decision === 'allow' ? 0x57F287 : 0xED4245,
      }],
    });
  }

  private async handleHubCommand(msg: Message): Promise<void> {
    const text = msg.content.trim();
    if (text === '/status') {
      const sessions = this.registry.listActive();
      if (sessions.length === 0) {
        await msg.reply('No active CLI sessions.');
        return;
      }
      const lines = sessions.map(s => {
        const thread = s.threadId ? `<#${s.threadId}>` : 'no thread';
        return `• **${s.project}/${s.branch}** [${s.sessionId.slice(0, 6)}] — ${thread} — ${s.filterLevel}`;
      });
      await msg.reply(lines.join('\n'));
    }
  }

  // ── Session lifecycle ──

  private async onSessionRegistered(session: CLISession): Promise<void> {
    try {
      const { threadId, starterMessageId } = await createSessionThread(
        this.client,
        this.config.discord.hubChannelId,
        session,
        this.config.autoArchiveHours,
      );
      this.registry.bindThread(session.sessionId, threadId, starterMessageId);
      console.log(`[discord] Thread created for ${session.project}: ${threadId}`);
    } catch (err) {
      console.error(`[discord] Failed to create thread for ${session.sessionId}:`, err);
    }
  }

  /** Track already-ended sessions to prevent duplicate archive calls */
  private endedSessions = new Set<string>();

  private async onSessionEnded(session: CLISession): Promise<void> {
    // Prevent duplicate end handling (both unregister and dead events may fire)
    if (this.endedSessions.has(session.sessionId)) return;
    this.endedSessions.add(session.sessionId);

    if (session.threadId) {
      await archiveThread(this.client, session.threadId);
    }
    if (session.hubMessageId) {
      await updateHubMessage(
        this.client,
        this.config.discord.hubChannelId,
        session.hubMessageId,
        session,
        'dead',
      );
    }
  }

  private chunkText(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      // Try to break at newline
      let breakAt = remaining.lastIndexOf('\n', limit);
      if (breakAt <= 0) breakAt = limit;
      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    }
    return chunks;
  }
}
