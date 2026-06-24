import {
  EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  UserSelectMenuBuilder, ChannelType,
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

export type Page = 'moderation' | 'trust' | 'ai' | 'fun';

// Trust-list caps. Shared with /security so the command can't grow a list past
// what the panel can render — Discord requires a select's default_values count to
// be <= its max_values, so an oversized list would otherwise break the Trust page.
export const TRUSTED_USERS_MAX = 25;
export const TRUSTED_ROLES_MAX = 10;

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

function navRow(active: Page, securityOn: boolean): ActionRowBuilder<ButtonBuilder> {
  const mk = (page: Page, label: string) =>
    new ButtonBuilder()
      .setCustomId(`settings:nav:${page}`)
      .setLabel(label)
      .setStyle(page === active ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk('moderation', 'Moderation'), mk('ai', 'AI & Metadata'), mk('fun', 'Fun'), mk('trust', 'Trust'),
    new ButtonBuilder()
      .setCustomId('settings:toggle:security')
      .setLabel(`Anti-scam: ${securityOn ? 'ON' : 'OFF'}`)
      .setStyle(securityOn ? ButtonStyle.Success : ButtonStyle.Danger),
  );
}

function fmtChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : '*(not set)*';
}

function fmtRoles(ids: string[] | null | undefined): string {
  return ids?.length ? ids.map(r => `<@&${r}>`).join(' ') : '*(none)*';
}

function fmtChannels(ids: string[] | null | undefined): string {
  return ids?.length ? ids.map(c => `<#${c}>`).join(' ') : '*(all)*';
}

function fmtUsers(ids: string[] | null | undefined): string {
  return ids?.length ? ids.map(u => `<@${u}>`).join(' ') : '*(none)*';
}

export function buildSettingsPanel(state: GuildEntry, page: Page) {
  const t = state.toggles ?? {};
  const m = state.moderation ?? {};

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('⚙️ Server settings');

  const securityOn = t.security ?? true;
  const components: ActionRowBuilder<any>[] = [navRow(page, securityOn)];

  if (page === 'moderation') {
    const lines: string[] = [];
    lines.push(`${on(securityOn)} **Anti-scam protection**`);
    if (securityOn) {
      lines.push(`┣ Alert channel: ${fmtChannel(m.alertChannelId)}`);
      lines.push(`┣ Monitored channels: ${fmtChannels(m.monitoredChannelIds)}`);
      lines.push(`┗ Catcher role: ${fmtRoles(m.catcherRoleId ? [m.catcherRoleId] : [])}`);
      lines.push('*Trusted roles & bots are on the **Trust** page.*');
    }
    embed.setDescription(lines.join('\n'));

    components.push(
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:alertChannel')
          .setPlaceholder('Alert channel')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(0).setMaxValues(1),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:monitoredChannels')
          .setPlaceholder('Monitored channels (none = all)')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(0).setMaxValues(25),
      ),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('settings:catcherRole')
          .setPlaceholder('Catcher role — extra scam weight')
          .setMinValues(0).setMaxValues(1),
      ),
    );
  } else if (page === 'trust') {
    embed.setDescription([
      '**Trusted — skipped entirely by anti-scam**',
      `┣ Trusted roles: ${fmtRoles(m.trustedRoleIds)}`,
      `┗ Trusted users / bots: ${fmtUsers(m.trustedUserIds)}`,
      '*Add admin/mod bots (e.g. Carlbot) here so their log embeds are never flagged.*',
    ].join('\n'));

    // Prefill current selections so editing the picker adds/removes from the existing
    // list rather than replacing it — otherwise an admin could silently wipe trusted
    // bots, re-exposing them to the anti-scam pipeline.
    components.push(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('settings:trustedRoles')
          .setPlaceholder('Trusted roles')
          .setMinValues(0).setMaxValues(TRUSTED_ROLES_MAX)
          .setDefaultRoles(...(m.trustedRoleIds ?? []).slice(0, TRUSTED_ROLES_MAX)),
      ),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('settings:trustedUsers')
          .setPlaceholder('Trusted users / bots (e.g. Carlbot)')
          .setMinValues(0).setMaxValues(TRUSTED_USERS_MAX)
          .setDefaultUsers(...(m.trustedUserIds ?? []).slice(0, TRUSTED_USERS_MAX)),
      ),
    );
  } else if (page === 'ai') {
    embed.setDescription(
      ['**AI & Metadata features**', ...AI_FEATURES.map(f => `${on(t[f.value])} ${f.label}`)].join('\n'),
    );
    const tier = AI_FEATURES;
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('settings:tier:ai')
          .setPlaceholder('Enabled features (selected = on)')
          .setMinValues(0).setMaxValues(tier.length)
          .addOptions(tier.map(f => ({ label: f.label, value: f.value, default: !!t[f.value] }))),
      ),
    );
  } else {
    embed.setDescription(
      ['**Fun features**', ...FUN_FEATURES.map(f => `${on(t[f.value])} ${f.label}`)].join('\n'),
    );
    const tier = FUN_FEATURES;
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('settings:tier:fun')
          .setPlaceholder('Enabled features (selected = on)')
          .setMinValues(0).setMaxValues(tier.length)
          .addOptions(tier.map(f => ({ label: f.label, value: f.value, default: !!t[f.value] }))),
      ),
    );
  }

  return { embeds: [embed], components };
}
