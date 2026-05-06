import { ChatInputCommandInteraction, EmbedBuilder, Colors, PermissionFlagsBits, SlashCommandBuilder,  MessageFlags} from 'discord.js';
import { getAllGuildSettings, setGuildSetting } from '../lib/guild-settings';

const FEATURES = [
  { value: 'metadata',      label: 'Metadata extraction (reactions + /metadata)' },
  { value: 'describe',      label: '/describe — AI image description' },
  { value: 'ask',           label: '/ask — conversational AI' },
  { value: 'coder',         label: '/coder — coding help' },
  { value: 'techsupport',   label: '/techsupport — IT help' },
  { value: 'fun_commands',  label: 'Fun commands (/decide, /poll, /wildcard, /goodnight)' },
  { value: 'interact',      label: '/interact — user interactions' },
  { value: 'qotd',          label: 'QOTD system' },
  { value: 'security',      label: 'Security (anti-scam, magic bytes check)' },
];

export const settingsCommand = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure bot features for this server (admin only)')
    .addSubcommand(s =>
      s.setName('view')
        .setDescription('Show current settings')
    )
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Enable or disable a feature')
        .addStringOption(o =>
          o.setName('feature').setDescription('Feature to change').setRequired(true)
            .addChoices(...FEATURES.map(f => ({ name: f.label, value: f.value })))
        )
        .addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true))
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });

    const isAdmin = (interaction.member?.permissions as any)?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const current = getAllGuildSettings(interaction.guildId!);
      const lines = FEATURES.map(f => `${current[f.value] ? '✅' : '❌'} **${f.label}**`);

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle(`⚙️ Settings — ${interaction.guild.name}`)
          .setDescription(lines.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    else if (sub === 'set') {
      const feature = interaction.options.getString('feature', true);
      const enabled = interaction.options.getBoolean('enabled', true);

      setGuildSetting(interaction.guildId!, feature, enabled);
      const label = FEATURES.find(f => f.value === feature)?.label ?? feature;

      await interaction.reply({
        content: `✅ **${label}** ${enabled ? 'enabled' : 'disabled'}.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
