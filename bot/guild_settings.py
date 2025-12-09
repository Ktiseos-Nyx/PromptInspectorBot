"""Guild Settings System - Per-Server Configuration

Manages server-specific feature toggles stored in guild_settings.json
"""
import json
from pathlib import Path

from .config import logger

# ============================================================================
# GUILD SETTINGS SYSTEM
# ============================================================================

GUILD_SETTINGS_FILE = Path("guild_settings.json")

def load_guild_settings() -> dict:
    """Load guild settings from JSON file."""
    if not GUILD_SETTINGS_FILE.exists():
        return {"_defaults": {
            "ask": False,
            "metadata": True,
            "describe": True,
            "techsupport": False,
            "coder": False,
            "fun_commands": True,
            "qotd": False,
            "interact": True,
        }}

    try:
        with open(GUILD_SETTINGS_FILE) as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading guild settings: {e}")
        return {"_defaults": {}}

def save_guild_settings(settings: dict):
    """Save guild settings to JSON file."""
    try:
        with open(GUILD_SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving guild settings: {e}")

def get_guild_setting(guild_id: int, setting: str, default: bool = None) -> bool:
    """Get a specific setting for a guild, falling back to defaults.

    Args:
        guild_id: Discord guild ID
        setting: Setting name (e.g. 'ask', 'metadata', 'describe')
        default: Default value if not found (overrides _defaults)

    Returns:
        Boolean setting value

    """
    settings = load_guild_settings()
    guild_id_str = str(guild_id)

    # Check guild-specific setting
    if guild_id_str in settings and setting in settings[guild_id_str]:
        return settings[guild_id_str][setting]

    # Fall back to defaults
    if "_defaults" in settings and setting in settings["_defaults"]:
        return settings["_defaults"][setting]

    # Final fallback
    return default if default is not None else False

def set_guild_setting(guild_id: int, setting: str, value: bool):
    """Set a specific setting for a guild.

    Args:
        guild_id: Discord guild ID
        setting: Setting name
        value: Boolean value to set

    """
    settings = load_guild_settings()
    guild_id_str = str(guild_id)

    # Initialize guild settings if not exists
    if guild_id_str not in settings:
        settings[guild_id_str] = {}

    settings[guild_id_str][setting] = value
    save_guild_settings(settings)
    logger.info(f"Guild {guild_id}: Set {setting} = {value}")

def get_all_guild_settings(guild_id: int) -> dict:
    """Get all settings for a guild, with defaults filled in.

    Returns:
        Dictionary of all settings for the guild

    """
    settings = load_guild_settings()
    guild_id_str = str(guild_id)
    defaults = settings.get("_defaults", {})
    guild_specific = settings.get(guild_id_str, {})

    # Merge defaults with guild-specific (guild-specific overrides)
    return {**defaults, **guild_specific}
