import { ChatInputCommandInteraction, EmbedBuilder, Colors, PermissionFlagsBits, SlashCommandBuilder,  MessageFlags} from 'discord.js';
import { isUserBanned, recordBan, removeBan, listBans, listPatterns, removePattern, getStats, recordPattern, addWordPattern, removeWordPattern, listWordPatterns, WordPatternAction } from '../lib/ban-registry';

export const banregistryCommand = {
  data: new SlashCommandBuilder()
    .setName('banregistry')
    .setDescription('Manage the persistent ban and pattern registry (admin only)')
    .addSubcommand(s =>
      s.setName('view')
        .setDescription('Show registry stats and recent entries')
    )
    .addSubcommand(s =>
      s.setName('adduser')
        .setDescription('Manually add a user to the registry')
        .addStringOption(o => o.setName('userid').setDescription('Discord user ID').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('removeuser')
        .setDescription('Remove a user from the registry')
        .addStringOption(o => o.setName('userid').setDescription('Discord user ID').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('check')
        .setDescription('Check if a user is in the registry')
        .addStringOption(o => o.setName('userid').setDescription('Discord user ID').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('addpattern')
        .setDescription('Manually add a message pattern to the registry')
        .addStringOption(o => o.setName('text').setDescription('Message text to fingerprint and ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('removepattern')
        .setDescription('Remove a pattern by its fingerprint')
        .addStringOption(o => o.setName('fingerprint').setDescription('Fingerprint from /banregistry view').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('addword')
        .setDescription('Add a word/phrase filter (prefix with "regex:" for regex patterns)')
        .addStringOption(o => o.setName('pattern').setDescription('Word, phrase, or regex:... pattern').setRequired(true))
        .addStringOption(o =>
          o.setName('action').setDescription('What to do on match').setRequired(true)
            .addChoices(
              { name: 'Warn (alert admins, keep message)', value: 'warn' },
              { name: 'Delete (remove message + alert)', value: 'delete' },
              { name: 'Ban (instant ban)', value: 'ban' },
            )
        )
        .addStringOption(o => o.setName('reason').setDescription('Reason for this filter').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('removeword')
        .setDescription('Remove a word pattern by ID')
        .addStringOption(o => o.setName('id').setDescription('Pattern ID from /banregistry words').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('words')
        .setDescription('List all active word patterns')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });

    const isAdmin = (interaction.member?.permissions as any)?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) return interaction.reply({ content: '❌ Requires Manage Server permission.', flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();

    // ── view ─────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      const stats = getStats();
      const users = listBans(10);
      const patterns = listPatterns(5);

      const userLines = users.length
        ? users.map(u => `• \`${u.id}\` — ${u.reason.slice(0, 60)} *(${new Date(u.bannedAt).toLocaleDateString()})*`)
        : ['No users in registry'];

      const patternLines = patterns.length
        ? patterns.map(p => `• \`${p.fingerprint}\` — ${p.reason.slice(0, 50)}\n  *"${p.sample?.slice(0, 60) ?? ''}..."*`)
        : ['No patterns in registry'];

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle('🔒 Ban Registry')
          .addFields(
            { name: `👤 Users (${stats.users} total) — last 10`, value: userLines.join('\n'), inline: false },
            { name: `🔍 Patterns (${stats.patterns} total) — last 5`, value: patternLines.join('\n'), inline: false },
          )
          .setFooter({ text: 'Patterns auto-learn from bans. Use addpattern to seed manually.' })],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── adduser ───────────────────────────────────────────────────────────────
    else if (sub === 'adduser') {
      const userId = interaction.options.getString('userid', true);
      const reason = interaction.options.getString('reason', true);
      recordBan(userId, interaction.guildId!, reason, interaction.user.id);
      await interaction.reply({ content: `✅ User \`${userId}\` added to registry.`, flags: MessageFlags.Ephemeral });
    }

    // ── removeuser ────────────────────────────────────────────────────────────
    else if (sub === 'removeuser') {
      const userId = interaction.options.getString('userid', true);
      const removed = removeBan(userId);
      await interaction.reply({ content: removed ? `✅ Removed \`${userId}\` from registry.` : '❌ User not found.', flags: MessageFlags.Ephemeral });
    }

    // ── check ─────────────────────────────────────────────────────────────────
    else if (sub === 'check') {
      const userId = interaction.options.getString('userid', true);
      const entry = isUserBanned(userId);
      if (!entry) return interaction.reply({ content: `✅ \`${userId}\` is not in the registry.`, flags: MessageFlags.Ephemeral });

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle('⚠️ User Found in Registry')
          .addFields(
            { name: 'User ID',  value: entry.id,                                    inline: true },
            { name: 'Reason',   value: entry.reason,                                inline: false },
            { name: 'Banned',   value: new Date(entry.bannedAt).toUTCString(),      inline: true },
            { name: 'By',       value: entry.bannedBy === 'auto' ? 'Auto-ban' : `<@${entry.bannedBy}>`, inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── addpattern ────────────────────────────────────────────────────────────
    else if (sub === 'addpattern') {
      const text = interaction.options.getString('text', true);
      const reason = interaction.options.getString('reason', true);
      recordPattern(text, reason);
      await interaction.reply({ content: '✅ Pattern fingerprinted and added to registry.', flags: MessageFlags.Ephemeral });
    }

    // ── removepattern ─────────────────────────────────────────────────────────
    else if (sub === 'removepattern') {
      const fp = interaction.options.getString('fingerprint', true);
      const removed = removePattern(fp);
      await interaction.reply({ content: removed ? `✅ Pattern \`${fp}\` removed.` : '❌ Pattern not found.', flags: MessageFlags.Ephemeral });
    }

    // ── addword ───────────────────────────────────────────────────────────────
    else if (sub === 'addword') {
      const pattern = interaction.options.getString('pattern', true);
      const action  = interaction.options.getString('action', true) as WordPatternAction;
      const reason  = interaction.options.getString('reason', true);
      const wp = addWordPattern(pattern, action, reason, interaction.user.id);

      const actionLabel = { warn: '⚠️ Warn', delete: '🗑️ Delete', ban: '🔨 Ban' }[action];
      await interaction.reply({
        content: `✅ Word pattern added.\n\`${wp.id}\` — \`${pattern}\` → ${actionLabel} — *${reason}*`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── removeword ────────────────────────────────────────────────────────────
    else if (sub === 'removeword') {
      const id = interaction.options.getString('id', true);
      const removed = removeWordPattern(id);
      await interaction.reply({ content: removed ? `✅ Word pattern \`${id}\` removed.` : '❌ Pattern not found.', flags: MessageFlags.Ephemeral });
    }

    // ── words ─────────────────────────────────────────────────────────────────
    else if (sub === 'words') {
      const words = listWordPatterns();
      if (!words.length) return interaction.reply({ content: 'No word patterns configured.', flags: MessageFlags.Ephemeral });

      const ACTION_ICON = { warn: '⚠️', delete: '🗑️', ban: '🔨' };
      const lines = words.map(wp =>
        `${ACTION_ICON[wp.action]} \`${wp.id}\` — \`${wp.pattern}\` — *${wp.reason}*`
      );

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle(`🔤 Word Patterns (${words.length})`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Prefix "regex:" to use a regular expression' })],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
