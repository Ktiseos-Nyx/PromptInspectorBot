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
import aiohttp

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


async def get_real_author(message: discord.Message) -> discord.User:
    """Get the real author of a message, accounting for PluralKit proxies.

    If the message is from a PluralKit webhook, queries the PluralKit API
    to find the actual user who sent it.

    Args:
        message: Discord message

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
                    if sender_id:
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
    tool = metadata.get('tool', 'Unknown')
    format_name = metadata.get('format', '')
    if format_name and format_name != tool:
        lines.append(f"*{tool} - {format_name}*\n")
    else:
        lines.append(f"*{tool}*\n")

    # Prompts section (collapsible)
    prompt = metadata.get('prompt')
    negative_prompt = metadata.get('negative_prompt')

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
    parameters = metadata.get('parameters', {})
    if parameters:
        settings_lines = ["\n**⚙️ Settings:**"]
        settings_text = []

        # Check for manual user_settings field (from manual entry)
        user_settings = parameters.get('user_settings')
        if user_settings:
            # User-provided freeform settings
            settings_lines.append(f"||{user_settings}||")
        else:
            # Priority settings (auto-extracted metadata)
            priority_keys = ['model', 'steps', 'sampler_name', 'cfg_scale', 'seed', 'width', 'height']
            for key in priority_keys:
                value = parameters.get(key)
                if value is not None:
                    if key == 'width' and 'height' in parameters:
                        settings_text.append(f"Resolution: {parameters['width']}x{parameters['height']}")
                        break  # Skip height, we showed both
                    elif key == 'height':
                        continue  # Already showed with width
                    else:
                        display_key = key.replace('_', ' ').title()
                        settings_text.append(f"{display_key}: {value}")

            if settings_text:
                settings_lines.append(f"||{' • '.join(settings_text)}||")

        if len(settings_lines) > 1:  # Has content beyond header
            lines.append("\n".join(settings_lines))

    lines.append("\n*Click buttons below for more details!*")

    return "\n".join(lines)


async def parse_image_metadata(image_data: bytes, filename: str = None) -> Optional[Dict[str, Any]]:
    """Parse metadata from image using Dataset-Tools CLI (subprocess).

    Uses subprocess to call dataset-tools-parse instead of direct import.
    This keeps the bot lightweight - parser runs in separate process and
    memory is freed after parsing completes.

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
    if filename and '.' in filename:
        ext = Path(filename).suffix  # .png, .jpg, etc.
    else:
        ext = '.png'  # Default to PNG
    temp_path = Path(f"/tmp/discord_image_{id(image_data)}{ext}")
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
            logger.warning("Parser returned error (exit code %s): %s", result.returncode, result.stderr)
            logger.debug("Parser stdout was: %s", result.stdout)
            return None

        # Parse JSON output
        if not result.stdout.strip():
            logger.warning("Parser returned empty output for %s", temp_path.name)
            return None

        metadata_dict = json.loads(result.stdout)
        logger.debug("Successfully parsed metadata for %s - found %s", temp_path.name, metadata_dict.get('tool', 'Unknown'))
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
    """Auto-detect metadata in monitored channels and post public reply."""
    # Ignore bot messages UNLESS it's a webhook (could be PluralKit!)
    if message.author.bot and not message.webhook_id:
        return

    # Only process in monitored channels
    if message.channel.id not in MONITORED_CHANNEL_IDS:
        return

    # Only process messages with PNG/JPEG attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith(('.png', '.jpg', '.jpeg')) and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        return

    logger.info("Scanning message from %s with %s images", message.author, len(attachments))

    # Check first attachment for metadata (usually enough)
    try:
        attachment = attachments[0]
        image_data = await attachment.read()
        metadata = await parse_image_metadata(image_data, attachment.filename)

        if metadata:
            # Add reaction to indicate metadata found
            await message.add_reaction(EMOJI_FOUND)
            logger.info("✅ Found metadata in %s", attachment.filename)
        else:
            # No metadata found - offer manual entry option
            if REACT_ON_NO_METADATA:
                await message.add_reaction(EMOJI_NOT_FOUND)
                logger.info("❌ No metadata in %s", attachment.filename)

            # Post helpful message with manual entry button
            view = ManualEntryPromptView(message, attachment)
            await message.reply(
                "ℹ️ No metadata found in this image. Would you like to add details manually?",
                view=view,
                mention_author=False
            )
    except Exception as e:
        logger.error("Error in on_message: %s", e)


@bot.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
    """Post public metadata reply when user clicks magnifying glass."""
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

        # Get PNG/JPEG attachments
        attachments = [
            a for a in message.attachments
            if a.filename.lower().endswith(('.png', '.jpg', '.jpeg')) and a.size < SCAN_LIMIT_BYTES
        ]

        if not attachments:
            return

        # Parse metadata from first attachment
        attachment = attachments[0]
        image_data = await attachment.read()
        metadata = await parse_image_metadata(image_data, attachment.filename)

        if metadata:
            # Get the real author (handles PluralKit proxies!)
            real_author = await get_real_author(message)

            # Format public message with collapsible spoilers
            public_message = format_public_metadata_message(metadata, real_author)

            # Create view with Midjourney-style buttons
            view = PublicMetadataView(metadata, real_author)

            # Reply to the original message PUBLICLY
            await message.reply(public_message, view=view, mention_author=False)

            logger.info("✅ Posted public metadata for %s (clicked by %s)", attachments[0].filename, payload.member.name)
        else:
            # Send ephemeral message if no metadata found
            user = await bot.fetch_user(payload.user_id)
            try:
                dm_channel = await user.create_dm()
                await dm_channel.send("Sorry, couldn't find any metadata in that image!")
            except discord.Forbidden:
                logger.warning("Couldn't notify user %s (DMs disabled)", payload.user_id)

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
    if not image.filename.lower().endswith(('.png', '.jpg', '.jpeg')):
        await interaction.followup.send(
            "❌ Only PNG and JPEG images are supported.",
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
        metadata = await parse_image_metadata(image_data, image.filename)

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

    # Get PNG/JPEG attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith(('.png', '.jpg', '.jpeg')) and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        await interaction.followup.send(
            "❌ No PNG or JPEG images found in this message.",
            ephemeral=True
        )
        return

    sent_count = 0
    for attachment in attachments:
        image_data = await attachment.read()
        metadata = await parse_image_metadata(image_data, attachment.filename)

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

