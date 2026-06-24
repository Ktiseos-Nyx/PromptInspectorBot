import {
  ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, MessageFlags,
} from 'discord.js';
import { getModeration, setModerationField } from '../lib/guild-settings';
import { ENV_MOD_DEFAULTS } from '../lib/config';
import { CROSS_POST_WINDOW } from '../lib/security';
import { TRUSTED_USERS_MAX, TRUSTED_ROLES_MAX } from '../lib/settings-panel';

export const securityCommand = {
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Configure anti-spam thresholds (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('velocity').setDescription('Cross-post velocity thresholds')
      .addIntegerOption(o => o.setName('channels').setDescription('Distinct channels of ANY media to ban (default 4)').setMinValue(2))
      .addIntegerOption(o => o.setName('same').setDescription('Distinct channels of the SAME file to ban (default 3)').setMinValue(2))
      .addIntegerOption(o => o.setName('window').setDescription('Time window in seconds (default 120, max 300)').setMinValue(10).setMaxValue(CROSS_POST_WINDOW)))
    .addSubcommand(s => s.setName('largemedia').setDescription('Raid-risky direct-upload types (default image/gif)')
      .addStringOption(o => o.setName('types').setDescription('CSV of MIME types treated as risky direct uploads (default image/gif)')))
    .addSubcommand(s => s.setName('honeypot').setDescription('Honeypot/catcher role behavior')
      .addStringOption(o => o.setName('mode').setDescription('off | crosspost | strict').setRequired(true)
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'crosspost', value: 'crosspost' },
          { name: 'strict', value: 'strict' },
        )))
    .addSubcommand(s => s.setName('trust').setDescription('Trust a user/bot or role — skipped entirely by anti-scam')
      .addUserOption(o => o.setName('user').setDescription('User or bot to trust (e.g. Carlbot)'))
      .addRoleOption(o => o.setName('role').setDescription('Role to trust')))
    .addSubcommand(s => s.setName('untrust').setDescription('Remove a user/bot or role from the trusted list')
      .addUserOption(o => o.setName('user').setDescription('User or bot to untrust'))
      .addRoleOption(o => o.setName('role').setDescription('Role to untrust')))
    .addSubcommand(s => s.setName('show').setDescription('Show the current resolved config')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
    }
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Requires Manage Server permission.', flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === 'velocity') {
      const ch = interaction.options.getInteger('channels');
      const same = interaction.options.getInteger('same');
      const win = interaction.options.getInteger('window');
      if (ch != null) setModerationField(guildId, 'mediaSpamChannels', ch);
      if (same != null) setModerationField(guildId, 'mediaSpamSameChannels', same);
      if (win != null) setModerationField(guildId, 'mediaSpamWindowSec', win);
    } else if (sub === 'largemedia') {
      const types = interaction.options.getString('types');
      if (types != null) {
        setModerationField(guildId, 'largeMediaTypes', types.split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
      }
    } else if (sub === 'honeypot') {
      const mode = interaction.options.getString('mode', true) as 'off' | 'crosspost' | 'strict';
      setModerationField(guildId, 'honeypotMode', mode);
    } else if (sub === 'trust' || sub === 'untrust') {
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      if (!user && !role) {
        return interaction.reply({ content: '❌ Provide a `user` and/or a `role`.', flags: MessageFlags.Ephemeral });
      }
      // Merge onto the resolved set so existing (incl. env-default) trusted entries are
      // preserved rather than clobbered when this guild's override is first written.
      const cur = getModeration(guildId, ENV_MOD_DEFAULTS);
      // Adding past the panel's caps would make the Trust page un-renderable
      // (a select's default_values must be <= its max_values), so reject overflow.
      if (sub === 'trust') {
        if (user && !cur.trustedUserIds.has(user.id) && cur.trustedUserIds.size >= TRUSTED_USERS_MAX) {
          return interaction.reply({ content: `❌ Trusted users/bots limit is ${TRUSTED_USERS_MAX}.`, flags: MessageFlags.Ephemeral });
        }
        if (role && !cur.trustedRoleIds.has(role.id) && cur.trustedRoleIds.size >= TRUSTED_ROLES_MAX) {
          return interaction.reply({ content: `❌ Trusted roles limit is ${TRUSTED_ROLES_MAX}.`, flags: MessageFlags.Ephemeral });
        }
      }
      if (user) {
        const set = new Set(cur.trustedUserIds);
        if (sub === 'trust') set.add(user.id); else set.delete(user.id);
        setModerationField(guildId, 'trustedUserIds', [...set]);
      }
      if (role) {
        const set = new Set(cur.trustedRoleIds);
        if (sub === 'trust') set.add(role.id); else set.delete(role.id);
        setModerationField(guildId, 'trustedRoleIds', [...set]);
      }
    }

    const r = getModeration(guildId, ENV_MOD_DEFAULTS);
    const trustedUsers = r.trustedUserIds.size ? [...r.trustedUserIds].map(u => `<@${u}>`).join(' ') : 'none';
    const trustedRoles = r.trustedRoleIds.size ? [...r.trustedRoleIds].map(role => `<@&${role}>`).join(' ') : 'none';
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }, // render trusted role/user mentions without pinging them
      content: [
        '🛡️ **Security config (resolved for this server)**',
        `• media-spam channels (any media): **${r.mediaSpamChannels}**`,
        `• same-file channels: **${r.mediaSpamSameChannels}**`,
        `• window: **${r.mediaSpamWindowSec}s**`,
        `• risky direct-upload types: [${[...r.largeMediaTypes].join(', ') || 'none'}]`,
        `• honeypot mode: **${r.honeypotMode}**`,
        `• trusted users/bots: ${trustedUsers}`,
        `• trusted roles: ${trustedRoles}`,
      ].join('\n'),
    });
  },
};
