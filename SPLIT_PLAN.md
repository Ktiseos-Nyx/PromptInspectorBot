# bot_enhanced.py Splitting Plan

**Date:** 2025-12-07
**Current Size:** 3,570 lines (38,510 tokens)
**Target:** Split into 8-10 modules of ~300-500 lines each

## Issues Found (ruff damage)

### Duplicate Imports
1. **Line 503:** `import re` (duplicate of line 24) - REMOVE THIS
2. **Lines 390, 398, 520, 769, 2081, 2161, 2518, 2712, 3191, 3549, 3562:**
   Function-level imports of `random`, `time`, `hashlib`, `datetime`, `base64`
   - These are redundant since already imported at top
   - CAN remove them, but not urgent (won't break anything)

## Proposed Module Structure

### Module 1: `bot/config.py` (Lines 1-235)
**Purpose:** Configuration loading and initialization
**Contents:**
- Environment variable loading
- TOML config parsing
- ID list parsing (`parse_id_list`, `parse_channel_features`)
- Bot constants (emojis, limits, etc.)
- LLM provider configuration
- R2 configuration
- Logger setup
- Rate limiter initialization

**Exports:**
```python
# Configuration
BOT_TOKEN, GEMINI_API_KEY, ANTHROPIC_API_KEY
ALLOWED_GUILD_IDS, MONITORED_CHANNEL_IDS
CHANNEL_FEATURES
EMOJI_FOUND, EMOJI_NOT_FOUND
SCAN_LIMIT_BYTES

# LLM Config
gemini_client, claude_client
GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODELS
CLAUDE_PRIMARY_MODEL, CLAUDE_FALLBACK_MODELS
LLM_PROVIDER_PRIORITY, NSFW_PROVIDER_OVERRIDE

# R2 Config
R2_ENABLED, r2_client, R2_UPLOAD_EXPIRATION

# Utilities
logger
rate_limiter, gemini_rate_limiter
```

---

### Module 2: `bot/guild_settings.py` (Lines 236-331)
**Purpose:** Per-server configuration system
**Contents:**
- `load_guild_settings()`
- `save_guild_settings()`
- `get_guild_setting()`
- `set_guild_setting()`
- `get_all_guild_settings()`

**Exports:**
```python
load_guild_settings, save_guild_settings
get_guild_setting, set_guild_setting
get_all_guild_settings
```

**Imports Needed:**
```python
import json
from pathlib import Path
from .config import logger
```

---

### Module 3: `bot/qotd.py` (Lines 333-443)
**Purpose:** Question of the Day management
**Contents:**
- `load_qotd_data()`
- `save_qotd_data()`
- `get_random_qotd()`
- `mark_qotd_used()`
- `add_qotd_question()`
- `get_qotd_stats()`

**Exports:**
```python
load_qotd_data, save_qotd_data
get_random_qotd, mark_qotd_used
add_qotd_question, get_qotd_stats
```

**Imports Needed:**
```python
import json
import random
import time
from pathlib import Path
from .config import logger
```

---

### Module 4: `bot/security.py` (Lines 445-862)
**Purpose:** Anti-scam detection and security
**Contents:**
- Message tracking and fingerprinting
- Cross-posting detection
- Gibberish/spam text analysis
- Wallet scam scoring
- Image safety verification
- Auto-ban system
- Admin alerting

**Functions:**
- `get_message_fingerprint()`
- `track_message()`
- `check_cross_posting()`
- `is_gibberish_or_spam()`
- `calculate_wallet_scam_score()`
- `verify_image_safety()`
- `instant_ban()`
- `delete_all_user_messages()`
- `alert_admins()`

**Exports:**
```python
get_message_fingerprint, track_message
check_cross_posting
is_gibberish_or_spam
calculate_wallet_scam_score
verify_image_safety
instant_ban, delete_all_user_messages
alert_admins

# Data structures
user_recent_messages
CRYPTO_SCAM_PATTERNS
```

**Imports Needed:**
```python
import re
import hashlib
import datetime
from typing import Dict
import discord
from PIL import Image
from .config import (
    logger,
    CATCHER_ROLE_ID,
    TRUSTED_USER_IDS,
    ADMIN_CHANNEL_IDS,
    DM_RESPONSE_MESSAGE,
)
```

---

### Module 5: `bot/metadata_helpers.py` (Lines 863-1073)
**Purpose:** Metadata extraction and processing
**Contents:**
- JSON formatting
- Image validation
- Metadata transformation
- PluralKit detection
- Message formatting
- Metadata parsing

**Functions:**
- `reformat_json()`
- `is_valid_image()`
- `transform_ui_dict_to_simple_format()`
- `get_real_author()`
- `format_public_metadata_message()`
- `parse_image_metadata()`

**Exports:**
```python
reformat_json
is_valid_image
transform_ui_dict_to_simple_format
get_real_author
format_public_metadata_message
parse_image_metadata
```

**Imports Needed:**
```python
import json
import re
from typing import Any, Dict, Optional
import discord
from PIL import Image
from dataset_tools.metadata_parser import parse_metadata
from utils.discord_formatter import create_full_metadata_text
from .config import logger, SCAN_LIMIT_BYTES
```

---

### Module 6: `bot/ai_providers.py` (Lines 2596-2862)
**Purpose:** AI integration (Gemini & Claude)
**Contents:**
- Gemini retry logic
- Claude image description
- Image optimization for APIs
- PluralKit name fetching

**Functions:**
- `call_gemini_with_retry()`
- `ask_gemini()`
- `describe_image_with_claude()`
- `optimize_image_for_api()`
- `get_pluralkit_name()`

**Exports:**
```python
call_gemini_with_retry
ask_gemini
describe_image_with_claude
optimize_image_for_api
get_pluralkit_name
```

**Imports Needed:**
```python
import base64
import io
import json
import asyncio
import aiohttp
import discord
from PIL import Image
from google.genai import types
from .config import (
    logger,
    gemini_client,
    claude_client,
    GEMINI_PRIMARY_MODEL,
    GEMINI_FALLBACK_MODELS,
    GEMINI_MAX_RETRIES,
    GEMINI_RETRY_DELAY,
    CLAUDE_PRIMARY_MODEL,
    NSFW_PROVIDER_OVERRIDE,
)
```

---

### Module 7: `bot/ui_components.py` (Lines 2931-3179)
**Purpose:** Discord UI (Modals & Views)
**Contents:**
- Manual metadata modal
- Button views for metadata display
- R2 upload rate limiting

**Classes:**
- `ManualMetadataModal`
- `ManualEntryPromptView`
- `PublicMetadataView`
- `FullMetadataView`

**Functions:**
- `check_upload_rate_limit()`

**Exports:**
```python
ManualMetadataModal
ManualEntryPromptView
PublicMetadataView
FullMetadataView
check_upload_rate_limit
```

**Imports Needed:**
```python
import io
import json
import time
from typing import Any, Dict
import discord
from utils.discord_formatter import (
    create_full_metadata_text,
    format_metadata_embed,
)
from .config import logger
from .metadata_helpers import (
    get_real_author,
    format_public_metadata_message,
)
```

---

### Module 8: `bot/event_handlers.py` (Lines 1074-1522, 3440-3570)
**Purpose:** Discord event handlers
**Contents:**
- `on_message()` - Main message handler
- `on_raw_reaction_add()` - Reaction handler
- `on_ready()` - Bot startup
- `on_guild_join()` - Server join
- `on_close()`, `on_disconnect()`, `on_resumed()` - Lifecycle

**Exports:**
```python
def register_events(bot):
    # Registers all event handlers
```

**Imports Needed:**
```python
import asyncio
import discord
from discord.ext import commands
from .config import (
    logger,
    ALLOWED_GUILD_IDS,
    MONITORED_CHANNEL_IDS,
    CHANNEL_FEATURES,
    EMOJI_FOUND,
    EMOJI_NOT_FOUND,
    DM_ALLOWED_USER_IDS,
    DM_RESPONSE_MESSAGE,
)
from .security import (
    track_message,
    check_cross_posting,
    calculate_wallet_scam_score,
    instant_ban,
    alert_admins,
)
from .metadata_helpers import (
    parse_image_metadata,
    get_real_author,
    format_public_metadata_message,
)
from .ui_components import (
    PublicMetadataView,
    ManualEntryPromptView,
)
```

---

### Module 9: `bot/commands/__init__.py`
**Purpose:** Command registration
**Contents:**
- Import all command modules
- Register commands with bot

---

### Module 10: `bot/commands/metadata.py` (Lines ~1528-1598)
**Purpose:** Metadata slash commands
**Contents:**
- `/metadata` command

---

### Module 11: `bot/commands/ai.py` (Lines ~1599-2045)
**Purpose:** AI slash commands
**Contents:**
- `/ask`
- `/techsupport`
- `/coder`
- `/describe`

---

### Module 12: `bot/commands/fun.py` (Lines ~2046-2337)
**Purpose:** Fun/community commands
**Contents:**
- `/decide`
- `/poll`
- `/wildcard`
- `/interact`

---

### Module 13: `bot/commands/management.py` (Lines ~2215-2476)
**Purpose:** Management commands
**Contents:**
- `/settings`
- `/qotd`
- `/qotd_add`

---

### Module 14: `bot/commands/upload.py` (Lines ~3180-3439)
**Purpose:** R2 upload command
**Contents:**
- `/upload_image`

---

### Module 15: `bot/commands/context_menu.py` (Lines ~2863-2930)
**Purpose:** Context menu commands
**Contents:**
- `view_prompt_context` (right-click menu)

---

### Module 16: `main.py` or `bot_enhanced.py` (NEW)
**Purpose:** Entry point
**Contents:**
```python
import discord
from discord.ext import commands

from bot.config import BOT_TOKEN, logger, intents
from bot.event_handlers import register_events
from bot.commands import register_commands

bot = commands.Bot(command_prefix="!", intents=intents)

# Register event handlers
register_events(bot)

# Register commands
register_commands(bot)

def main():
    logger.info("🚀 Starting PromptInspectorBot Enhanced")
    bot.run(BOT_TOKEN)

if __name__ == "__main__":
    main()
```

---

## File Structure After Split

```
PromptInspectorBot/
├── main.py                      # Entry point (50 lines)
├── bot/
│   ├── __init__.py
│   ├── config.py                # Configuration (200 lines)
│   ├── guild_settings.py        # Guild settings (100 lines)
│   ├── qotd.py                  # QOTD system (120 lines)
│   ├── security.py              # Security system (400 lines)
│   ├── metadata_helpers.py      # Metadata utils (220 lines)
│   ├── ai_providers.py          # AI integration (300 lines)
│   ├── ui_components.py         # UI components (300 lines)
│   ├── event_handlers.py        # Event handlers (500 lines)
│   └── commands/
│       ├── __init__.py          # Command registration (50 lines)
│       ├── metadata.py          # Metadata commands (100 lines)
│       ├── ai.py                # AI commands (500 lines)
│       ├── fun.py               # Fun commands (350 lines)
│       ├── management.py        # Management commands (300 lines)
│       ├── upload.py            # Upload command (300 lines)
│       └── context_menu.py      # Context menus (100 lines)
├── utils/
│   ├── security.py              # Already exists
│   └── discord_formatter.py     # Already exists
└── dataset_tools/               # Already exists

Total: ~3,600 lines (same as before, just organized!)
```

## Migration Strategy

### Phase 1: Create Module Skeleton
1. Create `bot/` directory
2. Create empty module files
3. Create `__init__.py` files

### Phase 2: Extract Configuration (Safest First)
1. Move `config.py` content
2. Update imports in `bot_enhanced.py` to use `from bot.config import ...`
3. Test bot still runs

### Phase 3: Extract Data Systems
1. Move `guild_settings.py`
2. Move `qotd.py`
3. Update imports
4. Test bot still runs

### Phase 4: Extract Security
1. Move `security.py`
2. Update imports
3. Test bot still runs

### Phase 5: Extract Helpers
1. Move `metadata_helpers.py`
2. Move `ai_providers.py`
3. Update imports
4. Test bot still runs

### Phase 6: Extract UI
1. Move `ui_components.py`
2. Update imports
3. Test bot still runs

### Phase 7: Extract Commands
1. Create `commands/` directory
2. Move commands one by one
3. Update command registration
4. Test each command

### Phase 8: Extract Events
1. Move event handlers
2. Update event registration
3. Test bot still runs

### Phase 9: Cleanup
1. Remove duplicate imports (line 503, etc.)
2. Remove function-level imports
3. Final testing
4. Archive old `bot_enhanced.py` as `bot_enhanced.py.backup`

## Benefits

1. **Maintainability:** Easier to find and modify code
2. **Testing:** Can test modules independently
3. **Performance:** Faster imports, better code splitting
4. **Collaboration:** Multiple people can work on different modules
5. **Documentation:** Each module can have its own docstring
6. **IDE Support:** Better autocomplete and navigation
7. **Hot Reload:** Can reload individual modules without restarting bot
8. **Reduced Merge Conflicts:** Changes isolated to specific modules

## Risks & Mitigation

### Risk: Breaking imports
**Mitigation:** Test after each phase, keep backup of original file

### Risk: Circular imports
**Mitigation:** Keep clear dependency hierarchy:
- config → (used by all)
- helpers → (used by commands/events)
- commands/events → (top level, don't import from each other)

### Risk: Missing functions
**Mitigation:** Use architecture doc to verify all functions migrated

### Risk: Lost functionality
**Mitigation:** Test all commands after split:
- `/metadata`
- `/ask`
- `/describe`
- `/settings`
- `/qotd`
- Reaction handling
- Auto-metadata watching
- Security system

## Testing Checklist

After split, verify:
- [ ] Bot starts without errors
- [ ] All slash commands appear in Discord
- [ ] `/metadata` works on images
- [ ] 🔎 reaction works on images
- [ ] `/ask` works
- [ ] `/describe` works with all styles
- [ ] `/settings` shows/updates guild settings
- [ ] `/qotd` posts questions
- [ ] `/interact` works
- [ ] Security system detects scams
- [ ] DM whitelist works
- [ ] Auto-metadata watching works
- [ ] PluralKit detection works
- [ ] R2 upload works (if enabled)
- [ ] Manual metadata entry works
- [ ] View Prompt Context menu works

## Next Steps

1. Get user approval for this plan
2. Create backup: `cp bot_enhanced.py bot_enhanced.py.backup`
3. Execute Phase 1 (skeleton)
4. Execute phases 2-9 incrementally
5. Test thoroughly
6. Celebrate! 🎉
