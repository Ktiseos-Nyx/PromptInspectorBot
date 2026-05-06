import { ChatInputCommandInteraction, EmbedBuilder, Colors, SlashCommandBuilder } from 'discord.js';
import { addReminder, deleteReminder, getReminders, parseInterval, formatInterval } from '../lib/scheduler';

export const remindCommand = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set up reminders for this server')
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Create a reminder')
        .addStringOption(o => o.setName('message').setDescription('What to remind').setRequired(true))
        .addStringOption(o => o.setName('in').setDescription('Fire once after this time, e.g. 30m, 2h'))
        .addStringOption(o => o.setName('every').setDescription('Repeat on this interval, e.g. 1h, 24h, 7d'))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (defaults to current)'))
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List active reminders in this server')
    )
    .addSubcommand(s =>
      s.setName('delete')
        .setDescription('Delete a reminder')
        .addStringOption(o => o.setName('id').setDescription('Reminder ID from /remind list').setRequired(true))
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', ephemeral: true });

    const sub = interaction.options.getSubcommand();

    // ── set ──────────────────────────────────────────────────────────────────
    if (sub === 'set') {
      const message = interaction.options.getString('message', true);
      const inStr   = interaction.options.getString('in');
      const everyStr = interaction.options.getString('every');
      const channel = interaction.options.getChannel('channel') ?? interaction.channel!;

      if (!inStr && !everyStr) {
        return interaction.reply({ content: '❌ Provide either `in` (one-time) or `every` (repeating).', ephemeral: true });
      }
      if (inStr && everyStr) {
        return interaction.reply({ content: '❌ Use `in` for one-time or `every` for repeating — not both.', ephemeral: true });
      }

      const delayStr = inStr ?? everyStr!;
      const ms = parseInterval(delayStr);
      if (!ms) return interaction.reply({ content: '❌ Invalid time format. Use e.g. `30m`, `2h`, `1d`.', ephemeral: true });
      if (ms < 60_000) return interaction.reply({ content: '❌ Minimum is 1 minute.', ephemeral: true });

      const reminder = addReminder({
        guildId: interaction.guildId!,
        channelId: channel.id,
        userId: interaction.user.id,
        message,
        intervalMs: everyStr ? ms : null,
        nextFireAt: Date.now() + ms,
      });

      const type = everyStr ? `every **${formatInterval(ms)}**` : `in **${formatInterval(ms)}**`;

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle('⏰ Reminder Set')
          .setDescription(`**${message}**\n\nFiring ${type} in <#${channel.id}>`)
          .setFooter({ text: `ID: ${reminder.id}` })],
        ephemeral: true,
      });
    }

    // ── list ─────────────────────────────────────────────────────────────────
    else if (sub === 'list') {
      const reminders = getReminders(interaction.guildId!);

      if (!reminders.length) {
        return interaction.reply({ content: 'No active reminders in this server.', ephemeral: true });
      }

      const lines = reminders.map(r => {
        const timeLeft = Math.max(0, r.nextFireAt - Date.now());
        const type = r.intervalMs ? `🔁 every ${formatInterval(r.intervalMs)}` : `1️⃣ once`;
        return `\`${r.id}\` — **${r.message}** | ${type} | next in ~${formatInterval(timeLeft)} | <#${r.channelId}>`;
      });

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle(`⏰ Reminders (${reminders.length})`)
          .setDescription(lines.join('\n'))],
        ephemeral: true,
      });
    }

    // ── delete ───────────────────────────────────────────────────────────────
    else if (sub === 'delete') {
      const id = interaction.options.getString('id', true);
      const deleted = deleteReminder(id, interaction.guildId!);
      await interaction.reply({
        content: deleted ? `✅ Reminder \`${id}\` deleted.` : '❌ Reminder not found.',
        ephemeral: true,
      });
    }
  },
};
