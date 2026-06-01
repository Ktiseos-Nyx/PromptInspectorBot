# Self-Serve Per-Guild Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a server's own admins self-serve all per-guild settings (moderation routing + feature toggles) via an interactive paged `/settings` panel, enforce an owner-controlled guild allowlist, and fix two latent bugs — all under vitest coverage.

**Architecture:** Pull pure logic (config migration, env-fallback resolution, allowlist guard, panel render/state-transition, security scorers) out of the Discord I/O layer so it can be unit-tested directly. Per-guild moderation config (alert channel, trusted roles/users, monitored channels, catcher role) moves from global env into `guild_settings.json` with env fallback for backward compatibility. Discord-facing wiring (component collector, `GuildCreate` handler) is thin and validated at runtime on top of tested pure functions.

**Tech Stack:** TypeScript (strict, CommonJS), discord.js v14, vitest (new), Node 22.

**Spec:** `docs/superpowers/specs/2026-06-02-self-serve-guild-settings-design.md`

---

## File Structure

**New files:**
- `vitest.config.ts` — vitest configuration (node environment).
- `src/lib/settings-types.ts` — shared types (`GuildEntry`, `GuildModeration`, `ResolvedModConfig`, `EnvModDefaults`). Kept config-free so test files import types without pulling in `config.ts`'s heavy client instantiation.
- `src/lib/settings-panel.ts` — pure panel render (`buildSettingsPanel`) + state-transition (`applyToggleSelection`) + tier definitions.
- `src/lib/allowlist.ts` — pure `shouldLeaveGuild`.
- `src/events/onGuild.ts` — `GuildCreate` handler + startup allowlist sweep.
- Test files: `src/lib/guild-settings.test.ts`, `src/lib/security.test.ts`, `src/lib/allowlist.test.ts`, `src/lib/settings-panel.test.ts`.

**Modified files:**
- `package.json` — add vitest devDep + `test` script.
- `src/lib/guild-settings.ts` — structured schema, migration, `resolveModeration`, typed accessors + setters, `security` default.
- `src/lib/config.ts` — export `ENV_MOD_DEFAULTS`.
- `src/lib/security.ts` — inject `ResolvedModConfig` into `isTrusted`, `calculateScamScore`, `alertAdmins`.
- `src/events/onMessage.ts` — resolve per-guild mod config, decouple security/metadata gating, per-guild monitored channels.
- `src/events/onJoin.ts` — per-guild alert routing.
- `src/events/index.ts` — register `onGuild` events.
- `src/commands/settings.ts` — paged interactive panel + collector.

---

## Task 1: Add vitest infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/sanity.test.ts` (temporary sanity check, deleted in Step 6)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: `vitest` added under devDependencies, no errors.

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block, add a `test` entry so it reads:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/bot.js",
    "dev": "ts-node src/bot.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write a sanity test at `src/lib/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS — 1 passed.

- [ ] **Step 6: Delete the sanity test and commit**

```bash
rm src/lib/sanity.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest infrastructure"
```

---

## Task 2: Shared settings types

**Files:**
- Create: `src/lib/settings-types.ts`

This file holds only types — no runtime imports — so test files and `security.ts` can import them without pulling in `config.ts`.

- [ ] **Step 1: Create `src/lib/settings-types.ts`**

```ts
// Per-guild moderation fields as stored in guild_settings.json.
// Any field omitted/null means "not set" → resolver falls back to env defaults.
export interface GuildModeration {
  alertChannelId: string | null;
  trustedRoleIds: string[];
  trustedUserIds: string[];
  monitoredChannelIds: string[];
  catcherRoleId: string | null;
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
}

// Global env baseline used when a guild has not overridden a field.
export type EnvModDefaults = ResolvedModConfig;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-types.ts
git commit -m "feat: add shared per-guild settings types"
```

---

## Task 3: Guild-settings migration (pure)

**Files:**
- Modify: `src/lib/guild-settings.ts`
- Test: `src/lib/guild-settings.test.ts`

