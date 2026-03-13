import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig,
  validateConfig,
  AGENT_IM_HOME,
  DATA_DIR,
  LOG_DIR,
  PID_FILE,
} from './config.js';
import { Store } from './store.js';
import { IPCServer } from './ipc-server.js';
import { SessionRegistry } from './session-registry.js';
import { DiscordAdapter } from './discord/adapter.js';
import { ContentRouter } from './content-router.js';

async function main(): Promise<void> {
  // Ensure directories exist
  for (const dir of [AGENT_IM_HOME, DATA_DIR, LOG_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const config = loadConfig();
  const configError = validateConfig(config);
  if (configError) {
    console.error(`[agent-im] Config error: ${configError}`);
    console.error(`[agent-im] Create config at ~/.agent-im/config.env (see config.env.example)`);
    process.exit(1);
  }

  console.log('[agent-im] Starting daemon...');

  // ── Initialize components ──
  const store = new Store();
  const ipc = new IPCServer();
  const registry = new SessionRegistry(store, config.defaultFilter, config.heartbeatIntervalMs);
  const discord = new DiscordAdapter(config, registry);
  const router = new ContentRouter(registry, store, discord, ipc);

  // ── Wire IPC events to registry ──
  ipc.on('register', (msg) => registry.handleRegister(msg));
  ipc.on('unregister', (msg) => registry.handleUnregister(msg));
  ipc.on('event', (msg) => registry.handleEvent(msg));

  // ── Start everything ──
  await ipc.start();
  registry.start();
  await discord.start();
  router.start();

  // Write PID file
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
  console.log(`[agent-im] Daemon running (PID: ${process.pid})`);

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async (signal?: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const reason = signal ? `signal: ${signal}` : 'shutdown';
    console.log(`[agent-im] Shutting down (${reason})...`);
    router.stop();
    registry.stop();
    await discord.stop();
    await ipc.stop();
    try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
    console.log('[agent-im] Stopped.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  process.on('unhandledRejection', (reason) => {
    console.error('[agent-im] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[agent-im] uncaughtException:', err.stack || err.message);
    process.exit(1);
  });

  // Keep alive
  setInterval(() => { /* keepalive */ }, 45_000);
}

main().catch((err) => {
  console.error('[agent-im] Fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
