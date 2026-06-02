import { Events, Guild, type Client } from 'discord.js';
import { ALLOWED_GUILD_IDS } from '../lib/config';
import { shouldLeaveGuild } from '../lib/allowlist';

async function leaveIfNotAllowed(guild: Guild, when: string): Promise<void> {
  if (shouldLeaveGuild(guild.id, ALLOWED_GUILD_IDS)) {
    console.warn(`[allowlist] Leaving non-allowlisted guild ${guild.name} (${guild.id}) [${when}]`);
    await guild.leave().catch(err => console.error('[allowlist] leave failed:', err));
  }
}

export function registerGuildEvents(client: Client): void {
  // New invite — leave immediately if not allowlisted.
  client.on(Events.GuildCreate, (guild) => { void leaveIfNotAllowed(guild, 'join'); });

  // Startup sweep — leave any non-allowlisted guild we are already in.
  client.once(Events.ClientReady, (c) => {
    if (ALLOWED_GUILD_IDS.size === 0) return; // open mode — skip sweep
    for (const guild of c.guilds.cache.values()) void leaveIfNotAllowed(guild, 'startup');
  });
}
