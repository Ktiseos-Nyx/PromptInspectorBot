"""Metadata Helpers - Image metadata extraction and formatting

Handles parsing image metadata using dataset-tools library and formatting
results for display in Discord.
"""
import asyncio
import aiohttp
from pathlib import Path
from typing import Any, Dict, Optional

import discord

from .config import logger, SCAN_LIMIT_BYTES
from .security import is_valid_image
from dataset_tools.metadata_parser import parse_metadata

# ============================================================================
# METADATA TRANSFORMATION
# ============================================================================

def transform_ui_dict_to_simple_format(ui_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Transform UI dict format from parse_metadata to simple Discord format.

    Converts from:
        {'prompt_data_section': {...}, 'generation_parameters_section': {...}, ...}
    To:
        {'tool': '...', 'prompt': '...', 'parameters': {...}}
    """
    simple = {}

    # Extract tool name
    metadata_section = ui_dict.get("metadata_info_section", {})
    simple["tool"] = metadata_section.get("Detected Tool", "Unknown")
    simple["format"] = metadata_section.get("format", "")

    # Extract prompts
    prompt_section = ui_dict.get("prompt_data_section", {})
    simple["prompt"] = prompt_section.get("Positive", "")
    simple["negative_prompt"] = prompt_section.get("Negative", "")

    # Extract parameters
    simple["parameters"] = ui_dict.get("generation_parameters_section", {})

    # Include raw metadata for JSON button
    simple["raw_metadata"] = ui_dict.get("raw_tool_specific_data_section", {})

    return simple

# ============================================================================
# PLURALKIT PROXY DETECTION
# ============================================================================

async def get_real_author(message: discord.Message, bot=None) -> discord.User:
    """Get the real author of a message, accounting for PluralKit proxies.

    If the message is from a PluralKit webhook, queries the PluralKit API
    to find the actual user who sent it.

    Args:
        message: Discord message
        bot: Bot instance (needed to fetch users)

    Returns:
        Real author (either original author or PluralKit sender)

    """
    # If not a webhook, just return the author
    if not message.webhook_id:
        return message.author

    # Try to query PluralKit API
    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://api.pluralkit.me/v2/messages/{message.id}"
            async with session.get(url, timeout=5) as response:
                if response.status == 200:
                    data = await response.json()
                    # Get the real sender's Discord ID
                    sender_id = data.get("sender")
                    if sender_id and bot:
                        # Fetch the actual Discord user
                        real_user = await bot.fetch_user(int(sender_id))
                        if real_user:
                            logger.info("🔄 PluralKit: Resolved webhook to real user %s", real_user.name)
                            return real_user
                elif response.status == 404:
                    # Not a PluralKit message, just a regular webhook
                    logger.debug("Webhook message but not from PluralKit")
    except asyncio.TimeoutError:
        logger.warning("PluralKit API timeout")
    except Exception as e:
        logger.debug("PluralKit API query failed: %s", e)

    # Fallback: return original author (webhook user)
    return message.author

# ============================================================================
# METADATA FORMATTING
# ============================================================================

def format_public_metadata_message(metadata: Dict[str, Any], author: discord.User) -> str:
    """Format metadata as collapsible spoiler message for public channels.

    Args:
        metadata: Metadata dict from parser
        author: Original message author

    Returns:
        Formatted message string with spoilers

    """
    lines = [f"🔎 **Metadata Found!** (Posted by {author.mention})"]

    # Tool info
    tool = metadata.get("tool", "Unknown")
    format_name = metadata.get("format", "")
    if format_name and format_name != tool:
        lines.append(f"*{tool} - {format_name}*\n")
    else:
        lines.append(f"*{tool}*\n")

    # Prompts section (collapsible)
    prompt = metadata.get("prompt")
    negative_prompt = metadata.get("negative_prompt")

    if prompt or negative_prompt:
        prompt_lines = ["**📝 Prompts:**"]
        if prompt:
            # Truncate if too long (Discord has 2000 char limit)
            prompt_text = str(prompt)
            if len(prompt_text) > 500:
                prompt_text = prompt_text[:500] + "... (truncated, click DM button for full)"
            prompt_lines.append(f"||**Positive:** {prompt_text}||")

        if negative_prompt:
            neg_text = str(negative_prompt)
            if len(neg_text) > 300:
                neg_text = neg_text[:300] + "... (truncated)"
            prompt_lines.append(f"||**Negative:** {neg_text}||")

        lines.append("\n".join(prompt_lines))

    # Settings section (collapsible)
    parameters = metadata.get("parameters", {})
    if parameters:
        settings_lines = ["\n**⚙️ Settings:**"]
        settings_text = []

        # Check for manual user_settings field (from manual entry)
        user_settings = parameters.get("user_settings")
        if user_settings:
            # User-provided freeform settings
            settings_lines.append(f"||{user_settings}||")
        else:
            # Priority settings (auto-extracted metadata)
            priority_keys = ["model", "steps", "sampler_name", "cfg_scale", "seed", "width", "height"]
            for key in priority_keys:
                value = parameters.get(key)
                if value is not None:
                    if key == "width" and "height" in parameters:
                        settings_text.append(f"Resolution: {parameters['width']}x{parameters['height']}")
                        break  # Skip height, we showed both
                    if key == "height":
                        continue  # Already showed with width
                    display_key = key.replace("_", " ").title()
                    settings_text.append(f"{display_key}: {value}")

            if settings_text:
                settings_lines.append(f"||{' • '.join(settings_text)}||")

        if len(settings_lines) > 1:  # Has content beyond header
            lines.append("\n".join(settings_lines))

    lines.append("\n*Click buttons below for more details!*")

    return "\n".join(lines)

# ============================================================================
# METADATA PARSING
# ============================================================================

async def parse_image_metadata(image_data: bytes, filename: str = None) -> Optional[Dict[str, Any]]:
    """Parse metadata from image using Dataset-Tools library.

    Uses direct import of dataset_tools.metadata_parser module.
    Runs in a thread pool to avoid blocking the async event loop.

    Args:
        image_data: Raw image bytes
        filename: Original filename (to preserve extension)

    Returns:
        Metadata dict or None if no metadata found

    """
    if not is_valid_image(image_data):
        return None

    # Save to temp file for Dataset-Tools parser
    # Preserve the file extension for proper format detection
    if filename and "." in filename:
        ext = Path(filename).suffix  # .png, .jpg, etc.
    else:
        ext = ".png"  # Default to PNG
    temp_path = Path(f"/tmp/discord_image_{id(image_data)}{ext}")
    try:
        with open(temp_path, "wb") as f:
            f.write(image_data)

        # Call parse_metadata in a thread to avoid blocking
        ui_dict = await asyncio.to_thread(
            parse_metadata,
            str(temp_path),
        )

        if not ui_dict or not isinstance(ui_dict, dict):
            logger.warning("Parser returned empty or invalid result for %s", temp_path.name)
            return None

        # Transform UI dict to simple format for Discord
        metadata_dict = transform_ui_dict_to_simple_format(ui_dict)

        logger.debug("Successfully parsed metadata for %s - found %s", temp_path.name, metadata_dict.get("tool", "Unknown"))
        return metadata_dict

    except Exception as e:
        logger.error("Error parsing metadata: %s", e)
        return None
    finally:
        # Cleanup temp file
        if temp_path.exists():
            temp_path.unlink()
