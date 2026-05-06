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

client.login(token);
