import {
  ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, MessageFlags,
  type AnySelectMenuInteraction, type ButtonInteraction,
} from 'discord.js';
import {
  getGuildModeration, getAllGuildSettings, setGuildSetting, setModerationField,
} from '../lib/guild-settings';
import {
  buildSettingsPanel, applyToggleSelection, AI_FEATURES, FUN_FEATURES, type Page,
} from '../lib/settings-panel';

function snapshot(guildId: string) {
  return { toggles: getAllGuildSettings(guildId), moderation: getGuildModeration(guildId) };
}

export const settingsCommand = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure bot features for this server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
    }
    const isAdmin = (interaction.member?.permissions as any)?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Requires Manage Server permission.', flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guildId!;
    let page: Page = 'moderation';

    const reply = await interaction.reply({
      ...buildSettingsPanel(snapshot(guildId) as any, page),
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });
    const message = reply.resource!.message!;

    const collector = message.createMessageComponentCollector({
      idle: 5 * 60_000,
      filter: i => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (i) => {
      // Guard the whole handler: an expired/failed component interaction would otherwise
      // reject out of this async callback as an unhandled rejection — which the global
      // handler in bot.ts turns into process.exit(1), crashing the bot.
      try {
        const id = i.customId;

        if (id.startsWith('settings:nav:')) {
          page = id.split(':')[2] as Page;
        } else if (id === 'settings:toggle:security') {
          const cur = getAllGuildSettings(guildId).security ?? true;
          setGuildSetting(guildId, 'security', !cur);
        } else if (id === 'settings:alertChannel') {
          const sel = i as AnySelectMenuInteraction;
          setModerationField(guildId, 'alertChannelId', sel.values[0] ?? null);
        } else if (id === 'settings:trustedRoles') {
          const sel = i as AnySelectMenuInteraction;
          setModerationField(guildId, 'trustedRoleIds', [...sel.values]);
        } else if (id === 'settings:monitoredChannels') {
          const sel = i as AnySelectMenuInteraction;
          setModerationField(guildId, 'monitoredChannelIds', [...sel.values]);
        } else if (id.startsWith('settings:tier:')) {
          const which = id.split(':')[2] as Page;
          const tier = which === 'ai' ? AI_FEATURES : FUN_FEATURES;
          const sel = i as AnySelectMenuInteraction;
          const next = applyToggleSelection(getAllGuildSettings(guildId), tier, [...sel.values]);
          for (const f of tier) setGuildSetting(guildId, f.value, next[f.value]);
        }

        await (i as ButtonInteraction | AnySelectMenuInteraction).update(
          buildSettingsPanel(snapshot(guildId) as any, page),
        );
      } catch (err) {
        console.error('[settings] panel interaction failed:', err);
      }
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => null);
    });
  },
};
