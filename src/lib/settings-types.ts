// Per-guild moderation fields as stored in guild_settings.json.
// Any field omitted/null means "not set" → resolver falls back to env defaults.
export interface GuildModeration {
  alertChannelId: string | null;
  trustedRoleIds: string[];
  trustedUserIds: string[];
  monitoredChannelIds: string[];
  catcherRoleId: string | null;
  mediaSpamChannels: number | null;
  mediaSpamSameChannels: number | null;
  mediaSpamWindowSec: number | null;
  largeMediaBytes: number | null;
  largeMediaTypes: string[] | null;
  honeypotMode: 'off' | 'crosspost' | 'strict' | null;
}

// One guild's full entry.
export interface GuildEntry {
  toggles: Record<string, boolean>;
  moderation: Partial<GuildModeration>;
}

// Fully resolved moderation config (per-guild value or env fallback), used at runtime.
export interface ResolvedModConfig {
  alertChannelIds: Set<string>;
  trustedRoleIds: Set<string>;
  trustedUserIds: Set<string>;
  monitoredChannelIds: Set<string>;
  catcherRoleId: string | null;
  mediaSpamChannels: number;
  mediaSpamSameChannels: number;
  mediaSpamWindowSec: number;
  largeMediaBytes: number;
  largeMediaTypes: Set<string>;
  honeypotMode: 'off' | 'crosspost' | 'strict';
}

// Global env baseline used when a guild has not overridden a field.
export type EnvModDefaults = ResolvedModConfig;
