import { describe, it, expect } from 'vitest';
import { migrateGuildEntry } from './guild-settings';

describe('migrateGuildEntry', () => {
  it('passes through an already-structured entry', () => {
    const entry = { toggles: { metadata: true }, moderation: { alertChannelId: '1' } };
    expect(migrateGuildEntry(entry)).toEqual({
      toggles: { metadata: true },
      moderation: { alertChannelId: '1' },
    });
  });

  it('migrates an old flat boolean entry into toggles', () => {
    const old = { metadata: true, ask: false, security: true };
    expect(migrateGuildEntry(old)).toEqual({
      toggles: { metadata: true, ask: false, security: true },
      moderation: {},
    });
  });

  it('ignores non-boolean values in a flat entry', () => {
    const old = { metadata: true, _comment: 'x' };
    expect(migrateGuildEntry(old)).toEqual({
      toggles: { metadata: true },
      moderation: {},
    });
  });

  it('returns empty structure for an empty object', () => {
    expect(migrateGuildEntry({})).toEqual({ toggles: {}, moderation: {} });
  });
});
