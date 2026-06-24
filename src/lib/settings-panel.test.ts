import { describe, it, expect } from 'vitest';
import {
  AI_FEATURES, FUN_FEATURES, applyToggleSelection, buildSettingsPanel,
  TRUSTED_USERS_MAX, TRUSTED_ROLES_MAX,
} from './settings-panel';

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
    expect(next.fun_commands).toBe(true); // fun tier untouched
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
});
