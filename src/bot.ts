import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { registerEvents } from './events';
import { registerCommands } from './commands';
import { startScheduler, stopScheduler } from './lib/scheduler';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN not set');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

registerEvents(client);
registerCommands(client);

client.once(Events.ClientReady, (c) => {
  console.log(`Ready: ${c.user.tag}`);
  startScheduler(client);
});

client.on(Events.Error, (err) => {
  console.error('[discord] client error:', err);
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(`[discord] shard ${shardId} disconnected (code ${event.code}) — reconnecting...`);
});

client.on(Events.ShardReconnecting, (shardId) => {
  console.log(`[discord] shard ${shardId} reconnecting`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err);
  process.exit(1);
});

// Graceful shutdown — Railway sends SIGTERM on redeploy/stop. Stop the scheduler and
// close the Discord connection cleanly, then exit 0 so it isn't logged as a failure.
// The durable JSON stores (guild settings, ban registry, schedules, reports) use
// synchronous writes, so no in-flight write can be lost here. (The ComfyUI GitHub-node
// cache writes asynchronously, but it's a regenerable cache — safe not to flush on exit.)
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[process] ${signal} received — shutting down gracefully`);
  try {
    stopScheduler();
    await client.destroy();
  } catch (err) {
    console.error('[process] error during shutdown:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

client.login(token).catch((err) => {
  console.error('[discord] login failed:', err);
  process.exit(1);
});
