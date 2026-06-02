# Self-Serve Per-Guild Settings + Reworked `/settings` Panel

**Date:** 2026-06-02
**Status:** Design — pending user review
**Branch:** feat/typescript-migration

## Problem & Context

A mutual runs a large (1000+ member) FFXIV-adjacent Discord server hit by the same
4+ image spam/scam attack PromptInspectorBot already defends against. We want that
server's own admins to be able to turn protection on/off and configure it themselves,
without the bot owner being in the loop for every change.

Today, the per-guild control surface is only the boolean feature flags in
`guild_settings.json`. The settings that actually matter for moderation — **where
alerts go**, **who is trusted**, **which channels are monitored**, the **catcher
role** — live in global env vars (`ADMIN_CHANNEL_IDS`, `TRUSTED_USER_IDS`,
`CATCHER_ROLE_ID`, `MONITORED_CHANNEL_IDS`) and are therefore shared across every
guild. A new server cannot self-configure; it requires the owner to edit env and
redeploy.

Two latent bugs compound this:
- `onMessage.ts:33` returns early when the `metadata` toggle is off — which silently
  kills the security path too. A server that turns off metadata loses anti-scam.
- `security` is not present in the `DEFAULTS` map, so `/settings view` renders it as
  ❌ even though it defaults to on in code.

Separately, `ALLOWED_GUILD_IDS` is parsed in `config.ts` but **never enforced** —
there is no `GuildCreate` handler, so the bot runs in any server that adds it. This
is a cost-control exposure on Railway hosting.

## Goals

- A server's own admins self-serve all per-guild settings via an interactive
  `/settings` panel — no owner involvement, no redeploy.
- Moderation/anti-scam is the primary, easy-to-reach section. AI commands remain in
  the bot but are clearly secondary/optional. Plain, neutral labels — no marketing
  copy.
- The bot owner retains control of secrets/infra and of **which servers** the bot
  runs in.

## Non-Goals (YAGNI)

- Numeric threshold tuning or strictness presets (base-minimum anti-scam thresholds
  stay as in-code defaults).
- Per-guild API keys.
- A web dashboard.

## The Owner / Admin Boundary (organizing principle)

| Layer | Where it lives | Who controls it |
|-------|----------------|-----------------|
| Bot token, API keys, R2 creds, `ALLOWED_GUILD_IDS` | env / Railway secrets | Bot owner |
| Feature toggles, security on/off, alert channel, trusted roles/users, monitored channels, catcher role | per-guild storage (`guild_settings.json`) | Server admins (ManageGuild) |

Onboarding an *allowlisted* server requires zero owner involvement.

## Design

### 1. Per-guild config store (schema upgrade — `src/lib/guild-settings.ts`)

Extend each guild's entry from boolean-only to a structured shape:

```jsonc
{
  "_defaults": { "...": "unchanged boolean defaults, plus security: true" },
  "<guildId>": {
    "toggles": { "metadata": true, "security": true, "ask": false, "...": false },
    "moderation": {
      "alertChannelId":      "123",        // string | null
      "trustedRoleIds":      ["456"],      // string[]
      "trustedUserIds":      ["789"],      // string[]
      "monitoredChannelIds": ["..."],      // string[]
      "catcherRoleId":       null          // string | null
    }
  }
}
```

**Backward compatibility & migration:**
- The existing boolean API (`getGuildSetting` / `setGuildSetting` / `getAllGuildSettings`)
  is preserved and now backed by `toggles`.
- On load, if a guild entry is in the old flat boolean shape, migrate it in-memory
  into `{ toggles: {...} }` (and persist on next write).
