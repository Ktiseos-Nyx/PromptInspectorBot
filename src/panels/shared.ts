import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Page } from './index';

export interface Feature { value: string; label: string; }

export const TRUSTED_USERS_MAX = 25;
export const TRUSTED_ROLES_MAX = 10;

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

export function fmtChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : '*(not set)*';
}

export function fmtRoles(ids: string[] | null | undefined): string {
  return ids?.length ? ids.map(r => `<@&${r}>`).join(' ') : '*(none)*';
}

export function fmtChannels(ids: string[] | null | undefined): string {
  return ids?.length ? ids.map(c => `<#${c}>`).join(' ') : '*(all)*';
}

export function fmtUsers(ids: string[] | null | undefined): string {
  return ids?.length ? ids.map(u => `<@${u}>`).join(' ') : '*(none)*';
}

export function navRow(active: Page, securityOn: boolean): ActionRowBuilder<ButtonBuilder> {
  const mk = (page: Page, label: string) =>
    new ButtonBuilder()
      .setCustomId(`settings:nav:${page}`)
      .setLabel(label)
      .setStyle(page === active ? ButtonStyle.Primary : ButtonStyle.Secondary);
      
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk('moderation', 'Moderation'), 
    mk('ai', 'AI & Metadata'), 
    mk('fun', 'Fun'), 
    mk('trust', 'Trust'),
    new ButtonBuilder()
      .setCustomId('settings:toggle:security')
      .setLabel(`Anti-scam: ${securityOn ? 'ON' : 'OFF'}`)
      .setStyle(securityOn ? ButtonStyle.Success : ButtonStyle.Danger),
  );
}
