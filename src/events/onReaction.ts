import { Events, type Client } from 'discord.js';
import { getFromCache } from '../lib/cache';
import { formatMetadataEmbed } from '../lib/format';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

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
      const lines = images.map((img, i) => `**${i + 1}.** ${img.name}`).join('\n');
      await reaction.message.reply({ content: `📦 **Batch metadata (${images.length} images)**\n${lines}`, allowedMentions: { repliedUser: false } });
      return;
    }

    const index = NUMBER_EMOJIS.indexOf(emoji);
    if (index >= images.length) return;

    const img = images[index];
    const embed = formatMetadataEmbed(img.meta, img.name, index + 1, images.length);
    await reaction.message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
  });
}