- Add `security: true` to `DEFAULTS` (bug fix #2).

**New typed accessors:**
- `getModeration(guildId): ResolvedModConfig` — resolves each field with **env
  fallback**: per-guild value if set, else the corresponding global env value
  (`ADMIN_CHANNEL_IDS`, `TRUSTED_USER_IDS`, `CATCHER_ROLE_ID`,
  `MONITORED_CHANNEL_IDS`). This means the owner's existing main server keeps working
  untouched, and a brand-new allowlisted guild inherits the env baseline until its
  admins override it.
- Setters for each moderation field (`setAlertChannel`, `setTrustedRoles`,
  `setMonitoredChannels`, `setCatcherRole`, etc.).

`ResolvedModConfig` is a plain object: `{ alertChannelIds: Set<string>,
trustedRoleIds: Set<string>, trustedUserIds: Set<string>, monitoredChannelIds:
Set<string>, catcherRoleId: string | null }`.

### 2. Wire per-guild moderation into the security path

`security.ts` currently imports global constants directly. Refactor the affected
functions to accept a resolved `ModConfig` argument (dependency injection) rather
than reading globals:
- `alertAdmins(...)` → uses per-guild `alertChannelIds`.
- `isTrusted(message, cfg)` → trusted users **and trusted roles** (new capability;
  today it is user-ID only) plus guild owner.
- `calculateScamScore(message, cfg)` → catcher-role check uses per-guild
  `catcherRoleId`.

`onMessage.ts` resolves `getModeration(guildId)` once per message and threads it
through. The monitored-channel filter (`onMessage.ts:32`) reads per-guild
`monitoredChannelIds`.

`onJoin.ts` (`GuildMemberAdd` registry alert) also routes to the per-guild alert
channel via the same resolver.

### 3. Bug fixes (folded into the work above)

- **Decouple security from metadata:** restructure `onMessage` so the `security`
  toggle gates the security block and the `metadata` toggle gates metadata
  processing, independently. Turning off one must not disable the other.
- **`security` in `DEFAULTS`:** added in §1.

### 4. Interactive `/settings` panel (`src/commands/settings.ts`)

- `/settings` → ephemeral reply, gated on `PermissionFlagsBits.ManageGuild`
  (existing gate retained). Keep `view` / `set` subcommands as thin fallbacks or
  remove in favor of the panel (decision: keep a text `view` for accessibility; panel
  is the default `/settings` with no subcommand).
- **Three tiers** (metadata is AI-image metadata, so it groups with AI; Fun stands
  alone):
  - **MODERATION** (primary): anti-scam on/off, alert channel, trusted roles,
    monitored channels.
  - **AI & METADATA**: per-feature toggles for `metadata`, `ask`, `describe`,
    `coder`, `techsupport`, `promptsupport`.
  - **FUN**: per-feature toggles for `fun_commands`, `interact`, `qotd`.
- **Paged layout (required by Discord's 5-action-row limit):** Moderation alone uses
  4 component rows, so all three tiers cannot share one screen. The panel is paged:
  - The **embed always shows a summary** of all three tiers' current state (so the
    admin sees everything at a glance).
  - A **navigation row** of buttons `[Moderation] [AI & Metadata] [Fun]` is always
    present (row 1). Clicking one swaps the interactive controls below to that page
    and re-renders.
  - **Moderation page** (nav + 4 = 5 rows, at the limit): anti-scam ON/OFF toggle
    button, `ChannelSelectMenu` (single) alert channel, `RoleSelectMenu` (multi)
    trusted roles, `ChannelSelectMenu` (multi) monitored channels (empty = all).
  - **AI & Metadata page** (nav + 1): `StringSelectMenu` (multi) — selected = enabled.
  - **Fun page** (nav + 1): `StringSelectMenu` (multi) — selected = enabled.
- **Interaction handling:** a **component collector** attached to the ephemeral reply,
  filtered to the invoking admin, ManageGuild-gated, ~5 min idle timeout. The global
  interaction router (`commands/index.ts`) is **not** modified — the collector is
  self-contained, avoiding stale `customId` routing. Each component interaction
  (page switch or value change) mutates per-guild config and re-renders via
  `update()`. The active page is tracked in collector-local state.
- **Copy:** plain neutral labels — "Anti-scam protection", "Alert channel", "Trusted
  roles", "Monitored channels", "AI commands", "Fun commands". Factual descriptions,
  no marketing language.

### 5. Allowlist gate (`ALLOWED_GUILD_IDS`)

- New `GuildCreate` handler: when `ALLOWED_GUILD_IDS` is **non-empty** and the joined
  guild is not on the list, the bot leaves immediately and logs it.
- On `ClientReady` startup: when the list is non-empty, sweep current guilds and leave
  any not allowlisted (log each).
- **Hard guard:** if `ALLOWED_GUILD_IDS` is empty, the gate is fully inert — never
  leaves any guild (today's open behavior). This prevents an unset env var from
  causing a mass-leave.
- This is owner-controlled (env), not exposed to admins.

## Operational Notes

- **Before deploying with the allowlist:** add BOTH the owner's main server ID and the
  FFXIV server ID to `ALLOWED_GUILD_IDS`, or the startup sweep will make the bot leave
  them.
- **Renaming the bot is safe:** the token is tied to the application/bot ID, not its
  name. Changing the application name, bot username (rate-limited ~2/hour), or a
  per-server nickname does not affect the token or functionality. No code keys off the
  bot's name (only `bot.ts:28` logs `c.user.tag`).

## Data Flow (after change)

```text
message → onMessage
        → getModeration(guildId)  [per-guild, env fallback]
        → if security toggle: security checks use ModConfig (alert chan, trust, catcher)
        → if metadata toggle: metadata extraction  [independent of security]

/settings → ephemeral paged panel (ManageGuild): Moderation | AI & Metadata | Fun
          → component collector (invoker-filtered, 5 min)
          → nav buttons switch page; setters mutate guild_settings.json → re-render

bot added to guild → GuildCreate → not allowlisted? leave (if list non-empty)
startup → sweep guilds → leave non-allowlisted (if list non-empty)
```

## Testing / Validation

The repo now includes a vitest suite (`npm test`) covering the pure logic (migration,
env-fallback resolution, the store, security scorers, the allowlist guard, and
settings-panel render). Validate the Discord-facing behavior by running the bot and
observing:
1. `/settings` opens the panel; toggles and select menus flip state and persist to
   `guild_settings.json`.
2. Anti-scam still fires with the `metadata` toggle **off** (decoupling verified).
3. Security alerts land in the per-guild alert channel set via the panel.
4. `security` shows its true state in the panel/view (not a false ❌).
5. With `ALLOWED_GUILD_IDS` set, the bot leaves a test non-allowlisted guild on join;
   with it empty, the bot stays everywhere.
6. Existing main server (config via env only, nothing set per-guild) behaves exactly
   as before (env-fallback verified).

## Files Touched

- `src/lib/guild-settings.ts` — schema upgrade, migration, `getModeration` + setters,
  `security` default.
- `src/lib/security.ts` — `ModConfig` injection into `isTrusted`, `calculateScamScore`,
  `alertAdmins`.
- `src/events/onMessage.ts` — resolve ModConfig, decouple security/metadata gating,
  per-guild monitored channels.
- `src/events/onJoin.ts` — per-guild alert routing.
- `src/commands/settings.ts` — interactive panel + collector.
- `src/events/index.ts` (or `bot.ts`) — `GuildCreate` handler + startup allowlist
  sweep.
- `src/lib/config.ts` — no schema change; `ALLOWED_GUILD_IDS` now consumed.
