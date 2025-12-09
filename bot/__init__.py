"""PromptInspectorBot-Enhanced - Modular Discord Bot

This package contains the core bot functionality split into logical modules.

Structure:
- config.py: Configuration and initialization
- guild_settings.py: Per-server settings
- qotd.py: Question of the Day system
- security.py: Anti-scam detection
- metadata_helpers.py: Metadata extraction utilities
- ai_providers.py: Gemini & Claude integration
- ui_components.py: Discord UI (modals, views)
- event_handlers.py: Discord event handlers
- commands/: Slash command implementations

Usage:
    from bot.config import logger, BOT_TOKEN
    from bot.event_handlers import register_events
    from bot.commands import register_commands

    bot = commands.Bot(command_prefix="!", intents=intents)
    register_events(bot)
    register_commands(bot)
    bot.run(BOT_TOKEN)
"""

__version__ = "2.0.0"
__author__ = "Ktiseos Nyx"
