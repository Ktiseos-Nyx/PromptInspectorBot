import {
  EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelType,
} from 'discord.js';
import type { GuildEntry } from './settings-types';

export interface Feature { value: string; label: string; }

export const AI_FEATURES: Feature[] = [
  { value: 'metadata',      label: 'Metadata extraction (reactions + /metadata)' },
  { value: 'ask',           label: 'AI chat (/ask)' },
  { value: 'describe',      label: 'Image description (/describe)' },
  { value: 'coder',         label: 'Coding help (/coder)' },
  { value: 'techsupport',   label: 'Tech support (/techsupport)' },
  { value: 'promptsupport', label: 'Prompt help (/promptsupport)' },
];

export const FUN_FEATURES: Feature[] = [
  { value: 'fun_commands', label: 'Fun commands (/decide, /poll, /wildcard, /goodnight)' },
  { value: 'interact',     label: 'User interactions (/interact)' },
  { value: 'qotd',         label: 'Question of the day' },
];

export type Page = 'moderation' | 'ai' | 'fun' | 'advanced';

// State-transition: selected tier features → true, the rest of that tier → false.
export function applyToggleSelection(
  current: Record<string, boolean>,
  tier: Feature[],
  selected: string[],
): Record<string, boolean> {
  const next = { ...current };
  const chosen = new Set(selected);
  for (const f of tier) next[f.value] = chosen.has(f.value);
  return next;
}

function on(v: boolean | undefined): string { return v ? '✅' : '❌'; }

function navRow(active: Page): ActionRowBuilder<ButtonBuilder> {
  const mk = (page: Page, label: string) =>
    new ButtonBuilder()
      .setCustomId(`settings:nav:${page}`)
      .setLabel(label)
      .setStyle(page === active ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk('moderation', 'Moderation'), mk('ai', 'AI & Metadata'), mk('fun', 'Fun'), mk('advanced', 'Advanced'),
  );
}

export function buildSettingsPanel(state: GuildEntry, page: Page) {
  const t = state.toggles ?? {};
  const m = state.moderation ?? {};

  const summary = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('⚙️ Server settings')
    .addFields(
      {
        name: 'Moderation',
        value: [
          `${on(t.security ?? true)} Anti-scam protection`,
          `Alert channel: ${m.alertChannelId ? `<#${m.alertChannelId}>` : '*(default)*'}`,
          `Trusted roles: ${m.trustedRoleIds?.length ? m.trustedRoleIds.map(r => `<@&${r}>`).join(' ') : '*(none)*'}`,
          `Monitored channels: ${m.monitoredChannelIds?.length ? m.monitoredChannelIds.map(c => `<#${c}>`).join(' ') : '*(all)*'}`,
          `Catcher role: ${m.catcherRoleId ? `<@&${m.catcherRoleId}>` : '*(none)*'}`,
        ].join('\n'),
      },
      { name: 'AI & Metadata', value: AI_FEATURES.map(f => `${on(t[f.value])} ${f.label}`).join('\n') },
      { name: 'Fun', value: FUN_FEATURES.map(f => `${on(t[f.value])} ${f.label}`).join('\n') },
    );

  const components: ActionRowBuilder<any>[] = [navRow(page)];

  if (page === 'moderation') {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('settings:toggle:security')
          .setLabel(`Anti-scam: ${t.security ?? true ? 'ON' : 'OFF'}`)
          .setStyle(t.security ?? true ? ButtonStyle.Success : ButtonStyle.Danger),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:alertChannel')
          .setPlaceholder('Alert channel')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(0).setMaxValues(1),
      ),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('settings:trustedRoles')
          .setPlaceholder('Trusted roles')
          .setMinValues(0).setMaxValues(10),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:monitoredChannels')
          .setPlaceholder('Monitored channels (none = all)')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(0).setMaxValues(25),
      ),
    );
  } else if (page === 'advanced') {
    components.push(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('settings:catcherRole')
          .setPlaceholder("Catcher role — extra scam weight when it's a user's only role")
          .setMinValues(0).setMaxValues(1),
      ),
    );
  } else {
    const tier = page === 'ai' ? AI_FEATURES : FUN_FEATURES;
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`settings:tier:${page}`)
          .setPlaceholder('Enabled features (selected = on)')
          .setMinValues(0).setMaxValues(tier.length)
          .addOptions(tier.map(f => ({ label: f.label, value: f.value, default: !!t[f.value] }))),
      ),
    );
  }

  return { embeds: [summary], components };
}
