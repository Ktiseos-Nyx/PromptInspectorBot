import type { Client } from 'discord.js';
import { registerMessageEvents } from './onMessage';
import { registerReactionEvents } from './onReaction';
import { registerJoinEvents } from './onJoin';
import { registerGuildEvents } from './onGuild';

export function registerEvents(client: Client): void {
  registerMessageEvents(client);
  registerReactionEvents(client);
  registerJoinEvents(client);
  registerGuildEvents(client);
}
