import { ApplicationCommandType, ContextMenuCommandBuilder, MessageContextMenuCommandInteraction } from 'discord.js';
import { extractMetadataFromBuffer } from '../lib/metadata';
import { formatMetadataEmbed } from '../lib/format';
import { SCAN_LIMIT_BYTES } from '../lib/config';

export const viewPromptCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('View Prompt')
    .setType(ApplicationCommandType.Message),

  async execute(interaction: MessageContextMenuCommandInteraction) {
    const message = interaction.targetMessage;

    const pngAttachments = [...message.attachments.values()].filter(
      a => a.name.toLowerCase().endsWith('.png') && a.size < SCAN_LIMIT_BYTES
    );

    if (!pngAttachments.length) {
      return interaction.reply({ content: '❌ No PNG images found in that message.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const embeds = [];
      for (let i = 0; i < Math.min(pngAttachments.length, 5); i++) {
        const att = pngAttachments[i];
        const res = await fetch(att.url);
        const buf = Buffer.from(await res.arrayBuffer());
        const result = await extractMetadataFromBuffer(buf, 'image/png', att.name, att.size, new Date().toISOString());

        if (result.ai && Object.keys(result.ai).length > 0) {
          embeds.push(formatMetadataEmbed(result, att.name, i + 1, pngAttachments.length));
        }
      }

      if (!embeds.length) {
        return interaction.followUp({ content: '❌ No metadata found in the images.', ephemeral: true });
      }

      await interaction.followUp({ embeds, ephemeral: true });
    } catch (e) {
      await interaction.followUp({ content: `❌ Error parsing metadata: ${e}`, ephemeral: true });
    }
  },
};
