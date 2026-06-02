import { describe, it, expect } from 'vitest';
import { AI_FEATURES, FUN_FEATURES, applyToggleSelection, buildSettingsPanel } from './settings-panel';

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
});
