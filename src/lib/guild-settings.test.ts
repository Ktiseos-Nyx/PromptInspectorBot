import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateGuildEntry, resolveModeration, getModeration } from './guild-settings';
import type { EnvModDefaults } from './settings-types';
import {
  getGuildSetting, setGuildSetting, getAllGuildSettings,
  getGuildModeration, setModerationField,
} from './guild-settings';

let tmp: string;
beforeEach(() => {
  tmp = path.join(os.tmpdir(), `gs-${Date.now()}-${Math.random()}.json`);
  process.env.GUILD_SETTINGS_PATH = tmp;
});
afterEach(() => {
  delete process.env.GUILD_SETTINGS_PATH;
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
});

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
  mediaSpamChannels: 4,
  mediaSpamSameChannels: 3,
  mediaSpamWindowSec: 120,
  largeMediaBytes: 5 * 1024 * 1024,
  largeMediaTypes: new Set(['image/gif']),
  honeypotMode: 'crosspost',
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

describe('toggle store', () => {
  it('defaults security to true', () => {
    expect(getGuildSetting('g1', 'security')).toBe(true);
  });

  it('persists a per-guild toggle and reads it back', () => {
    setGuildSetting('g1', 'ask', true);
    expect(getGuildSetting('g1', 'ask')).toBe(true);
    expect(getGuildSetting('g2', 'ask')).toBe(false); // other guild unaffected
  });

  it('includes security in getAllGuildSettings', () => {
    expect(getAllGuildSettings('g1').security).toBe(true);
  });

  it('migrates a legacy flat file on read', () => {
    fs.writeFileSync(tmp, JSON.stringify({ g1: { ask: true } }));
    expect(getGuildSetting('g1', 'ask')).toBe(true);
  });

  it('falls back to defaults (without throwing) on a corrupt file', () => {
    fs.writeFileSync(tmp, '{ this is not valid json');
    expect(() => getGuildSetting('g1', 'security')).not.toThrow();
    expect(getGuildSetting('g1', 'security')).toBe(true);
  });

  it('writes atomically (no leftover temp file)', () => {
    setGuildSetting('g1', 'ask', true);
    expect(fs.existsSync(tmp)).toBe(true);
    expect(fs.existsSync(`${tmp}.${process.pid}.tmp`)).toBe(false);
  });
});

describe('moderation store', () => {
  it('returns null/empty moderation for an unset guild', () => {
    expect(getGuildModeration('g1')).toEqual({});
  });

  it('persists a moderation field and reads it back', () => {
    setModerationField('g1', 'alertChannelId', 'chan-1');
    expect(getGuildModeration('g1').alertChannelId).toBe('chan-1');
  });

  it('persists an array moderation field', () => {
    setModerationField('g1', 'trustedRoleIds', ['r1', 'r2']);
    expect(getGuildModeration('g1').trustedRoleIds).toEqual(['r1', 'r2']);
  });
});

describe('getModeration', () => {
  it('resolves per-guild value over env, falls back otherwise', () => {
    const env: EnvModDefaults = {
      alertChannelIds: new Set(['env-alert']),
      trustedRoleIds: new Set(),
      trustedUserIds: new Set(['env-user']),
      monitoredChannelIds: new Set(),
      catcherRoleId: null,
      mediaSpamChannels: 4,
      mediaSpamSameChannels: 3,
      mediaSpamWindowSec: 120,
      largeMediaBytes: 5 * 1024 * 1024,
      largeMediaTypes: new Set(['image/gif']),
      honeypotMode: 'crosspost',
    };
    setModerationField('g1', 'alertChannelId', 'guild-alert');
    const r = getModeration('g1', env);
    expect([...r.alertChannelIds]).toEqual(['guild-alert']);
    expect([...r.trustedUserIds]).toEqual(['env-user']); // fell back to env
  });
});

describe('resolveModeration — media-spam fields', () => {
  const env: EnvModDefaults = {
    alertChannelIds: new Set(),
    trustedRoleIds: new Set(),
    trustedUserIds: new Set(),
    monitoredChannelIds: new Set(),
    catcherRoleId: null,
    mediaSpamChannels: 4,
    mediaSpamSameChannels: 3,
    mediaSpamWindowSec: 120,
    largeMediaBytes: 5 * 1024 * 1024,
    largeMediaTypes: new Set(['image/gif']),
    honeypotMode: 'crosspost',
  };

  it('falls back to env defaults when unset', () => {
    const r = resolveModeration({}, env);
    expect(r.mediaSpamChannels).toBe(4);
    expect(r.mediaSpamWindowSec).toBe(120);
    expect(r.honeypotMode).toBe('crosspost');
    expect([...r.largeMediaTypes]).toEqual(['image/gif']);
  });

  it('uses per-guild overrides when set', () => {
    const r = resolveModeration(
      { mediaSpamChannels: 6, mediaSpamWindowSec: 60, honeypotMode: 'strict', largeMediaTypes: ['image/gif', 'video/mp4'] },
      env,
    );
    expect(r.mediaSpamChannels).toBe(6);
    expect(r.mediaSpamWindowSec).toBe(60);
    expect(r.honeypotMode).toBe('strict');
    expect(r.largeMediaTypes.has('video/mp4')).toBe(true);
  });

  it('clamps mediaSpamWindowSec to the 300s retention ceiling', () => {
    const r = resolveModeration({ mediaSpamWindowSec: 400 }, env);
    expect(r.mediaSpamWindowSec).toBe(300);
  });
});
