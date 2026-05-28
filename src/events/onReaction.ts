import { AttachmentBuilder, Events, TextChannel, type Client } from 'discord.js';
import { getFromCache } from '../lib/cache';
import { formatMetadataEmbed } from '../lib/format';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

function workflowAttachment(meta: Record<string, any>, imageName: string): AttachmentBuilder | null {
  const wf = meta.ai?.comfyui_workflow;
  if (!wf) return null;
  const json = JSON.stringify(wf, null, 2);
  const name = imageName.replace(/\.png$/i, '_workflow.json');
  return new AttachmentBuilder(Buffer.from(json, 'utf8'), { name });
}

export function registerReactionEvents(client: Client): void {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;

    const emoji = reaction.emoji.name ?? '';
    const isNumbered = NUMBER_EMOJIS.includes(emoji);
    const isBatch = emoji === '📦';
    if (!isNumbered && !isBatch) return;

    const images = getFromCache(reaction.message.id);
    if (!images) return;

    if (isBatch) {
      const embeds = images.map((img, i) => formatMetadataEmbed(img.meta, img.name, i + 1, images.length));
      const workflows = images
        .map(img => workflowAttachment(img.meta, img.name))
        .filter((a): a is AttachmentBuilder => a !== null);

      // Discord allows max 10 embeds and 10 files per message
      const first = embeds.slice(0, 10);
      const firstFiles = workflows.slice(0, 10);
      await reaction.message.reply({ embeds: first, files: firstFiles, allowedMentions: { repliedUser: false } });

      const channel = reaction.message.channel as TextChannel;
      for (let i = 10; i < Math.max(embeds.length, workflows.length); i += 10) {
        const batchEmbeds = embeds.slice(i, i + 10);
        const batchFiles = workflows.slice(i, i + 10);
        await channel.send({
          ...(batchEmbeds.length ? { embeds: batchEmbeds } : {}),
          ...(batchFiles.length ? { files: batchFiles } : {}),
        });
      }
      return;
    }

    const index = NUMBER_EMOJIS.indexOf(emoji);
    if (index >= images.length) return;

    const img = images[index];
    const embed = formatMetadataEmbed(img.meta, img.name, index + 1, images.length);
    const attachment = workflowAttachment(img.meta, img.name);
    await reaction.message.reply({
      embeds: [embed],
      ...(attachment ? { files: [attachment] } : {}),
      allowedMentions: { repliedUser: false },
    });
  });
}