class ManualMetadataModal(discord.ui.Modal, title="Add Image Details"):
    """Modal for manually entering image metadata."""

    prompt = discord.ui.TextInput(
        label="Prompt",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the positive prompt (optional)",
        required=False,
        max_length=2000
    )

    negative_prompt = discord.ui.TextInput(
        label="Negative Prompt",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the negative prompt (optional)",
        required=False,
        max_length=1000
    )

    model = discord.ui.TextInput(
        label="Model Name",
        style=discord.TextStyle.short,
        placeholder="e.g., Pony Diffusion XL",
        required=False,
        max_length=200
    )

    settings = discord.ui.TextInput(
        label="Settings (Steps, CFG, Sampler, etc.)",
        style=discord.TextStyle.paragraph,
        placeholder="e.g., Steps: 30, CFG: 7, Sampler: DPM++ 2M Karras",
        required=False,
        max_length=500
    )

    def __init__(self, original_message: discord.Message, attachment: discord.Attachment):
        super().__init__()
        self.original_message = original_message
        self.attachment = attachment

    async def on_submit(self, interaction: discord.Interaction):
        """Handle modal submission."""
        # Build manual metadata dict
        manual_metadata = {
            "tool": "Manual Entry (User Provided)",
            "format": "Discord Manual Entry",
            "prompt": self.prompt.value if self.prompt.value else None,
            "negative_prompt": self.negative_prompt.value if self.negative_prompt.value else None,
            "parameters": {}
        }

        # Parse settings field
        if self.model.value:
            manual_metadata["parameters"]["model"] = self.model.value

        if self.settings.value:
            # Store as-is for display
            manual_metadata["parameters"]["user_settings"] = self.settings.value

        # Get real author
        real_author = await get_real_author(self.original_message)

        # Format and post public message
        public_message = format_public_metadata_message(manual_metadata, real_author)
        view = PublicMetadataView(manual_metadata, real_author)

        await self.original_message.reply(public_message, view=view, mention_author=False)
        await interaction.response.send_message("✅ Details added!", ephemeral=True)

        logger.info("📝 Manual metadata added by %s for %s", interaction.user.name, self.attachment.filename)


class ManualEntryPromptView(discord.ui.View):
    """View with button to trigger manual metadata entry."""

    def __init__(self, message: discord.Message, attachment: discord.Attachment):
        super().__init__(timeout=300)  # 5 minute timeout
        self.message = message
        self.attachment = attachment

    @discord.ui.button(label="📝 Add Details", style=discord.ButtonStyle.primary)
    async def add_details(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Show modal for manual metadata entry."""
        modal = ManualMetadataModal(self.message, self.attachment)
        await interaction.response.send_modal(modal)


class PublicMetadataView(discord.ui.View):
    """View with buttons for public metadata messages (Midjourney-style!)."""

    def __init__(self, metadata: Dict[str, Any], original_author: discord.User):
        super().__init__(timeout=3600)  # Buttons work for 1 hour
        self.metadata = metadata
        self.original_author = original_author

    @discord.ui.button(label="📬 Full Details (DM)", style=discord.ButtonStyle.primary)
    async def send_dm(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Send full metadata to user's DMs."""
        try:
            # Create full embed
            embed = format_metadata_embed(
                self.metadata,
                self.original_author,
                None  # No attachment in DM
            )

            # Create view with full metadata button
            view = FullMetadataView(self.metadata)

            # Send to DM
            dm_channel = await interaction.user.create_dm()
            await dm_channel.send(embed=embed, view=view)

            # Acknowledge the button click
            await interaction.response.send_message(
                "✅ Sent full details to your DMs!",
                ephemeral=True
            )
            logger.info("📬 Sent full metadata DM to %s", interaction.user.name)

        except discord.Forbidden:
            await interaction.response.send_message(
                "❌ Couldn't send DM! Please enable DMs from server members.",
                ephemeral=True
            )
        except Exception as e:
            logger.error("Error sending DM: %s", e)
            await interaction.response.send_message(
                "❌ Something went wrong!",
                ephemeral=True
            )

    @discord.ui.button(label="💾 Save JSON", style=discord.ButtonStyle.secondary)
    async def save_json(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Download metadata as JSON file."""
        try:
            # Convert metadata to pretty JSON
            json_str = json.dumps(self.metadata, indent=2)

            # Create file object
            file_obj = discord.File(
                io.StringIO(json_str),
                filename="metadata.json"
            )

            # Send as ephemeral message
            await interaction.response.send_message(
                "💾 Here's your metadata JSON!",
                file=file_obj,
                ephemeral=True
            )
            logger.info("💾 Sent JSON download to %s", interaction.user.name)

        except Exception as e:
            logger.error("Error creating JSON: %s", e)
            await interaction.response.send_message(
                "❌ Couldn't create JSON file!",
                ephemeral=True
            )

    @discord.ui.button(label="❤️", style=discord.ButtonStyle.success)
    async def react_love(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Just a fun reaction button!"""
        await interaction.response.send_message(
            "💜 Thanks for the love!",
            ephemeral=True
        )


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
