import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { extractMetadataFromBuffer } from '../lib/metadata';
import { formatMetadataEmbed } from '../lib/format';
import { rateLimiter, SCAN_LIMIT_BYTES, DM_ALLOWED_USER_IDS } from '../lib/config';
import { getGuildSetting } from '../lib/guild-settings';

export const metadataCommand = {
  data: new SlashCommandBuilder()
    .setName('metadata')
    .setDescription('Parse metadata from an image')
    .addAttachmentOption(o =>
      o.setName('image').setDescription('Image to inspect').setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // DM check
    if (!interaction.guild && !DM_ALLOWED_USER_IDS.has(interaction.user.id)) {
      return interaction.reply({ content: '❌ This command can only be used in servers.', ephemeral: true });
    }

    if (interaction.guild && !getGuildSetting(interaction.guildId!, 'metadata', true)) {
      return interaction.reply({ content: '❌ Metadata extraction is not enabled in this server.', ephemeral: true });
    }

    if (rateLimiter.isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏰ Too many requests — please wait a moment.', ephemeral: true });
    }

    const image = interaction.options.getAttachment('image', true);

    if (image.size > SCAN_LIMIT_BYTES) {
      const mb = (image.size / 1024 / 1024).toFixed(1);
      return interaction.reply({ content: `❌ File too large (${mb}MB, max ${SCAN_LIMIT_BYTES / 1024 / 1024}MB).`, ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const res = await fetch(image.url);
      const buf = Buffer.from(await res.arrayBuffer());
      const mimeType = image.contentType ?? 'image/png';
      const result = await extractMetadataFromBuffer(buf, mimeType, image.name, image.size, new Date().toISOString());

      if (!result.ai || Object.keys(result.ai).length === 0) {
        return interaction.followUp('❌ No metadata found in this image.');
      }

      const embed = formatMetadataEmbed(result, image.name, 1, 1);
      await interaction.followUp({ embeds: [embed] });
    } catch (e) {
      await interaction.followUp(`❌ Error parsing metadata: ${e}`);
    }
  },
};
