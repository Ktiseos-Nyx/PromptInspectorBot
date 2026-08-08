import {
  EmbedBuilder, Colors, ActionRowBuilder,
  RoleSelectMenuBuilder, UserSelectMenuBuilder,
} from 'discord.js';
import { navRow, fmtRoles, fmtUsers, TRUSTED_ROLES_MAX, TRUSTED_USERS_MAX } from './shared';
import type { GuildEntry } from '../lib/settings-types';

export function buildTrustPanel(state: GuildEntry) {
  const t = state.toggles ?? {};
  const m = state.moderation ?? {};

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('🤝 Trust')
    .setDescription([
      '**Trusted — skipped entirely by anti-scam**',
      `┣ Trusted roles: ${fmtRoles(m.trustedRoleIds)}`,
      `┗ Trusted users / bots: ${fmtUsers(m.trustedUserIds)}`,
      '*Add admin/mod bots (e.g. Carlbot) here so their log embeds are never flagged.*',
    ].join('\n'));

  const components: ActionRowBuilder<any>[] = [navRow('trust', t.security ?? true)];

  components.push(
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('settings:trustedRoles')
        .setPlaceholder('Trusted roles')
        .setMinValues(0).setMaxValues(TRUSTED_ROLES_MAX)
        .setDefaultRoles(...(m.trustedRoleIds ?? []).slice(0, TRUSTED_ROLES_MAX)),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('settings:trustedUsers')
        .setPlaceholder('Trusted users / bots (e.g. Carlbot)')
        .setMinValues(0).setMaxValues(TRUSTED_USERS_MAX)
        .setDefaultUsers(...(m.trustedUserIds ?? []).slice(0, TRUSTED_USERS_MAX)),
    ),
  );

  return { embeds: [embed], components };
}
