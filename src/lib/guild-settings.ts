import fs from 'fs';
import { dataFile, writeJsonAtomic } from './paths';
import type { GuildEntry, GuildModeration, ResolvedModConfig, EnvModDefaults } from './settings-types';
import { CROSS_POST_WINDOW } from './security';

const DEFAULTS: Record<string, boolean> = {
  ask: false,
  metadata: true,
  describe: true,
  techsupport: false,
  coder: false,
  promptsupport: true,
  fun_commands: true,
  qotd: false,
  interact: true,
  security: true,
};

function filePath(): string {
  return process.env.GUILD_SETTINGS_PATH ?? dataFile('guild_settings.json');
}

interface Store {
  _defaults: Record<string, boolean>;
  guilds: Record<string, GuildEntry>;
}

function load(): Store {
  const file = filePath();
  if (!fs.existsSync(file)) return { _defaults: { ...DEFAULTS }, guilds: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const _defaults = { ...DEFAULTS, ...((raw._defaults as Record<string, boolean>) ?? {}) };
    const guilds: Record<string, GuildEntry> = {};
    for (const [key, val] of Object.entries(raw)) {
      if (key === '_defaults' || key === '_comment' || key === 'guilds') continue;
      guilds[key] = migrateGuildEntry(val);
    }
    if (raw.guilds && typeof raw.guilds === 'object') {
      for (const [key, val] of Object.entries(raw.guilds as Record<string, unknown>)) {
        guilds[key] = migrateGuildEntry(val);
      }
    }
    return { _defaults, guilds };
  } catch (err) {
    // Log rather than swallow: a parse failure here is how a corrupt file would silently
    // become "empty guilds", which the next save() would then persist — wiping config.
    console.error(`[guild-settings] failed to read/parse ${file} — falling back to defaults:`, err);
    return { _defaults: { ...DEFAULTS }, guilds: {} };
  }
}

function save(store: Store): void {
  const out = {
    _comment: 'Per-server configuration. _defaults applies to all guilds; per-guild entries override.',
    _defaults: store._defaults,
    guilds: store.guilds,
  };
  writeJsonAtomic(filePath(), out);
}

function entry(store: Store, guildId: string): GuildEntry {
  if (!store.guilds[guildId]) store.guilds[guildId] = { toggles: {}, moderation: {} };
  return store.guilds[guildId];
}

export function getGuildSetting(guildId: string, setting: string, fallback = false): boolean {
  const store = load();
  const g = store.guilds[guildId];
  if (g && setting in g.toggles) return g.toggles[setting];
  if (setting in store._defaults) return store._defaults[setting];
  return fallback;
}

export function setGuildSetting(guildId: string, setting: string, value: boolean): void {
  const store = load();
  entry(store, guildId).toggles[setting] = value;
  save(store);
}

export function getAllGuildSettings(guildId: string): Record<string, boolean> {
  const store = load();
  return { ...DEFAULTS, ...store._defaults, ...(store.guilds[guildId]?.toggles ?? {}) };
}

export function getGuildModeration(guildId: string): Partial<GuildModeration> {
  const store = load();
  return { ...(store.guilds[guildId]?.moderation ?? {}) };
}

export function setModerationField<K extends keyof GuildModeration>(
  guildId: string,
  field: K,
  value: GuildModeration[K],
): void {
  const store = load();
  entry(store, guildId).moderation[field] = value;
  save(store);
}

export function migrateGuildEntry(raw: unknown): GuildEntry {
  if (raw && typeof raw === 'object' && 'toggles' in raw) {
    const r = raw as { toggles?: Record<string, boolean>; moderation?: Record<string, unknown> };
    return {
      toggles: { ...(r.toggles ?? {}) },
      moderation: { ...(r.moderation ?? {}) } as GuildEntry['moderation'],
    };
  }
  const toggles: Record<string, boolean> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'boolean') toggles[k] = v;
    }
  }
  return { toggles, moderation: {} };
}

export function resolveModeration(
  mod: Partial<GuildModeration> | undefined,
  env: EnvModDefaults,
): ResolvedModConfig {
  const m = mod ?? {};
  return {
    alertChannelIds:
      m.alertChannelId != null ? new Set([m.alertChannelId]) : new Set(env.alertChannelIds),
    trustedRoleIds:
      m.trustedRoleIds != null ? new Set(m.trustedRoleIds) : new Set(env.trustedRoleIds),
    trustedUserIds:
      m.trustedUserIds != null ? new Set(m.trustedUserIds) : new Set(env.trustedUserIds),
    monitoredChannelIds:
      m.monitoredChannelIds != null ? new Set(m.monitoredChannelIds) : new Set(env.monitoredChannelIds),
    catcherRoleId: m.catcherRoleId != null ? m.catcherRoleId : env.catcherRoleId,
    mediaSpamChannels: m.mediaSpamChannels != null ? m.mediaSpamChannels : env.mediaSpamChannels,
    mediaSpamSameChannels: m.mediaSpamSameChannels != null ? m.mediaSpamSameChannels : env.mediaSpamSameChannels,
    mediaSpamWindowSec: Math.max(1, Math.min(
      m.mediaSpamWindowSec != null ? m.mediaSpamWindowSec : env.mediaSpamWindowSec,
      CROSS_POST_WINDOW,
    )),
    largeMediaBytes: m.largeMediaBytes != null ? m.largeMediaBytes : env.largeMediaBytes,
    largeMediaTypes: m.largeMediaTypes != null ? new Set(m.largeMediaTypes) : new Set(env.largeMediaTypes),
    honeypotMode: m.honeypotMode != null ? m.honeypotMode : env.honeypotMode,
  };
}

export function getModeration(guildId: string, env: EnvModDefaults): ResolvedModConfig {
  return resolveModeration(getGuildModeration(guildId), env);
}
