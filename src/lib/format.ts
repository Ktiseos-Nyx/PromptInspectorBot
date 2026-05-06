import { EmbedBuilder } from 'discord.js';

const TOOL_COLORS: Record<string, number> = {
  'AUTOMATIC1111': 0x5865F2,
  'Forge':         0xEB459E,
  'Forge Neo':     0xFEE75C,
  'ComfyUI':       0x57F287,
  'NovelAI':       0xED4245,
  'SwarmUI':       0x3BA55D,
  'InvokeAI':      0x9C84EF,
  'Midjourney':    0x000000,
  'Draw Things':   0xFF7043,
};

export function formatMetadataEmbed(
  result: Record<string, any>,
  fileName: string,
  index: number,
  total: number,
): EmbedBuilder {
  const ai = result.ai ?? {};
  const tool = ai.workflow_type ?? 'Unknown';
  const color = TOOL_COLORS[tool] ?? 0x99AAB5;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🔎 ${tool} — Image ${index}/${total}`)
    .setFooter({ text: fileName });

  if (ai.prompt) {
    embed.addFields({ name: 'Prompt', value: truncate(ai.prompt, 1024) });
  }
  if (ai.negative_prompt) {
    embed.addFields({ name: 'Negative', value: truncate(ai.negative_prompt, 1024) });
  }

  const params: string[] = [];
  if (ai.model)     params.push(`**Model:** ${ai.model}`);
  if (ai.steps)     params.push(`**Steps:** ${ai.steps}`);
  if (ai.cfg_scale) params.push(`**CFG:** ${ai.cfg_scale}`);
  if (ai.sampler)   params.push(`**Sampler:** ${ai.sampler}`);
  if (ai.scheduler) params.push(`**Scheduler:** ${ai.scheduler}`);
  if (ai.seed)      params.push(`**Seed:** ${ai.seed}`);
  if (ai.size)      params.push(`**Size:** ${ai.size}`);
  if (ai.version)   params.push(`**Version:** ${ai.version}`);
  if (ai.loras?.length) params.push(`**LoRAs:** ${ai.loras.join(', ')}`);

  if (params.length > 0) {
    embed.addFields({ name: 'Parameters', value: params.join('\n') });
  }

  return embed;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
