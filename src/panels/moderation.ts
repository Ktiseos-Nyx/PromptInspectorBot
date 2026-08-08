import {
  EmbedBuilder, Colors, ActionRowBuilder,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType,
} from 'discord.js';
import { navRow, fmtChannel, fmtChannels, fmtRoles } from './shared';
import type { GuildEntry } from '../lib/settings-types';

function on(v: boolean | undefined): string { return v ? '✅' : '❌'; }

export function buildModerationPanel(state: GuildEntry) {
  const t = state.toggles ?? {};
  const m = state.moderation ?? {};
  const securityOn = t.security ?? true;

  const lines: string[] = [];
  lines.push(`${on(securityOn)} **Anti-scam protection**`);
  if (securityOn) {
    lines.push(`┣ Alert channel: ${fmtChannel(m.alertChannelId)}`);
    lines.push(`┣ Monitored channels: ${fmtChannels(m.monitoredChannelIds)}`);
    lines.push(`┗ Catcher role: ${fmtRoles(m.catcherRoleId ? [m.catcherRoleId] : [])}`);
    lines.push('*Trusted roles & bots are on the **Trust** page.*');
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('🛡️ Moderation')
    .setDescription(lines.join('\n'));

  const components: ActionRowBuilder<any>[] = [navRow('moderation', securityOn)];

  components.push(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('settings:alertChannel')
        .setPlaceholder('Alert channel')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(0).setMaxValues(1),
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('settings:monitoredChannels')
        .setPlaceholder('Monitored channels (none = all)')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(0).setMaxValues(25),
    ),
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('settings:catcherRole')
        .setPlaceholder('Catcher role — extra scam weight')
        .setMinValues(0).setMaxValues(1),
    ),
  );

  return { embeds: [embed], components };
}
