import { describe, it, expect } from 'vitest';
import { buildSettingsPanel, type Page } from '../panels/index';
import { applyToggleSelection, TRUSTED_USERS_MAX, TRUSTED_ROLES_MAX, navRow, fmtChannel, fmtRoles, fmtChannels, fmtUsers } from '../panels/shared';
import { AI_FEATURES } from '../panels/ai';
import { FUN_FEATURES } from '../panels/fun';

describe('feature tiers', () => {
  it('keeps metadata in the AI tier and not in Fun', () => {
    expect(AI_FEATURES.map(f => f.value)).toContain('metadata');
    expect(FUN_FEATURES.map(f => f.value)).not.toContain('metadata');
  });
  it('keeps fun_commands/interact/qotd in the Fun tier', () => {
    const fun = FUN_FEATURES.map(f => f.value);
    expect(fun).toEqual(expect.arrayContaining(['fun_commands', 'interact', 'qotd']));
  });
});

describe('applyToggleSelection', () => {
  it('sets selected features true and unselected tier features false', () => {
    const current = { metadata: true, ask: true, describe: false };
    const next = applyToggleSelection(current, AI_FEATURES, ['describe']);
    expect(next.describe).toBe(true);
    expect(next.metadata).toBe(false);
    expect(next.ask).toBe(false);
  });
  it('does not touch features outside the tier', () => {
    const current = { fun_commands: true, ask: true };
    const next = applyToggleSelection(current, AI_FEATURES, []);
    expect(next.fun_commands).toBe(true);
  });
});

describe('formatting helpers', () => {
  it('fmtChannel returns mention with set id', () => {
    expect(fmtChannel('c123')).toBe('<#c123>');
  });
  it('fmtChannel returns placeholder for undefined/null', () => {
    expect(fmtChannel(undefined)).toBe('*(not set)*');
    expect(fmtChannel(null)).toBe('*(not set)*');
  });
  it('fmtRoles returns mentions for IDs', () => {
    expect(fmtRoles(['r1', 'r2'])).toBe('<@&r1> <@&r2>');
  });
  it('fmtRoles returns placeholder for empty/undefined/null', () => {
    expect(fmtRoles([])).toBe('*(none)*');
    expect(fmtRoles(undefined)).toBe('*(none)*');
    expect(fmtRoles(null)).toBe('*(none)*');
  });
  it('fmtChannels returns mentions for IDs', () => {
    expect(fmtChannels(['c1', 'c2'])).toBe('<#c1> <#c2>');
  });
  it('fmtChannels returns placeholder for empty/undefined/null', () => {
    expect(fmtChannels([])).toBe('*(all)*');
    expect(fmtChannels(undefined)).toBe('*(all)*');
    expect(fmtChannels(null)).toBe('*(all)*');
  });
  it('fmtUsers returns mentions for IDs', () => {
    expect(fmtUsers(['u1', 'u2'])).toBe('<@u1> <@u2>');
  });
  it('fmtUsers returns placeholder for empty/undefined/null', () => {
    expect(fmtUsers([])).toBe('*(none)*');
    expect(fmtUsers(undefined)).toBe('*(none)*');
    expect(fmtUsers(null)).toBe('*(none)*');
  });
});

describe('navRow', () => {
  it('exposes four pages plus the anti-scam toggle', () => {
    const nav = navRow('moderation', true).toJSON() as any;
    const ids = nav.components.map((c: any) => c.custom_id);
    expect(ids).toEqual([
      'settings:nav:moderation', 'settings:nav:ai', 'settings:nav:fun', 'settings:nav:trust', 'settings:toggle:security',
    ]);
  });
  it('sets active page button to primary style', () => {
    const nav = navRow('ai', true).toJSON() as any;
    const aiBtn = nav.components.find((c: any) => c.custom_id === 'settings:nav:ai');
    expect(aiBtn.style).toBe(1); // ButtonStyle.Primary
  });
  it('sets inactive page button to secondary style', () => {
    const nav = navRow('ai', true).toJSON() as any;
    const modBtn = nav.components.find((c: any) => c.custom_id === 'settings:nav:moderation');
    expect(modBtn.style).toBe(2); // ButtonStyle.Secondary
  });
  it('shows anti-scam ON with success style when enabled', () => {
    const nav = navRow('moderation', true).toJSON() as any;
    const secBtn = nav.components.find((c: any) => c.custom_id === 'settings:toggle:security');
    expect(secBtn.label).toBe('Anti-scam: ON');
    expect(secBtn.style).toBe(3); // ButtonStyle.Success
  });
  it('shows anti-scam OFF with danger style when disabled', () => {
    const nav = navRow('moderation', false).toJSON() as any;
    const secBtn = nav.components.find((c: any) => c.custom_id === 'settings:toggle:security');
    expect(secBtn.label).toBe('Anti-scam: OFF');
    expect(secBtn.style).toBe(4); // ButtonStyle.Danger
  });
});

