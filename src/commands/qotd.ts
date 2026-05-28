import fs from 'fs';
import path from 'path';
import { ChatInputCommandInteraction, EmbedBuilder, Colors, PermissionFlagsBits, SlashCommandBuilder, TextChannel } from 'discord.js';
import { getQotdConfig, setQotdConfig, addQotdQuestion, parseInterval, formatInterval } from '../lib/scheduler';

export const qotdCommand = {
  data: new SlashCommandBuilder()
    .setName('qotd')
    .setDescription('Question of the Day management')
    .addSubcommand(s =>
      s.setName('setup')
        .setDescription('Set up QOTD for this server (admin only)')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post in').setRequired(true))
        .addStringOption(o => o.setName('interval').setDescription('How often to post, e.g. 24h, 12h, 6h').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add a question to the pool (admin only)')
        .addStringOption(o => o.setName('question').setDescription('The question to add').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription('Show QOTD status and pool stats')
    )
    .addSubcommand(s =>
      s.setName('post')
        .setDescription('Post a question right now (admin only)')
    )
    .addSubcommand(s =>
      s.setName('toggle')
        .setDescription('Enable or disable QOTD (admin only)')
        .addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('import')
        .setDescription('Import all questions from qotd-questions.json (admin only)')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const isAdmin = (interaction.member?.permissions as any)?.has(PermissionFlagsBits.ManageGuild);

    // ── setup ────────────────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', ephemeral: true });

      const channel = interaction.options.getChannel('channel', true);
      const intervalStr = interaction.options.getString('interval', true);
      const intervalMs = parseInterval(intervalStr);

      if (!intervalMs) return interaction.reply({ content: '❌ Invalid interval. Use formats like `24h`, `6h`, `30m`, `2d`.', ephemeral: true });
      if (intervalMs < 60_000) return interaction.reply({ content: '❌ Minimum interval is 1 minute.', ephemeral: true });

      setQotdConfig(interaction.guildId!, { channelId: channel.id, intervalMs, enabled: true, lastPosted: 0 });

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle('✅ QOTD Configured')
          .setDescription(`Posting to <#${channel.id}> every **${formatInterval(intervalMs)}**.\n\nAdd questions with \`/qotd add\`.`)],
      });
    }

    // ── add ──────────────────────────────────────────────────────────────────
    else if (sub === 'add') {
      if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', ephemeral: true });

      const cfg = getQotdConfig(interaction.guildId!);
      if (!cfg) return interaction.reply({ content: '❌ QOTD not set up yet. Use `/qotd setup` first.', ephemeral: true });

      const question = interaction.options.getString('question', true);
      const added = addQotdQuestion(interaction.guildId!, question);

      await interaction.reply({
        content: added
          ? `✅ Question added! Pool now has **${cfg.questions.length + 1}** questions.`
          : '❌ That question is already in the pool.',
        ephemeral: true,
      });
    }

    // ── status ───────────────────────────────────────────────────────────────
    else if (sub === 'status') {
      const cfg = getQotdConfig(interaction.guildId!);
      if (!cfg) return interaction.reply({ content: '❌ QOTD is not set up on this server.', ephemeral: true });

      const remaining = cfg.questions.filter(q => !cfg.usedQuestions.includes(q)).length;
      const nextPost = cfg.lastPosted + cfg.intervalMs;
      const nextIn = Math.max(0, nextPost - Date.now());
      const nextStr = nextIn === 0 ? 'soon (next tick)' : `in ~${formatInterval(nextIn)}`;

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle('📊 QOTD Status')
          .addFields(
            { name: 'Channel',    value: `<#${cfg.channelId}>`,               inline: true },
            { name: 'Interval',   value: formatInterval(cfg.intervalMs),      inline: true },
            { name: 'Enabled',    value: cfg.enabled ? '✅ Yes' : '❌ No',     inline: true },
            { name: 'Total Q\'s', value: String(cfg.questions.length),        inline: true },
            { name: 'Remaining',  value: String(remaining),                   inline: true },
            { name: 'Next Post',  value: nextStr,                             inline: true },
          )],
      });
    }

    // ── post ─────────────────────────────────────────────────────────────────
    else if (sub === 'post') {
      if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', ephemeral: true });

      const cfg = getQotdConfig(interaction.guildId!);
      if (!cfg || !cfg.questions.length) return interaction.reply({ content: '❌ No questions in pool.', ephemeral: true });

      const unused = cfg.questions.filter(q => !cfg.usedQuestions.includes(q));
      const pool = unused.length ? unused : cfg.questions;
      if (!unused.length) setQotdConfig(interaction.guildId!, { usedQuestions: [] });

      const question = pool[Math.floor(Math.random() * pool.length)];
      setQotdConfig(interaction.guildId!, {
        usedQuestions: [...(unused.length ? cfg.usedQuestions : []), question],
        lastPosted: Date.now(),
      });

      const channel = interaction.client.channels.cache.get(cfg.channelId) as TextChannel | undefined;
      if (channel) await channel.send(`💬 **Question of the Day**\n\n${question}`);

      await interaction.reply({ content: '✅ Posted!', ephemeral: true });
    }

    // ── import ───────────────────────────────────────────────────────────────
    else if (sub === 'import') {
      if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', ephemeral: true });

      const cfg = getQotdConfig(interaction.guildId!);
      if (!cfg) return interaction.reply({ content: '❌ Run `/qotd setup` first.', ephemeral: true });

      const qotdPath = path.resolve(__dirname, '../qotd-questions.json');
      if (!fs.existsSync(qotdPath)) {
        return interaction.reply({ content: '❌ `qotd-questions.json` not found.', ephemeral: true });
      }

      const questions: string[] = JSON.parse(fs.readFileSync(qotdPath, 'utf8'));
      let added = 0;
      for (const q of questions) {
        if (addQotdQuestion(interaction.guildId!, q)) added++;
      }

      await interaction.reply({
        content: `✅ Imported **${added}** new questions (${questions.length - added} already existed). Pool now has **${cfg.questions.length + added}** questions.`,
        ephemeral: true,
      });
    }

    // ── toggle ───────────────────────────────────────────────────────────────
    else if (sub === 'toggle') {
      if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', ephemeral: true });

      const enabled = interaction.options.getBoolean('enabled', true);
      const cfg = getQotdConfig(interaction.guildId!);
      if (!cfg) return interaction.reply({ content: '❌ QOTD not set up yet.', ephemeral: true });

      setQotdConfig(interaction.guildId!, { enabled });
      await interaction.reply({ content: `✅ QOTD ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
    }
  },
};
