"""PromptInspectorBot-Enhanced - Discord bot for AI image metadata inspection

Supports BOTH interaction styles:
- 🔎 Emoji reactions (classic UX)
- ⚡ Slash commands (modern UX)

Enhanced with Dataset-Tools metadata engine for comprehensive ComfyUI support!

ARCHITECTURE NOTE: Uses subprocess to call dataset-tools-parse CLI
This keeps the bot lightweight (<100MB RAM) instead of loading PyQt6 and heavy GUI deps
"""
import os
import io
import json
import asyncio
import logging
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any

import discord
from discord.ext import commands
from discord import app_commands
from dotenv import load_dotenv
import toml
from PIL import Image

# Local utilities
from utils.security import RateLimiter, sanitize_text
from utils.discord_formatter import format_metadata_embed, create_full_metadata_text


# Load environment variables
load_dotenv()
BOT_TOKEN = os.getenv('BOT_TOKEN')

# Load config
config = toml.load('config.toml') if Path('config.toml').exists() else {}
MONITORED_CHANNEL_IDS = set(config.get('MONITORED_CHANNEL_IDS', []))
EMOJI_FOUND = config.get('EMOJI_METADATA_FOUND', '🔎')
EMOJI_NOT_FOUND = config.get('EMOJI_NO_METADATA', '⛔')
REACT_ON_NO_METADATA = config.get('REACT_ON_NO_METADATA', False)
SCAN_LIMIT_BYTES = config.get('SCAN_LIMIT_BYTES', 10 * 1024 * 1024)  # 10MB

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('PromptInspector')

# Initialize bot with all intents needed
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix='!', intents=intents)
rate_limiter = RateLimiter(max_requests=5, window_seconds=60)


def reformat_json(string: str, indent: int = 2) -> Optional[str]:
    """Reformat JSON string with proper indentation.

    Args:
        string: JSON string to reformat
        indent: Indentation level

    Returns:
        Reformatted JSON or None if invalid
    """
    try:
        data = json.loads(string)
        return json.dumps(data, indent=indent)
    except json.JSONDecodeError:
        return None


def is_valid_image(image_data: bytes) -> bool:
    """Verify this is actually a valid image file."""
    if not image_data or len(image_data) < 100:
        return False

    try:
        with Image.open(io.BytesIO(image_data)) as img:
            width, height = img.size
            return width > 0 and height > 0
    except Exception:
        return False


async def parse_image_metadata(image_data: bytes) -> Optional[Dict[str, Any]]:
    """Parse metadata from image using Dataset-Tools CLI (subprocess).

    Uses subprocess to call dataset-tools-parse instead of direct import.
    This keeps the bot lightweight - parser runs in separate process and
    memory is freed after parsing completes.

    Args:
        image_data: Raw image bytes

    Returns:
        Metadata dict or None if no metadata found
    """
    if not is_valid_image(image_data):
        return None

    # Save to temp file for Dataset-Tools parser
    temp_path = Path(f"/tmp/discord_image_{id(image_data)}.png")
    try:
        with open(temp_path, 'wb') as f:
            f.write(image_data)

        # Call dataset-tools-parse via subprocess (lightweight!)
        # This avoids loading PyQt6 and heavy GUI dependencies
        result = await asyncio.to_thread(
            subprocess.run,
            ['dataset-tools-parse', str(temp_path), '--json'],
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout for parsing
        )

        if result.returncode != 0:
            logger.warning("Parser returned error: %s", result.stderr)
            return None

        # Parse JSON output
        metadata_dict = json.loads(result.stdout)
        return metadata_dict

    except subprocess.TimeoutExpired:
        logger.error("Parser timeout for image")
        return None
    except json.JSONDecodeError as e:
        logger.error("Failed to parse JSON output: %s", e)
        return None
    except Exception as e:
        logger.error("Error parsing metadata: %s", e)
        return None
    finally:
        # Cleanup temp file
        if temp_path.exists():
            temp_path.unlink()


# =============================================================================
# EMOJI REACTION MODE (Classic UX)
# =============================================================================

