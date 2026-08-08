import { EmbedBuilder, Colors, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { navRow } from './shared';
import type { GuildEntry } from '../lib/settings-types';

export const FUN_FEATURES = [
  { value: 'fun_commands', label: 'Fun commands (/decide, /poll, /wildcard, /goodnight)' },
  { value: 'interact',     label: 'User interactions (/interact)' },
  { value: 'qotd',         label: 'Question of the day' },
];

export function buildFunPanel(state: GuildEntry) {
  const t = state.toggles ?? {};
  
  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('⚙️ Fun Features')
    .setDescription(
      ['**Fun features**', ...FUN_FEATURES.map(f => `${t[f.value] ? '✅' : '❌'} ${f.label}`)].join('\n')
    );

  const components = [
    navRow('fun', t.security ?? true),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('settings:tier:fun')
        .setPlaceholder('Enabled features (selected = on)')
        .setMinValues(0).setMaxValues(FUN_FEATURES.length)
        .addOptions(FUN_FEATURES.map(f => ({ label: f.label, value: f.value, default: !!t[f.value] }))),
    ),
  ];

  return { embeds: [embed], components };
}