- [ ] **Step 1: Write failing tests at `src/lib/guild-settings.test.ts`**

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- guild-settings`
Expected: FAIL — `migrateGuildEntry is not a function` / not exported.

- [ ] **Step 3: Implement migration in `src/lib/guild-settings.ts`**

Add the import and function (keep the existing file contents for now; later steps replace the rest):

```ts
import type { GuildEntry } from './settings-types';

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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- guild-settings`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/guild-settings.ts src/lib/guild-settings.test.ts
git commit -m "feat: migrate old flat guild entries to structured shape"
```

---

## Task 4: Env-fallback resolution (pure)

**Files:**
- Modify: `src/lib/guild-settings.ts`
- Test: `src/lib/guild-settings.test.ts`

The rule: a per-guild field that is present (not `null`/`undefined`) wins; otherwise fall back to env. For array fields an **empty array is a valid explicit value** (e.g. empty `monitoredChannelIds` = "monitor all channels"), so only `null`/`undefined` triggers fallback.

- [ ] **Step 1: Add failing tests to `src/lib/guild-settings.test.ts`**

```ts
import { resolveModeration } from './guild-settings';
import type { EnvModDefaults } from './settings-types';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- guild-settings`
Expected: FAIL — `resolveModeration is not a function`.

- [ ] **Step 3: Implement `resolveModeration` in `src/lib/guild-settings.ts`**

```ts
import type { GuildEntry, GuildModeration, ResolvedModConfig, EnvModDefaults } from './settings-types';

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
  };
}
```