@bot.event
async def on_message(message: discord.Message):
    """Auto-detect metadata in monitored channels and add reaction."""
    # Ignore bot messages
    if message.author.bot:
        return

    # Only process in monitored channels
    if message.channel.id not in MONITORED_CHANNEL_IDS:
        return

    # Only process messages with PNG attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith('.png') and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        return

    logger.info("Scanning message from %s with %s images", message.author, len(attachments))

    # Check first attachment for metadata (usually enough)
    try:
        image_data = await attachments[0].read()
        metadata = await parse_image_metadata(image_data)

        if metadata:
            await message.add_reaction(EMOJI_FOUND)
            logger.info("✅ Found metadata in %s", attachments[0].filename)
        elif REACT_ON_NO_METADATA:
            await message.add_reaction(EMOJI_NOT_FOUND)
            logger.info("❌ No metadata in %s", attachments[0].filename)
    except Exception as e:
        logger.error("Error in on_message: %s", e)


@bot.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
    """Send metadata via DM when user clicks magnifying glass."""
    # Only respond to magnifying glass emoji
    if payload.emoji.name != EMOJI_FOUND:
        return

    # Only in monitored channels
    if payload.channel_id not in MONITORED_CHANNEL_IDS:
        return

    # Ignore bot's own reactions
    if payload.member and payload.member.bot:
        return

    # Rate limit check
    if rate_limiter.is_rate_limited(payload.user_id):
        logger.warning("Rate limit exceeded for user %s", payload.user_id)
        return

    try:
        # Fetch the message
        channel = bot.get_channel(payload.channel_id)
        message = await channel.fetch_message(payload.message_id)

        # Get PNG attachments
        attachments = [
            a for a in message.attachments
            if a.filename.lower().endswith('.png') and a.size < SCAN_LIMIT_BYTES
        ]

        if not attachments:
            return

        # Parse metadata from all images
        user = await bot.fetch_user(payload.user_id)
        dm_channel = await user.create_dm()
        sent_count = 0

        for attachment in attachments:
            image_data = await attachment.read()
            metadata = await parse_image_metadata(image_data)

            if metadata:
                # Create embed
                embed = format_metadata_embed(
                    metadata,
                    message.author,
                    attachment
                )

                # Create view with "Full Parameters" button
                view = FullMetadataView(metadata)

                await dm_channel.send(embed=embed, view=view)
                sent_count += 1
                logger.info("📬 Sent metadata to %s", user.name)

        if sent_count == 0:
            await dm_channel.send("Sorry, couldn't find any metadata in those images!")

    except discord.Forbidden:
        logger.warning("Cannot send DM to user %s (DMs disabled)", payload.user_id)
    except Exception as e:
        logger.error("Error in on_raw_reaction_add: %s", e)


# =============================================================================
# SLASH COMMANDS (Modern UX)
# =============================================================================

@bot.tree.command(name="metadata", description="Parse metadata from an image")
async def metadata_command(interaction: discord.Interaction, image: discord.Attachment):
    """Slash command to parse metadata from an uploaded image.

    Args:
        interaction: Discord interaction
        image: Image attachment
    """
    await interaction.response.defer(ephemeral=True)

    # Rate limit check
    if rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.followup.send(
            "⏰ You're making requests too quickly. Please wait a minute.",
            ephemeral=True
        )
        return

    # Validate file type
    if not image.filename.lower().endswith('.png'):
        await interaction.followup.send(
            "❌ Only PNG images are supported currently.",
            ephemeral=True
        )
        return

    # Validate file size
    if image.size > SCAN_LIMIT_BYTES:
        size_mb = image.size / (1024 * 1024)
        limit_mb = SCAN_LIMIT_BYTES / (1024 * 1024)
        await interaction.followup.send(
            f"❌ File too large ({size_mb:.1f}MB). Max: {limit_mb:.1f}MB.",
            ephemeral=True
        )
        return

    try:
        # Download and parse
        image_data = await image.read()
        metadata = await parse_image_metadata(image_data)

        if metadata:
            # Create embed
            embed = format_metadata_embed(
                metadata,
                interaction.user,
                image
            )

            # Create view with "Full Parameters" button
            view = FullMetadataView(metadata)

            await interaction.followup.send(
                embed=embed,
                view=view,
                ephemeral=True
            )
            logger.info("✅ /metadata command success for %s", interaction.user.name)
        else:
            await interaction.followup.send(
                "❌ No metadata found in this image.",
                ephemeral=True
            )
    except Exception as e:
        logger.error("Error in metadata_command: %s", e)
        await interaction.followup.send(
            f"❌ Error parsing metadata: {str(e)}",
            ephemeral=True
        )