describe('buildSettingsPanel', () => {
  const state = {
    toggles: { security: true, metadata: true, ask: false, fun_commands: true },
    moderation: { alertChannelId: 'chan-1', trustedRoleIds: ['r1'], monitoredChannelIds: [] },
  };
  it('always returns a summary embed and a nav row', () => {
    const p = buildSettingsPanel(state as any, 'moderation');
    expect(p.embeds.length).toBe(1);
    expect(p.components.length).toBeGreaterThanOrEqual(1);
  });
  it('moderation page stays within Discord 5-row limit', () => {
    const p = buildSettingsPanel(state as any, 'moderation');
    expect(p.components.length).toBeLessThanOrEqual(5);
  });
  it('ai page stays within the 5-row limit', () => {
    const p = buildSettingsPanel(state as any, 'ai');
    expect(p.components.length).toBeLessThanOrEqual(5);
  });
  it('fun page stays within the 5-row limit', () => {
    const p = buildSettingsPanel(state as any, 'fun');
    expect(p.components.length).toBeLessThanOrEqual(5);
  });
  it('nav row exposes four pages plus the anti-scam toggle', () => {
    const p = buildSettingsPanel(state as any, 'moderation');
    const nav = (p.components[0] as any).toJSON();
    const ids = nav.components.map((c: any) => c.custom_id);
    expect(ids).toEqual([
      'settings:nav:moderation', 'settings:nav:ai', 'settings:nav:fun', 'settings:nav:trust', 'settings:toggle:security',
    ]);
  });
  it('trust page exposes trusted-roles and trusted-users selects within the 5-row limit', () => {
    const p = buildSettingsPanel(state as any, 'trust');
    expect(p.components.length).toBeLessThanOrEqual(5);
    const ids = p.components.flatMap(r => (r as any).toJSON().components.map((c: any) => c.custom_id));
    expect(ids).toContain('settings:trustedRoles');
    expect(ids).toContain('settings:trustedUsers');
  });
  it('trust page selects cap at the shared trust limits', () => {
    const comps = buildSettingsPanel(state as any, 'trust').components.flatMap(r => (r as any).toJSON().components);
    const roleSel = comps.find((c: any) => c.custom_id === 'settings:trustedRoles');
    const userSel = comps.find((c: any) => c.custom_id === 'settings:trustedUsers');
    expect(userSel.max_values).toBe(TRUSTED_USERS_MAX);
    expect(roleSel.max_values).toBe(TRUSTED_ROLES_MAX);
  });
  it('trust page caps prefilled defaults at the limit so an oversized list cannot break the render', () => {
    const big = Array.from({ length: TRUSTED_USERS_MAX + 5 }, (_, i) => `u${i}`);
    const s = { toggles: { security: true }, moderation: { trustedUserIds: big } };
    const comps = buildSettingsPanel(s as any, 'trust').components.flatMap(r => (r as any).toJSON().components);
    const userSel = comps.find((c: any) => c.custom_id === 'settings:trustedUsers');
    expect(userSel.default_values.length).toBeLessThanOrEqual(TRUSTED_USERS_MAX);
  });
  it('trust page prefills current trusted roles and users so panel edits do not clobber them', () => {
    const s = { toggles: { security: true }, moderation: { trustedRoleIds: ['r1'], trustedUserIds: ['bot1'] } };
    const comps = buildSettingsPanel(s as any, 'trust').components.flatMap(r => (r as any).toJSON().components);
    const roleSel = comps.find((c: any) => c.custom_id === 'settings:trustedRoles');
    const userSel = comps.find((c: any) => c.custom_id === 'settings:trustedUsers');
    expect(roleSel.default_values.map((d: any) => d.id)).toContain('r1');
    expect(userSel.default_values.map((d: any) => d.id)).toContain('bot1');
  });
  it('moderation page exposes catcher-role select alongside other controls', () => {
    const p = buildSettingsPanel(state as any, 'moderation');
    expect(p.components.length).toBeLessThanOrEqual(5);
    const ids = p.components.flatMap(r => (r as any).toJSON().components.map((c: any) => c.custom_id));
    expect(ids).toContain('settings:catcherRole');
  });
  it('ai page includes AI_FEATURES as select menu options', () => {
    const p = buildSettingsPanel(state as any, 'ai');
    const comps = p.components.flatMap(r => (r as any).toJSON().components);
    const sel = comps.find((c: any) => c.custom_id === 'settings:tier:ai');
    expect(sel.options.map((o: any) => o.value)).toEqual(AI_FEATURES.map(f => f.value));
    expect(sel.max_values).toBe(AI_FEATURES.length);
  });
  it('fun page includes FUN_FEATURES as select menu options', () => {
    const p = buildSettingsPanel(state as any, 'fun');
    const comps = p.components.flatMap(r => (r as any).toJSON().components);
    const sel = comps.find((c: any) => c.custom_id === 'settings:tier:fun');
    expect(sel.options.map((o: any) => o.value)).toEqual(FUN_FEATURES.map(f => f.value));
    expect(sel.max_values).toBe(FUN_FEATURES.length);
  });
  it('defaults to moderation panel for unknown page type (safety net)', () => {
    const p = buildSettingsPanel(state as any, 'nonexistent' as Page);
    expect(p.embeds.length).toBe(1);
    expect(p.components.length).toBeGreaterThanOrEqual(1);
    const ids = p.components.flatMap(r => (r as any).toJSON().components.map((c: any) => c.custom_id));
    expect(ids).toContain('settings:catcherRole');
  });
});
