import { Events, GuildMember, TextChannel, EmbedBuilder, Colors, type Client } from 'discord.js';
import { isUserBanned } from '../lib/ban-registry';
import { ENV_MOD_DEFAULTS } from '../lib/config';
import { getModeration } from '../lib/guild-settings';

export function registerJoinEvents(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    const entry = isUserBanned(member.id);
    if (!entry) return;

    // Alert admins — don't auto-ban on join since Discord already tracks server bans,
    // but cross-server registry hits are worth a human decision.
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('🚨 Known Bad Actor Joined')
      .setDescription(`<@${member.id}> (\`${member.id}\`) just joined **${member.guild.name}**.\n\nThis user is in the ban registry.`)
      .addFields(
        { name: 'Reason',     value: entry.reason,                                   inline: false },
        { name: 'Banned At',  value: new Date(entry.bannedAt).toUTCString(),         inline: true  },
        { name: 'Banned By',  value: entry.bannedBy === 'auto' ? 'Auto-ban' : `<@${entry.bannedBy}>`, inline: true },
        { name: 'Origin Server', value: entry.guildId,                               inline: true  },
      )
      .setThumbnail(member.displayAvatarURL())
      .setFooter({ text: 'Use /banregistry view to manage the registry' });

    const mod = getModeration(member.guild.id, ENV_MOD_DEFAULTS);
    for (const channelId of mod.alertChannelIds) {
      const channel = member.guild.channels.cache.get(channelId) as TextChannel | undefined;
      if (channel) await channel.send({ embeds: [embed] }).catch(() => null);
    }
  });
}
