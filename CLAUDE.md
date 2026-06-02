# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run the bot (dev, via ts-node)
npm run dev

# Build (tsc → dist/) then run compiled
npm run build
npm start

# Tests (vitest)
npm test          # vitest run
npm run test:watch
```

Pure logic (guild settings, moderation resolution, allowlist, settings-panel render,
security scorers) is unit-tested under vitest; Discord I/O (event handlers, the
`/settings` collector, the allowlist `GuildCreate` handler) is validated by running the
bot and observing logs.

> Note: the Architecture section below still describes the original Python layout
> (`bot/`, `dataset_tools/`, `main.py`). The project has since been migrated to
> TypeScript under `src/` (`src/bot.ts`, `src/commands/`, `src/events/`, `src/lib/`).
> This section is pending a refresh.

## Architecture

**PromptInspectorBot** is a Discord bot that extracts AI image generation metadata (Forge/A1111, ComfyUI, SwarmUI, etc.) from PNG attachments and displays it via emoji reactions or slash commands.

### Two-layer structure

1. **`bot/`** — Discord interface layer
   - `main.py` → creates `commands.Bot`, calls `register_events()` and `register_commands()`
   - `bot/config.py` — single source of truth for all configuration; loaded first by every other module. Reads from `.env` + `config.toml` (env vars take precedence). Exports clients (`gemini_client`, `claude_client`, `r2_client`), rate limiters, and shared async state.
   - `bot/event_handlers.py` — `on_message` (security checks → metadata parsing → reaction posting) and `on_raw_reaction_add` (serve cached metadata when a user clicks a numbered emoji)
   - `bot/commands/` — slash command modules by category: `metadata`, `ai`, `fun`, `management`, `upload`, `context_menu`
   - `bot/security.py` — wallet-scam scoring, cross-posting detection, magic bytes check, instant-ban logic
   - `bot/guild_settings.py` — per-server feature toggles persisted to `guild_settings.json`
   - `bot/metadata_helpers.py` — bridges `dataset_tools.metadata_parser.parse_metadata()` to Discord-friendly dicts
   - `bot/ui_components.py` — Discord `View`/`Button` components for interactive metadata display

2. **`dataset_tools/`** — standalone metadata parsing library (vendored/extended)
   - `metadata_parser.py` → top-level entry point; returns a UI-dict keyed by section (`prompt_data_section`, `generation_parameters_section`, etc.)
   - `metadata_engine/engine.py` — orchestrates parser selection, rule evaluation, field extraction, and template rendering
   - `metadata_engine/extractors/` — 30+ specialized ComfyUI node extractors (FLUX, AnimateDiff, PixArt, Griptape, etc.)
   - `vendored_sdpr/` — vendored `sd-prompt-reader` parsers for A1111/Forge, NovelAI, DrawThings, InvokeAI, SwarmUI, and others
   - `numpy_scorers/` — heuristic scorers that rank candidate metadata when multiple parsers match
   - `file_readers/` — raw image/text readers that feed bytes into the engine

### Key data flow

```
PNG bytes → dataset_tools.metadata_parser.parse_metadata()
         → MetadataEngine selects parser, extracts fields
         → returns UI-dict
         → bot/metadata_helpers.transform_ui_dict_to_simple_format()
         → Discord embed / View
```

### Configuration resolution order

`bot/config.py` always tries env var first, then `config.toml`, then a default. Copy `config.example.toml` → `config.toml` and set at minimum `BOT_TOKEN` in `.env`.

### Feature flags

Per-server features (`metadata`, `describe`, `ask`, `coder`, `techsupport`, `fun_commands`, `qotd`, `interact`) are toggled at runtime via `/settings` and stored in `guild_settings.json`. Global defaults live in `bot/guild_settings.py::load_guild_settings`.

### LLM providers

Both Gemini (`google-genai`) and Claude (`anthropic`) are optional. `bot/config.py` auto-detects available providers from API keys and respects `LLM_PROVIDER_PRIORITY`. Set `NSFW_PROVIDER_OVERRIDE=claude` to bypass Gemini's safety filters for artistic content.

### Cloudflare R2 (optional)

JPEG/WebP uploads work through a pre-signed URL flow: bot generates a presigned upload URL → `UPLOADER_URL` (a Cloudflare Pages HTML file) handles the browser-side upload → metadata is extracted server-side. Requires five env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `UPLOADER_URL`).

### Linting

`ruff.toml` selects ALL rules with a large ignore list. Line-length (`E501`) and complexity (`C901`, `PLR*`) rules are suppressed. Run `ruff check .` before committing.
