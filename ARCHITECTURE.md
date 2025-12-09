# bot_enhanced.py Architecture Documentation

**Generated:** 2025-12-07
**Purpose:** Document structure before splitting to prevent function loss
**File Size:** 3,570 lines, 38,510 tokens

## Overview
This is a comprehensive Discord bot for AI image metadata inspection with support for:
- Emoji reactions (classic UX)
- Slash commands (modern UX)
- ComfyUI metadata extraction via dataset-tools
- Gemini & Claude AI integration
- Anti-scam security features
- Guild-specific settings
- QOTD (Question of the Day) system

## Current Structure

### 1. IMPORTS & CONFIGURATION (Lines 1-235)
**Dependencies:**
- discord.py (bot framework)
- dataset_tools (metadata parsing)
- google.genai (Gemini AI)
- anthropic (Claude AI)
- boto3 (R2/S3 storage)
- PIL (image processing)
- utils.security (rate limiting, sanitization)
- utils.discord_formatter (embed formatting)

**Configuration Loading:**
- Environment variables (.env)
- TOML config (config.toml)
- Guild settings (guild_settings.json)
- QOTD data (qotd.json)

**Key Variables:**
- Bot token, API keys (Gemini, Claude)
- Guild/channel whitelists
- LLM provider configuration
- R2 storage settings
- Rate limiters

### 2. GUILD SETTINGS SYSTEM (Lines 236-331)
**Functions:**
- `load_guild_settings()` - Load from JSON
- `save_guild_settings()` - Save to JSON
- `get_guild_setting()` - Get single setting with fallback
- `set_guild_setting()` - Update single setting
- `get_all_guild_settings()` - Get all settings for guild

**Settings Tracked:**
- ask, metadata, describe, techsupport, coder
- fun_commands, qotd, interact

### 3. QOTD SYSTEM (Lines 333-443)
**Functions:**
- `load_qotd_data()` - Load questions from JSON
- `save_qotd_data()` - Save questions to JSON
- `get_random_qotd()` - Pick unused question
- `mark_qotd_used()` - Mark question as used
- `add_qotd_question()` - Add new question
- `get_qotd_stats()` - Get pool statistics

**Data Structure:**
- questions: List of all questions
- used_questions: List of already-posted questions
- last_posted: Timestamp of last QOTD

### 4. SECURITY SYSTEM (Lines 445-862)
**Anti-Scam Detection:**
- Wallet scammers (crypto spam)
- Screenshot spammers (cross-posting)
- Gibberish text detection
- Image safety verification

**Functions:**
- `get_message_fingerprint()` - Hash message for duplicate detection
- `track_message()` - Track user messages for cross-post detection
- `check_cross_posting()` - Detect spam across channels
- `is_gibberish_or_spam()` - Text quality analysis
- `calculate_wallet_scam_score()` - Crypto scam scoring
- `verify_image_safety()` - Image validation
- `instant_ban()` - Auto-ban scammers
- `delete_all_user_messages()` - Cleanup after ban
- `alert_admins()` - Send security alerts

**Configuration:**
- CATCHER_ROLE_ID - Role for scam alerts
- TRUSTED_USER_IDS - Bypass security
- DM_ALLOWED_USER_IDS - DM whitelist
- ADMIN_CHANNEL_IDS - Security alerts

### 5. HELPER FUNCTIONS (Lines 863-1073)
**Utilities:**
- `reformat_json()` - JSON formatting
- `is_valid_image()` - Image validation
- `transform_ui_dict_to_simple_format()` - Metadata transformation
- `get_real_author()` - PluralKit proxy detection
- `format_public_metadata_message()` - Public message formatting
- `parse_image_metadata()` - Main metadata extraction

### 6. EVENT HANDLERS (Lines 1074-1522)
**Discord Events:**
- `on_message()` - Main message handler
  - DM handling with whitelist
  - Security checks (scam detection)
  - Auto-metadata watching for monitored channels
  - PluralKit proxy support

- `on_raw_reaction_add()` - Emoji reaction handler
  - 🔎 emoji triggers metadata extraction

- `on_ready()` - Bot startup
- `on_guild_join()` - New server join
- `on_close()` - Shutdown cleanup
- `on_disconnect()` - Disconnect handling
- `on_resumed()` - Reconnect handling

### 7. SLASH COMMANDS (Lines 1523-2870)
**Metadata Commands:**
- `/metadata` - Extract metadata from image

**AI Commands:**
- `/ask` - Ask Gemini/Claude a question
- `/techsupport` - Technical support help
- `/coder` - Coding assistance
- `/describe` - Describe image with AI (multiple styles)

**Fun Commands:**
- `/decide` - Random decision maker
- `/poll` - Create polls (yes/no or A/B)
- `/wildcard` - Random creative prompt

**Management Commands:**
- `/settings` - Configure guild settings
- `/qotd` - Post question of the day
- `/qotd_add` - Add QOTD question

**Social Commands:**
- `/interact` - Interact with users (hug, pat, etc.)

**Context Menu:**
- "View Prompt Context" - Right-click message context menu

### 8. UI COMPONENTS (Lines 2931-3179)
**Modal:**
- `ManualMetadataModal` - Manual metadata entry form

**Views (Button Interfaces):**
- `ManualEntryPromptView` - "Add Details" button
- `PublicMetadataView` - "Full Details (DM)" and "Save JSON" buttons
- `FullMetadataView` - "📄 View Full Metadata (Text)" button

### 9. R2 UPLOAD SYSTEM (Lines 3180-3439)
**Image Upload to Cloudflare R2:**
- `check_upload_rate_limit()` - Rate limiting with tier support
- `/upload_image` - Upload image command with pre-signed URLs

**Tier System:**
- Free tier: 2 uploads/hour, 5MB limit
- Early Supporter: 10 uploads/hour, 20MB limit

### 10. AI HELPER FUNCTIONS (Lines 2596-2862)
**Gemini Integration:**
- `call_gemini_with_retry()` - Retry logic with fallback models
- `ask_gemini()` - Question answering

**Claude Integration:**
- `describe_image_with_claude()` - Image description
- `optimize_image_for_api()` - Image optimization for API

**PluralKit:**
- `get_pluralkit_name()` - Get system member name

### 11. STARTUP & MAIN (Lines 3440-3570)
**Bot Lifecycle:**
- `on_close()` - Graceful shutdown
- `on_disconnect()` / `on_resumed()` - Connection handling
- `on_guild_join()` - Auto-leave unauthorized servers
- `on_ready()` - Command sync and startup
- `main()` - Entry point

## Function Count
- **Total Functions:** 59 (classes + functions)
- **Slash Commands:** 13
- **Event Handlers:** 7
- **UI Components:** 4 classes
- **Helper Functions:** ~35

## Import Dependencies
**External:**
- discord, discord.ext.commands, discord.app_commands
- google.genai, anthropic
- boto3, botocore
- PIL (Pillow)
- aiohttp

**Internal:**
- utils.security (RateLimiter, sanitize_text)
- dataset_tools.metadata_parser (parse_metadata)
- utils.discord_formatter (create_full_metadata_text, format_metadata_embed)

## Performance Concerns
1. **File Size:** 3,570 lines is too large for maintainability
2. **Token Size:** 38,510 tokens exceeds IDE/LLM context limits
3. **Coupling:** All features tightly coupled in one file
4. **Testing:** Hard to test individual components
5. **Hot Reload:** Changes require full bot restart

## Recommended Split
See `SPLIT_PLAN.md` for detailed module breakdown.
