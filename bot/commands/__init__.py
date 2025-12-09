"""Command modules for PromptInspectorBot

Contains all slash command implementations organized by category.

Categories:
- metadata.py: Image metadata extraction
- ai.py: AI-powered commands (ask, describe, etc.)
- fun.py: Community/fun commands
- management.py: Server management commands
- upload.py: R2 image upload
- context_menu.py: Right-click context menu commands
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from discord.ext import commands

def register_commands(bot: "commands.Bot"):
    """Register all commands with the bot.

    Args:
        bot: The Discord bot instance
    """
    # Import all command registration functions
    from .metadata import register_metadata_commands
    from .ai import register_ai_commands
    from .fun import register_fun_commands
    from .management import register_management_commands
    from .upload import register_upload_command
    from .context_menu import register_context_menus

    # Register all command categories
    register_metadata_commands(bot)
    register_ai_commands(bot)
    register_fun_commands(bot)
    register_management_commands(bot)
    register_upload_command(bot)
    register_context_menus(bot)