(Update the existing `import type { GuildEntry }` line from Task 3 to the combined import above.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- guild-settings`
Expected: PASS — all guild-settings tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/guild-settings.ts src/lib/guild-settings.test.ts
git commit -m "feat: resolve per-guild moderation with env fallback"
```

---

## Task 5: Structured store — load/save, toggle accessors, setters, security default

**Files:**
- Modify: `src/lib/guild-settings.ts`
- Test: `src/lib/guild-settings.test.ts`

Replace the boolean-only store with one backed by the structured schema, while keeping the existing public boolean API (`getGuildSetting`, `setGuildSetting`, `getAllGuildSettings`) working. Tests use a temp file via the `GUILD_SETTINGS_PATH` env override.

- [ ] **Step 1: Add failing tests to `src/lib/guild-settings.test.ts`**

```ts
import { afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- guild-settings`
Expected: FAIL — `getGuildModeration` / `setModerationField` not exported, and `GUILD_SETTINGS_PATH` not honored.

- [ ] **Step 3: Replace the store internals in `src/lib/guild-settings.ts`**

Keep `migrateGuildEntry` and `resolveModeration` from Tasks 3–4. Replace everything else with:

```ts
import fs from 'fs';
import path from 'path';
import type { GuildEntry, GuildModeration } from './settings-types';

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
  return process.env.GUILD_SETTINGS_PATH ?? path.resolve(__dirname, '../guild_settings.json');
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
    // Newer files may nest guilds under "guilds"
    if (raw.guilds && typeof raw.guilds === 'object') {
      for (const [key, val] of Object.entries(raw.guilds as Record<string, unknown>)) {
        guilds[key] = migrateGuildEntry(val);
      }
    }
    return { _defaults, guilds };
  } catch {
    return { _defaults: { ...DEFAULTS }, guilds: {} };
  }
}

function save(store: Store): void {
  const out = {
    _comment: 'Per-server configuration. _defaults applies to all guilds; per-guild entries override.',
    _defaults: store._defaults,
    guilds: store.guilds,
  };
  fs.writeFileSync(filePath(), JSON.stringify(out, null, 2));
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- guild-settings`
Expected: PASS — all guild-settings tests pass.

- [ ] **Step 5: Confirm strict compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/guild-settings.ts src/lib/guild-settings.test.ts
git commit -m "feat: structured per-guild store with toggles, moderation, security default"
```

---

## Task 6: Env moderation defaults bridge

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/guild-settings.ts`
- Test: `src/lib/guild-settings.test.ts`

`getModeration(guildId, env)` ties the store to a resolved runtime config. `config.ts` assembles `ENV_MOD_DEFAULTS` from the existing env vars. (Note: today there is no env var for trusted *roles*; that is a new per-guild-only capability, so its env default is an empty set.)

- [ ] **Step 1: Add a failing test to `src/lib/guild-settings.test.ts`**

```ts
import { getModeration } from './guild-settings';
import type { EnvModDefaults } from './settings-types';

describe('getModeration', () => {
  it('resolves per-guild value over env, falls back otherwise', () => {
    const env: EnvModDefaults = {
      alertChannelIds: new Set(['env-alert']),
      trustedRoleIds: new Set(),
      trustedUserIds: new Set(['env-user']),
      monitoredChannelIds: new Set(),
      catcherRoleId: null,
    };
    setModerationField('g1', 'alertChannelId', 'guild-alert');
    const r = getModeration('g1', env);
    expect([...r.alertChannelIds]).toEqual(['guild-alert']);
    expect([...r.trustedUserIds]).toEqual(['env-user']); // fell back to env
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- guild-settings`
Expected: FAIL — `getModeration is not a function`.

- [ ] **Step 3: Add `getModeration` to `src/lib/guild-settings.ts`**

```ts
import type { ResolvedModConfig, EnvModDefaults } from './settings-types';

export function getModeration(guildId: string, env: EnvModDefaults): ResolvedModConfig {
  return resolveModeration(getGuildModeration(guildId), env);
}
```

(Fold `ResolvedModConfig`/`EnvModDefaults` into the existing settings-types import line rather than adding a duplicate import.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- guild-settings`
Expected: PASS.

- [ ] **Step 5: Export `ENV_MOD_DEFAULTS` from `src/lib/config.ts`**

After the existing Security block (around line 43), add:

```ts
import type { EnvModDefaults } from './settings-types';

export const ENV_MOD_DEFAULTS: EnvModDefaults = {
  alertChannelIds: ADMIN_CHANNEL_IDS,
  trustedRoleIds: new Set<string>(), // no env var for trusted roles — per-guild only
  trustedUserIds: TRUSTED_USER_IDS,
  monitoredChannelIds: MONITORED_CHANNEL_IDS,
  catcherRoleId: CATCHER_ROLE_ID || null,
};
```

- [ ] **Step 6: Confirm strict compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/guild-settings.ts src/lib/config.ts src/lib/guild-settings.test.ts
git commit -m "feat: bridge env moderation defaults into resolved config"
```

---

## Task 7: Inject per-guild config into security functions

**Files:**
- Modify: `src/lib/security.ts`
- Test: `src/lib/security.test.ts`

`isTrusted`, `calculateScamScore`, and `alertAdmins` currently read global constants. Change them to take a `ResolvedModConfig`. `isTrusted` gains **trusted-role** support.

- [ ] **Step 1: Write failing tests at `src/lib/security.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isTrusted, calculateScamScore, algoSpeakScore, verifyImageSafety } from './security';
import type { ResolvedModConfig } from './settings-types';

function cfg(over: Partial<ResolvedModConfig> = {}): ResolvedModConfig {
  return {
    alertChannelIds: new Set(),
    trustedRoleIds: new Set(),
    trustedUserIds: new Set(),
    monitoredChannelIds: new Set(),
    catcherRoleId: null,
    ...over,
  };
}

function fakeMessage(over: any = {}): any {
  return {
    author: { id: 'u1', username: 'normal', avatar: 'abc' },
    content: '',
    guild: { ownerId: 'owner' },
    member: { displayName: 'normal', roles: { cache: new Map([['everyone', {}]]) } },
    attachments: new Map(),
    ...over,
  };
}

describe('isTrusted', () => {
  it('trusts a user in trustedUserIds', () => {
    expect(isTrusted(fakeMessage({ author: { id: 'u1' } }), cfg({ trustedUserIds: new Set(['u1']) }))).toBe(true);
  });

  it('trusts the guild owner', () => {
    expect(isTrusted(fakeMessage({ author: { id: 'owner' } }), cfg())).toBe(true);
  });

  it('trusts a member holding a trusted role (NEW capability)', () => {
    const m = fakeMessage({
      author: { id: 'u9' },
      member: { displayName: 'x', roles: { cache: new Map([['mod-role', {}]]) } },
    });
    expect(isTrusted(m, cfg({ trustedRoleIds: new Set(['mod-role']) }))).toBe(true);
  });

  it('does not trust an unknown user with no trusted role', () => {
    expect(isTrusted(fakeMessage({ author: { id: 'u9' } }), cfg())).toBe(false);
  });
});

describe('calculateScamScore', () => {
  it('flags the only-catcher-role case using the per-guild catcher role', () => {
    const m = fakeMessage({
      content: '',
      member: { displayName: 'n', roles: { cache: new Map([['everyone', {}], ['catch', {}]]) } },
    });
    const [score, reasons] = calculateScamScore(m, cfg({ catcherRoleId: 'catch' }));
    expect(reasons.some(r => /CATCHER/i.test(r))).toBe(true);
    expect(score).toBeGreaterThanOrEqual(30);
  });
});

describe('pure scorers still work', () => {
  it('verifyImageSafety rejects an MZ executable', () => {
    expect(verifyImageSafety(Buffer.from([0x4d, 0x5a, 0x00, 0x00]), 'x.png')[0]).toBe(false);
  });
  it('algoSpeakScore flags zero-width characters', () => {
    expect(algoSpeakScore('hi​there friend')).toBeGreaterThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- security`
Expected: FAIL — `isTrusted`/`calculateScamScore` signatures don't accept a config arg (TS/type or assertion failures).

- [ ] **Step 3: Update `src/lib/security.ts`**

Change the import line 3 from:

```ts
import { CATCHER_ROLE_ID, TRUSTED_USER_IDS, ADMIN_CHANNEL_IDS } from './config';
```

to:

```ts
import type { ResolvedModConfig } from './settings-types';
```

Update `isTrusted`:

```ts
export function isTrusted(message: Message, cfg: ResolvedModConfig): boolean {
  if (cfg.trustedUserIds.has(message.author.id)) return true;
  if (message.guild && message.author.id === message.guild.ownerId) return true;
  const roles = message.member?.roles?.cache;
  if (roles && cfg.trustedRoleIds.size) {
    for (const roleId of cfg.trustedRoleIds) if (roles.has(roleId)) return true;
  }
  return false;
}
```

Update `calculateScamScore` signature and the catcher-role block:

```ts
export function calculateScamScore(message: Message, cfg: ResolvedModConfig): [number, string[]] {
```

Replace the `CATCHER_ROLE_ID` usage inside it:

```ts
    if (cfg.catcherRoleId && roles.size === 2 && roles.has(cfg.catcherRoleId)) {
      score += 30; reasons.push('Only has CATCHER role');
    } else if (roles.size === 1) {
```

Update `alertAdmins` to take the config and use it instead of `ADMIN_CHANNEL_IDS`:

```ts
export async function alertAdmins(
  guild: Guild,
  member: GuildMember | { id: string; displayName: string; avatarURL?: () => string | null },
  reason: string,
  details: string[],
  action: string,
  cfg: ResolvedModConfig,
): Promise<void> {
  if (!cfg.alertChannelIds.size) return;
  // ...unchanged embed construction...
  for (const channelId of cfg.alertChannelIds) {
    const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (channel) await channel.send({ embeds: [embed] }).catch(() => null);
  }
}
```

Update `instantBan` to accept and forward the config:

```ts
export async function instantBan(message: Message, reason: string, cfg: ResolvedModConfig, details: string[] = []): Promise<void> {
  // ...unchanged...
  await alertAdmins(message.guild, message.member ?? message.author as any, reason, details, 'BANNED', cfg);
  // ...catch branch...
  if (message.guild) await alertAdmins(message.guild, message.member ?? message.author as any, reason, details, 'FAILED', cfg);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- security`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security.ts src/lib/security.test.ts
git commit -m "feat: inject per-guild config into security; add trusted-role support"
```

---

## Task 8: Rewire onMessage — resolve config, decouple security/metadata gating

**Files:**
- Modify: `src/events/onMessage.ts`

Manual/runtime validation (Discord I/O). The two bug fixes land here.

- [ ] **Step 1: Update imports in `src/events/onMessage.ts`**

```ts
import { SCAN_LIMIT_BYTES, DM_ALLOWED_USER_IDS, DM_RESPONSE_MESSAGE, ENV_MOD_DEFAULTS } from '../lib/config';
import { getGuildSetting, getModeration } from '../lib/guild-settings';
```

(Remove the `MONITORED_CHANNEL_IDS` import — monitored channels are now per-guild.)

- [ ] **Step 2: Resolve config and fix the two gating bugs**

Replace the channel-filtering + security-gating region (current lines 27–37) with:

```ts
    // ── Resolve this guild's moderation config (per-guild value or env fallback) ──
    const mod = getModeration(message.guildId!, ENV_MOD_DEFAULTS);

    // ── Channel filtering (per-guild monitored channels; empty = all) ───────────
    const channelId = ('parentId' in message.channel && message.channel.parentId)
      ? message.channel.parentId
      : message.channelId;
    if (mod.monitoredChannelIds.size && !mod.monitoredChannelIds.has(channelId)) return;

    // ── Security checks (independent of the metadata toggle) ─────────────────────
    const securityEnabled = getGuildSetting(message.guildId!, 'security', true);

    if (securityEnabled && !isTrusted(message, mod)) {
```

Then thread `mod` into every `instantBan(...)`, `calculateScamScore(...)`, and `alertAdmins(...)` call in the security block. Examples:

```ts
        await instantBan(message, `Known banned user: ${knownBan.reason}`, mod, ['In ban registry']);
```
```ts
      const [score, reasons] = calculateScamScore(message, mod);
```
```ts
        await alertAdmins(message.guild, message.member ?? message.author as any,
          `Suspicious message (score: ${score})`, reasons, 'DELETED', mod);
```

(Apply to all ~10 call sites in the block — `instantBan` gains `mod` as its 3rd arg before `details`; `alertAdmins` gains `mod` as its final arg.)

- [ ] **Step 3: Move the metadata gate to its own independent check**

Delete the old early-return `if (!getGuildSetting(message.guildId!, 'metadata', true)) return;` from the top region, and guard the PNG-processing block instead. Just before the `pngAttachments` filter (current line 159), add:

```ts
    // ── PNG metadata processing (independent of security) ───────────────────────
    if (!getGuildSetting(message.guildId!, 'metadata', true)) return;
```

- [ ] **Step 4: Confirm strict compile + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no compile errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/events/onMessage.ts
git commit -m "fix: decouple security from metadata toggle; per-guild monitored channels"
```

---

## Task 9: Rewire onJoin alert routing

**Files:**
- Modify: `src/events/onJoin.ts`

- [ ] **Step 1: Resolve per-guild alert channels in `src/events/onJoin.ts`**

Replace the `ADMIN_CHANNEL_IDS` import with:

```ts
import { ENV_MOD_DEFAULTS } from '../lib/config';
import { getModeration } from '../lib/guild-settings';
```

Replace the send loop (current lines 25–28) with:

```ts
    const mod = getModeration(member.guild.id, ENV_MOD_DEFAULTS);
    for (const channelId of mod.alertChannelIds) {
      const channel = member.guild.channels.cache.get(channelId) as TextChannel | undefined;
      if (channel) await channel.send({ embeds: [embed] }).catch(() => null);
    }
```

- [ ] **Step 2: Confirm strict compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/events/onJoin.ts
git commit -m "feat: route registry-join alerts to per-guild alert channel"
```

---

## Task 10: Allowlist guard (pure) + GuildCreate handler + startup sweep

**Files:**
- Create: `src/lib/allowlist.ts`
- Test: `src/lib/allowlist.test.ts`
- Create: `src/events/onGuild.ts`
- Modify: `src/events/index.ts`

- [ ] **Step 1: Write failing tests at `src/lib/allowlist.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { shouldLeaveGuild } from './allowlist';

describe('shouldLeaveGuild', () => {
  it('never leaves when the allowlist is empty (open mode)', () => {
    expect(shouldLeaveGuild('any', new Set())).toBe(false);
  });
  it('leaves a guild not on a non-empty allowlist', () => {
    expect(shouldLeaveGuild('g2', new Set(['g1']))).toBe(true);
  });
  it('stays in an allowlisted guild', () => {
    expect(shouldLeaveGuild('g1', new Set(['g1']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- allowlist`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/allowlist.ts`**

```ts
// Returns true only when an allowlist is configured AND this guild is not on it.
// An empty allowlist means "open" — the bot never auto-leaves.
export function shouldLeaveGuild(guildId: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return false;
  return !allowlist.has(guildId);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- allowlist`
Expected: PASS — 3 passed.

- [ ] **Step 5: Implement `src/events/onGuild.ts`**

```ts
import { Events, Guild, type Client } from 'discord.js';
import { ALLOWED_GUILD_IDS } from '../lib/config';
import { shouldLeaveGuild } from '../lib/allowlist';

async function leaveIfNotAllowed(guild: Guild, when: string): Promise<void> {
  if (shouldLeaveGuild(guild.id, ALLOWED_GUILD_IDS)) {
    console.warn(`[allowlist] Leaving non-allowlisted guild ${guild.name} (${guild.id}) [${when}]`);
    await guild.leave().catch(err => console.error('[allowlist] leave failed:', err));
  }
}

export function registerGuildEvents(client: Client): void {
  // New invite — leave immediately if not allowlisted.
  client.on(Events.GuildCreate, (guild) => { void leaveIfNotAllowed(guild, 'join'); });

  // Startup sweep — leave any non-allowlisted guild we are already in.
  client.once(Events.ClientReady, (c) => {
    if (ALLOWED_GUILD_IDS.size === 0) return; // open mode — skip sweep
    for (const guild of c.guilds.cache.values()) void leaveIfNotAllowed(guild, 'startup');
  });
}
```

- [ ] **Step 6: Register in `src/events/index.ts`**

Add the import and call alongside the existing event registrations:

```ts
import { registerGuildEvents } from './onGuild';
```

and inside `registerEvents(client)`:

```ts
  registerGuildEvents(client);
```

- [ ] **Step 7: Confirm strict compile + suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors; all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/allowlist.ts src/lib/allowlist.test.ts src/events/onGuild.ts src/events/index.ts
git commit -m "feat: enforce ALLOWED_GUILD_IDS allowlist (leave non-allowlisted on join + startup)"
```

---

## Task 11: Settings panel — tiers, render, state-transition (pure)

**Files:**
- Create: `src/lib/settings-panel.ts`
- Test: `src/lib/settings-panel.test.ts`

Pure functions: tier definitions, `buildSettingsPanel(state, page)` → `{ embeds, components }`, and `applyToggleSelection(current, tier, selectedValues)` → updated toggle map. The command (Task 12) wires these into a live collector.

- [ ] **Step 1: Write failing tests at `src/lib/settings-panel.test.ts`**

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- settings-panel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/settings-panel.ts`**

```ts
import {
  EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelType,
} from 'discord.js';
import type { GuildEntry } from './settings-types';

export interface Feature { value: string; label: string; }

export const AI_FEATURES: Feature[] = [
  { value: 'metadata',     label: 'Metadata extraction (reactions + /metadata)' },
  { value: 'ask',          label: 'AI chat (/ask)' },
  { value: 'describe',     label: 'Image description (/describe)' },
  { value: 'coder',        label: 'Coding help (/coder)' },
  { value: 'techsupport',  label: 'Tech support (/techsupport)' },
  { value: 'promptsupport',label: 'Prompt help (/promptsupport)' },
];

export const FUN_FEATURES: Feature[] = [
  { value: 'fun_commands', label: 'Fun commands (/decide, /poll, /wildcard, /goodnight)' },
  { value: 'interact',     label: 'User interactions (/interact)' },
  { value: 'qotd',         label: 'Question of the day' },
];

export type Page = 'moderation' | 'ai' | 'fun';

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

function navRow(active: Page): ActionRowBuilder<ButtonBuilder> {
  const mk = (page: Page, label: string) =>
    new ButtonBuilder()
      .setCustomId(`settings:nav:${page}`)
      .setLabel(label)
      .setStyle(page === active ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    mk('moderation', 'Moderation'), mk('ai', 'AI & Metadata'), mk('fun', 'Fun'),
  );
}

export function buildSettingsPanel(state: GuildEntry, page: Page) {
  const t = state.toggles ?? {};
  const m = state.moderation ?? {};

  const summary = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('⚙️ Server settings')
    .addFields(
      {
        name: 'Moderation',
        value: [
          `${on(t.security ?? true)} Anti-scam protection`,
          `Alert channel: ${m.alertChannelId ? `<#${m.alertChannelId}>` : '*(default)*'}`,
          `Trusted roles: ${m.trustedRoleIds?.length ? m.trustedRoleIds.map(r => `<@&${r}>`).join(' ') : '*(none)*'}`,
          `Monitored channels: ${m.monitoredChannelIds?.length ? m.monitoredChannelIds.map(c => `<#${c}>`).join(' ') : '*(all)*'}`,
        ].join('\n'),
      },
      { name: 'AI & Metadata', value: AI_FEATURES.map(f => `${on(t[f.value])} ${f.label}`).join('\n') },
      { name: 'Fun', value: FUN_FEATURES.map(f => `${on(t[f.value])} ${f.label}`).join('\n') },
    );

  const components: ActionRowBuilder<any>[] = [navRow(page)];

  if (page === 'moderation') {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('settings:toggle:security')
          .setLabel(`Anti-scam: ${t.security ?? true ? 'ON' : 'OFF'}`)
          .setStyle(t.security ?? true ? ButtonStyle.Success : ButtonStyle.Danger),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:alertChannel')
          .setPlaceholder('Alert channel')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(0).setMaxValues(1),
      ),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('settings:trustedRoles')
          .setPlaceholder('Trusted roles')
          .setMinValues(0).setMaxValues(10),
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:monitoredChannels')
          .setPlaceholder('Monitored channels (none = all)')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(0).setMaxValues(25),
      ),
    );
  } else {
    const tier = page === 'ai' ? AI_FEATURES : FUN_FEATURES;
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`settings:tier:${page}`)
          .setPlaceholder('Enabled features (selected = on)')
          .setMinValues(0).setMaxValues(tier.length)
          .addOptions(tier.map(f => ({ label: f.label, value: f.value, default: !!t[f.value] }))),
      ),
    );
  }

  return { embeds: [summary], components };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- settings-panel`
Expected: PASS.

- [ ] **Step 5: Confirm strict compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/settings-panel.ts src/lib/settings-panel.test.ts
git commit -m "feat: pure settings-panel render and tier state-transition"
```

---

## Task 12: Wire the live `/settings` panel + collector

**Files:**
- Modify: `src/commands/settings.ts`

Manual/runtime validation. Uses the pure functions from Task 11 plus the store setters from Task 5.

- [ ] **Step 1: Replace `src/commands/settings.ts`**

```ts
import {
  ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, MessageFlags,
  ComponentType, type AnySelectMenuInteraction, type ButtonInteraction,
} from 'discord.js';
import {
  getGuildModeration, getAllGuildSettings, setGuildSetting, setModerationField,
} from '../lib/guild-settings';
import {
  buildSettingsPanel, applyToggleSelection, AI_FEATURES, FUN_FEATURES, type Page,
} from '../lib/settings-panel';

function snapshot(guildId: string) {
  return { toggles: getAllGuildSettings(guildId), moderation: getGuildModeration(guildId) };
}

export const settingsCommand = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure bot features for this server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral });
    }
    const isAdmin = (interaction.member?.permissions as any)?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Requires Manage Server permission.', flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guildId!;
    let page: Page = 'moderation';

    const reply = await interaction.reply({
      ...buildSettingsPanel(snapshot(guildId) as any, page),
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });
    const message = reply.resource!.message!;

    const collector = message.createMessageComponentCollector({
      idle: 5 * 60_000,
      filter: i => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (i) => {
      const id = i.customId;

      if (id.startsWith('settings:nav:')) {
        page = id.split(':')[2] as Page;
      } else if (id === 'settings:toggle:security') {
        const cur = getAllGuildSettings(guildId).security ?? true;
        setGuildSetting(guildId, 'security', !cur);
      } else if (id === 'settings:alertChannel') {
        const sel = i as AnySelectMenuInteraction;
        setModerationField(guildId, 'alertChannelId', sel.values[0] ?? null);
      } else if (id === 'settings:trustedRoles') {
        const sel = i as AnySelectMenuInteraction;
        setModerationField(guildId, 'trustedRoleIds', [...sel.values]);
      } else if (id === 'settings:monitoredChannels') {
        const sel = i as AnySelectMenuInteraction;
        setModerationField(guildId, 'monitoredChannelIds', [...sel.values]);
      } else if (id.startsWith('settings:tier:')) {
        const which = id.split(':')[2] as Page;
        const tier = which === 'ai' ? AI_FEATURES : FUN_FEATURES;
        const sel = i as AnySelectMenuInteraction;
        const next = applyToggleSelection(getAllGuildSettings(guildId), tier, [...sel.values]);
        for (const f of tier) setGuildSetting(guildId, f.value, next[f.value]);
      }

      await (i as ButtonInteraction | AnySelectMenuInteraction).update(
        buildSettingsPanel(snapshot(guildId) as any, page),
      );
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => null);
    });
  },
};
```

- [ ] **Step 2: Confirm strict compile + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no compile errors; all unit tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/settings.ts
git commit -m "feat: interactive paged /settings panel with live collector"
```

---

## Task 13: Build, manual runtime validation, finalize

**Files:**
- Modify: `CLAUDE.md` (document the new `npm test` workflow)

- [ ] **Step 1: Full build + suite**

Run: `npm run build && npm test`
Expected: `tsc` emits to `dist/` with no errors; all tests pass.

- [ ] **Step 2: Manual runtime validation**

Set a test `.env` (test bot token, a single guild in `ALLOWED_GUILD_IDS`). Run `npm run dev` and verify:
  1. `/settings` opens the paged panel; nav buttons switch Moderation / AI & Metadata / Fun.
  2. Toggling anti-scam, picking an alert channel, trusted roles, and monitored channels all persist to `guild_settings.json` (inspect the file).
  3. Disable the `metadata` toggle, then post a known-spam test message → anti-scam still fires (decoupling verified).
  4. A security event posts its alert to the per-guild alert channel you set.
  5. Invite the bot to a second, non-allowlisted guild → it leaves immediately (check logs for `[allowlist] Leaving`).
  6. Confirm the existing main server (no per-guild moderation set) still alerts via the env `ADMIN_CHANNEL_IDS` (env fallback verified).

- [ ] **Step 3: Update `CLAUDE.md`**

Under the Commands section, replace the "There are no automated tests..." line with:

```markdown
# Run tests
npm test          # vitest run
npm run test:watch
```

and note: "Pure logic (guild settings, moderation resolution, allowlist, panel render, security scorers) is unit-tested; Discord I/O is validated by running the bot."

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document vitest workflow and per-guild settings"
```

---

## Self-Review Notes

- **Spec coverage:** owner/admin boundary (Tasks 5–6, env fallback), per-guild store (Tasks 3–6), moderation wiring incl. trusted roles (Tasks 7–9), bug fixes — security/metadata decoupling + `security` default (Tasks 5, 8), paged panel (Tasks 11–12), allowlist gate block-new+leave-existing (Task 10). All covered.
- **Operational caveat from spec** (both guilds must be in `ALLOWED_GUILD_IDS` before deploy) is reflected in Task 13 manual validation step 5–6.
- **Type consistency:** `ResolvedModConfig`/`EnvModDefaults`/`GuildEntry`/`GuildModeration` defined once in `settings-types.ts` and reused; `getModeration(guildId, env)`, `setModerationField(guildId, field, value)`, `buildSettingsPanel(state, page)`, `applyToggleSelection(current, tier, selected)` signatures are consistent across tasks.
```
