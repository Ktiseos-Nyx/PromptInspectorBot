import { describe, it, expect } from 'vitest';
import { migrateGuildEntry, resolveModeration } from './guild-settings';
import type { EnvModDefaults } from './settings-types';

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

const ENV: EnvModDefaults = {
  alertChannelIds: new Set(['env-alert']),
  trustedRoleIds: new Set(['env-role']),
  trustedUserIds: new Set(['env-user']),
  monitoredChannelIds: new Set(['env-chan']),
  catcherRoleId: 'env-catcher',
};

describe('resolveModeration', () => {
  it('falls back to env when guild moderation is empty', () => {
    const r = resolveModeration({}, ENV);
    expect([...r.alertChannelIds]).toEqual(['env-alert']);
    expect([...r.trustedUserIds]).toEqual(['env-user']);
    expect([...r.monitoredChannelIds]).toEqual(['env-chan']);
    expect(r.catcherRoleId).toBe('env-catcher');
  });

  it('uses the per-guild alert channel when set', () => {
    const r = resolveModeration({ alertChannelId: 'guild-alert' }, ENV);
    expect([...r.alertChannelIds]).toEqual(['guild-alert']);
  });

  it('treats an explicit empty monitored array as "monitor all" (no env fallback)', () => {
    const r = resolveModeration({ monitoredChannelIds: [] }, ENV);
    expect(r.monitoredChannelIds.size).toBe(0);
  });

  it('merges per-guild trusted roles/users as provided', () => {
    const r = resolveModeration({ trustedRoleIds: ['a', 'b'], trustedUserIds: [] }, ENV);
    expect([...r.trustedRoleIds]).toEqual(['a', 'b']);
    expect(r.trustedUserIds.size).toBe(0);
  });
});