# =============================================================================
# CONTEXT MENU (Right-click)
# =============================================================================

@bot.tree.context_menu(name="View Prompt")
async def view_prompt_context(interaction: discord.Interaction, message: discord.Message):
    """Context menu to view prompts from a message.

    Args:
        interaction: Discord interaction
        message: Target message
    """
    await interaction.response.defer(ephemeral=True)

    # Rate limit check
    if rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.followup.send(
            "⏰ You're making requests too quickly. Please wait a minute.",
            ephemeral=True
        )
        return

    # Get PNG attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith('.png') and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        await interaction.followup.send(
            "❌ No PNG images found in this message.",
            ephemeral=True
        )
        return

    sent_count = 0
    for attachment in attachments:
        image_data = await attachment.read()
        metadata = await parse_image_metadata(image_data)

        if metadata:
            embed = format_metadata_embed(metadata, message.author, attachment)
            view = FullMetadataView(metadata)

            await interaction.followup.send(
                embed=embed,
                view=view,
                ephemeral=True
            )
            sent_count += 1

    if sent_count == 0:
        await interaction.followup.send(
            "❌ No metadata found in any images.",
            ephemeral=True
        )


# =============================================================================
# UI COMPONENTS
# =============================================================================

class FullMetadataView(discord.ui.View):
    """View with button to show full metadata with JSON pretty-printing."""

    def __init__(self, metadata: Dict[str, Any]):
        super().__init__(timeout=3600)
        self.metadata = metadata

    @discord.ui.button(label="Full Parameters", style=discord.ButtonStyle.green)
    async def full_params(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Show full metadata as text file with JSON pretty-printing."""
        button.disabled = True
        await interaction.response.edit_message(view=self)

        # Create full text
        full_text = create_full_metadata_text(self.metadata)

        # Try to pretty-print JSON
        json_formatted = reformat_json(full_text)

        # Send as file if too long, otherwise as code block
        if len(full_text) > 1980:
            # Determine file type and content
            if json_formatted:
                file_content = json_formatted
                filename = "metadata.json"
            else:
                file_content = full_text
                filename = "metadata.txt"

            file_obj = discord.File(
                io.StringIO(file_content),
                filename=filename
            )
            await interaction.followup.send(file=file_obj, ephemeral=True)
        else:
            # Use appropriate code block syntax
            if json_formatted:
                followup_text = f"```json\n{json_formatted}\n```"
            else:
                followup_text = f"```\n{full_text}\n```"

            await interaction.followup.send(followup_text, ephemeral=True)


# =============================================================================
# BOT LIFECYCLE
# =============================================================================

@bot.event
async def on_ready():
    """Bot startup handler."""
    logger.info("✅ Logged in as %s!", bot.user)
    logger.info("📡 Monitoring %s channels", len(MONITORED_CHANNEL_IDS))

    # Sync slash commands
    try:
        synced = await bot.tree.sync()
        logger.info("⚡ Synced %s slash commands", len(synced))
    except Exception as e:
        logger.error("Failed to sync commands: %s", e)


def main():
    """Main entry point."""
    if not BOT_TOKEN:
        logger.error("❌ BOT_TOKEN not found in .env file!")
        return

    logger.info("🚀 Starting PromptInspectorBot-Enhanced...")
    bot.run(BOT_TOKEN)


if __name__ == '__main__':
    main()
