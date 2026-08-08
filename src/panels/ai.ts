import { EmbedBuilder, Colors, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { navRow } from './shared';
import type { GuildEntry } from '../lib/settings-types';

export const AI_FEATURES = [
  { value: 'metadata',      label: 'Metadata extraction (reactions + /metadata)' },
  { value: 'ask',           label: 'AI chat (/ask)' },
  { value: 'describe',      label: 'Image description (/describe)' },
  { value: 'coder',         label: 'Coding help (/coder)' },
  { value: 'techsupport',   label: 'Tech support (/techsupport)' },
  { value: 'promptsupport', label: 'Prompt help (/promptsupport)' },
];

export function buildAiPanel(state: GuildEntry) {
  const t = state.toggles ?? {};

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('🤖 AI & Metadata')
    .setDescription(
      ['**AI & Metadata features**', ...AI_FEATURES.map(f => `${t[f.value] ? '✅' : '❌'} ${f.label}`)].join('\n')
    );

  const components = [
    navRow('ai', t.security ?? true),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('settings:tier:ai')
        .setPlaceholder('Enabled features (selected = on)')
        .setMinValues(0).setMaxValues(AI_FEATURES.length)
        .addOptions(AI_FEATURES.map(f => ({ label: f.label, value: f.value, default: !!t[f.value] }))),
    ),
  ];

  return { embeds: [embed], components };
}
