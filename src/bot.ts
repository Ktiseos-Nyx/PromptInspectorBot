import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { registerEvents } from './events';
import { registerCommands } from './commands';
import { startScheduler } from './lib/scheduler';

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
});

process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err);
});

client.login(token).catch((err) => {
  console.error('[discord] login failed:', err);
  process.exit(1);
});
