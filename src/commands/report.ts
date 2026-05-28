import {
  ChatInputCommandInteraction, Colors, EmbedBuilder,
  GuildMember, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from 'discord.js';
import {
  addReport, clearReports, getReports, hasRecentReport, uniqueReporterCount,
  AUTO_TIMEOUT_MS, REPORT_THRESHOLD, REPORT_WINDOW_MS,
} from '../lib/report-system';
import { ADMIN_CHANNEL_IDS } from '../lib/config';

const REASONS = [
  { name: 'Harassment / Bullying',    value: 'harassment' },
  { name: 'Spam',                      value: 'spam' },
  { name: 'Scam / Phishing',          value: 'scam' },
  { name: 'Inappropriate content',     value: 'inappropriate' },
  { name: 'Impersonation',             value: 'impersonation' },
  { name: 'Other',                     value: 'other' },
];

function isMod(member: GuildMember | null): boolean {
  return !!member?.permissions.has(PermissionFlagsBits.ManageGuild);
}

async function notifyAdmins(
  interaction: ChatInputCommandInteraction,
  reportedMember: GuildMember,
  reason: string,
  details: string,
  messageLink: string | null,
  totalReports: number,
  autoTimedOut: boolean,
): Promise<void> {
  if (!ADMIN_CHANNEL_IDS.size || !interaction.guild) return;

  const reporterTag = interaction.user.tag;
  const reportedTag = reportedMember.user.tag;
  const label = REASONS.find(r => r.value === reason)?.name ?? reason;

  const embed = new EmbedBuilder()
    .setColor(autoTimedOut ? Colors.Orange : Colors.Yellow)
    .setTitle(autoTimedOut ? '⚠️ User Auto-Timed Out (Reports)' : '📋 New User Report')
    .setThumbnail(reportedMember.user.displayAvatarURL())
    .addFields(
      { name: 'Reported User',  value: `${reportedTag} (<@${reportedMember.id}>)`, inline: true },
      { name: 'Reporter',       value: `${reporterTag} (<@${interaction.user.id}>)`,  inline: true },
      { name: 'Reason',         value: label,                                          inline: true },
      { name: 'Total Reports',  value: String(totalReports),                           inline: true },
      { name: 'Channel',        value: `<#${interaction.channelId}>`,                  inline: true },
    )
    .setTimestamp();

  if (details) embed.addFields({ name: 'Details', value: details });
  if (messageLink) embed.addFields({ name: 'Message Link', value: messageLink });
  if (autoTimedOut) {
    embed.addFields({ name: 'Action Taken', value: `Auto-timed out for 1 hour pending mod review` });
    embed.setFooter({ text: `Threshold: ${REPORT_THRESHOLD} unique reporters in 7 days` });
  }

  for (const channelId of ADMIN_CHANNEL_IDS) {
    const ch = interaction.guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (ch) await ch.send({ embeds: [embed] }).catch(() => null);
  }
}

export const reportCommand = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a user or manage reports (mods only for list/clear/history)')
    .addSubcommand(s =>
      s.setName('file')
        .setDescription('Report a user to the moderation team')
        .addUserOption(o => o.setName('user').setDescription('User to report').setRequired(true))
        .addStringOption(o =>
          o.setName('reason').setDescription('Reason for the report').setRequired(true)
            .addChoices(...REASONS)
        )
        .addStringOption(o => o.setName('details').setDescription('Additional details (optional)'))
        .addStringOption(o => o.setName('message_link').setDescription('Link to the offending message (optional)'))
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List recent reports in this server (mod only)')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1))
    )
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription('Clear all reports for a user (mod only)')
        .addUserOption(o => o.setName('user').setDescription('User to clear reports for').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('history')
        .setDescription('Show report history for a user (mod only)')
        .addUserOption(o => o.setName('user').setDescription('User to look up').setRequired(true))
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ This command only works in a server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const member = interaction.member as GuildMember | null;

    // ── /report file ─────────────────────────────────────────────────────────
    if (sub === 'file') {
      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const details = interaction.options.getString('details') ?? '';
      const messageLink = interaction.options.getString('message_link') ?? null;

      if (target.id === interaction.user.id) {
        return interaction.reply({ content: "❌ You can't report yourself.", ephemeral: true });
      }
      if (target.bot) {
        return interaction.reply({ content: "❌ You can't report a bot.", ephemeral: true });
      }

      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (targetMember && isMod(targetMember)) {
        return interaction.reply({
          content: "❌ You can't report a moderator through this command. Contact a server admin directly.",
          ephemeral: true,
        });
      }

      // Rate-limit: one report per target per 24h per reporter
      if (hasRecentReport(interaction.guildId!, interaction.user.id, target.id)) {
        return interaction.reply({
          content: '❌ You already filed a report against this user in the last 24 hours.',
          ephemeral: true,
        });
      }

      addReport({
        guildId: interaction.guildId!,
        reporterId: interaction.user.id,
        reportedId: target.id,
        reason,
        details,
        timestamp: Date.now(),
        messageLink: messageLink ?? undefined,
      });

      const reportCount = uniqueReporterCount(interaction.guildId!, target.id);
      let autoTimedOut = false;

      // Auto-timeout when threshold is reached
      if (reportCount >= REPORT_THRESHOLD && targetMember) {
        try {
          const alreadyTimedOut = targetMember.communicationDisabledUntilTimestamp
            && targetMember.communicationDisabledUntilTimestamp > Date.now();
          if (!alreadyTimedOut) {
            await targetMember.timeout(
              AUTO_TIMEOUT_MS,
              `Auto-timeout: ${reportCount} unique user reports within 7 days`
            );
            autoTimedOut = true;
          }
        } catch { /* bot may lack permission — notify admins regardless */ }
      }

      // Notify admin channel on every report
      if (targetMember) {
        await notifyAdmins(interaction, targetMember, reason, details, messageLink, reportCount, autoTimedOut);
      }

      const label = REASONS.find(r => r.value === reason)?.name ?? reason;
      const replyLines = [
        `✅ Report filed against **${target.tag}** for **${label}**.`,
        `The moderation team has been notified.`,
      ];
      if (autoTimedOut) {
        replyLines.push(`⚠️ This user has been automatically timed out for 1 hour pending mod review.`);
      }

      return interaction.reply({ content: replyLines.join('\n'), ephemeral: true });
    }

    // All subcommands below are mod-only
    if (!isMod(member)) {
      return interaction.reply({ content: '❌ Requires Manage Server permission.', ephemeral: true });
    }

    // ── /report list ─────────────────────────────────────────────────────────
    if (sub === 'list') {
      const page = (interaction.options.getInteger('page') ?? 1) - 1;
      const PAGE_SIZE = 10;
      const all = getReports(interaction.guildId!).sort((a, b) => b.timestamp - a.timestamp);

      if (all.length === 0) {
        return interaction.reply({ content: '📋 No reports on record for this server.', ephemeral: true });
      }

      const slice = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const totalPages = Math.ceil(all.length / PAGE_SIZE);

      const lines = slice.map(r => {
        const label = REASONS.find(x => x.value === r.reason)?.name ?? r.reason;
        const date = new Date(r.timestamp).toLocaleDateString();
        return `• <@${r.reportedId}> — **${label}** by <@${r.reporterId}> on ${date}${r.details ? `: *${r.details.slice(0, 60)}*` : ''}`;
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle(`📋 Reports — Page ${page + 1}/${totalPages} (${all.length} total)`)
        .setDescription(lines.join('\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── /report clear ────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const target = interaction.options.getUser('user', true);
      const removed = clearReports(interaction.guildId!, target.id);
      return interaction.reply({
        content: removed > 0
          ? `✅ Cleared **${removed}** report(s) for **${target.tag}**.`
          : `ℹ️ No reports found for **${target.tag}**.`,
        ephemeral: true,
      });
    }

    // ── /report history ──────────────────────────────────────────────────────
    if (sub === 'history') {
      const target = interaction.options.getUser('user', true);
      const reports = getReports(interaction.guildId!, target.id).sort((a, b) => b.timestamp - a.timestamp);

      if (reports.length === 0) {
        return interaction.reply({ content: `ℹ️ No reports found for **${target.tag}**.`, ephemeral: true });
      }

      const windowCount = uniqueReporterCount(interaction.guildId!, target.id);
      const lines = reports.slice(0, 15).map(r => {
        const label = REASONS.find(x => x.value === r.reason)?.name ?? r.reason;
        const date = new Date(r.timestamp).toLocaleDateString();
        const detail = r.details ? ` — *${r.details.slice(0, 80)}*` : '';
        const link = r.messageLink ? ` ([jump](${r.messageLink}))` : '';
        return `• **${label}** by <@${r.reporterId}> on ${date}${detail}${link}`;
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle(`📋 Report History — ${target.tag}`)
        .setDescription(lines.join('\n'))
        .setThumbnail(target.displayAvatarURL())
        .addFields({
          name: 'Unique reporters (last 7 days)',
          value: `${windowCount} / ${REPORT_THRESHOLD} (threshold for auto-timeout)`,
          inline: true,
        })
        .setFooter({ text: `${reports.length} total report(s) on record` });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
