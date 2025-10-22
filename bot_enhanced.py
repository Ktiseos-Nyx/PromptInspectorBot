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
import google.genai as genai

# Local utilities
from utils.security import RateLimiter, sanitize_text
from utils.discord_formatter import format_metadata_embed, create_full_metadata_text


# Load environment variables
load_dotenv()
BOT_TOKEN = os.getenv('BOT_TOKEN')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

# Configure Gemini API
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Load config from toml file
config = toml.load('config.toml') if Path('config.toml').exists() else {}

# Check environment variables first, fall back to config.toml
# This allows Railway/production to override settings without changing the repo
def parse_id_list(env_var_name: str, config_key: str) -> set:
    """Parse comma-separated ID list from env var or config file."""
    env_value = os.getenv(env_var_name)
    if env_value is not None:
        # Parse env var: "123,456,789" or "[]" for empty
        env_value = env_value.strip()
        if env_value == "[]" or env_value == "":
            return set()
        return set(int(x.strip()) for x in env_value.split(',') if x.strip())
    # Fall back to config.toml
    return set(config.get(config_key, []))

def parse_channel_features(env_var_name: str, config_key: str) -> Dict[int, set]:
    """Parse channel features from env var or config file."""
    features = {}
    env_value = os.getenv(env_var_name)
    if env_value is not None:
        # Parse env var: "channel_id:feature1,feature2;channel_id:feature1..."
        for item in env_value.split(';'):
            if ':' in item:
                channel_id_str, features_str = item.split(':', 1)
                if channel_id_str.isdigit():
                    channel_id = int(channel_id_str)
                    features[channel_id] = {f.strip() for f in features_str.split(',')}
    else:
        # Fall back to config.toml
        config_features = config.get(config_key, {})
        for channel_id, feature_list in config_features.items():
            features[int(channel_id)] = set(feature_list)
    return features

ALLOWED_GUILD_IDS = parse_id_list('ALLOWED_GUILD_IDS', 'ALLOWED_GUILD_IDS')
MONITORED_CHANNEL_IDS = parse_id_list('MONITORED_CHANNEL_IDS', 'MONITORED_CHANNEL_IDS')
CHANNEL_FEATURES = parse_channel_features('CHANNEL_FEATURES', 'channel_features')
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

# Track recently processed attachments to avoid double-processing PluralKit proxies
# Use attachment URL instead of message ID since PluralKit creates new messages
processed_attachment_urls = set()
MAX_TRACKED_ATTACHMENTS = 1000


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
    global processed_attachment_urls

    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and message.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[message.channel.id]:
        return

    # Ignore bot messages UNLESS it's a webhook (could be PluralKit!)
    if message.author.bot and not message.webhook_id:
        return

    # Only process in monitored channels (empty set = monitor all channels)
    if MONITORED_CHANNEL_IDS and message.channel.id not in MONITORED_CHANNEL_IDS:
        return

    # PluralKit handling: Wait a moment to see if message gets proxied
    # If it's NOT a webhook, wait 2 seconds to let PluralKit delete original
    if not message.webhook_id:
        await asyncio.sleep(2)
        # Check if message still exists (PluralKit deletes originals)
        try:
            await message.channel.fetch_message(message.id)
            # Message still exists, not proxied by PluralKit - process it
        except discord.NotFound:
            # Message was deleted (PluralKit proxied it) - skip
            logger.debug("Message deleted by PluralKit, skipping original")
            return
    # If it IS a webhook, process immediately (it's the proxied version)

    # Only process messages with PNG/JPEG attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith(('.png', '.jpg', '.jpeg')) and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        return

    # Check if we already processed this attachment (avoid PluralKit double-processing)
    # PluralKit creates a NEW message but keeps the same attachment URL!
    attachment = attachments[0]
    if attachment.url in processed_attachment_urls:
        logger.debug("Skipping already-processed attachment %s", attachment.filename)
        return

    # Mark attachment as processed (prevent double-processing for PluralKit)
    processed_attachment_urls.add(attachment.url)
    if len(processed_attachment_urls) > MAX_TRACKED_ATTACHMENTS:
        # Clear old entries when cache gets too big
        processed_attachment_urls.clear()

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
            try:
                await message.reply(
                    "ℹ️ No metadata found in this image. Would you like to add details manually?",
                    view=view,
                    mention_author=False
                )
            except discord.NotFound:
                # Message was deleted (likely by PluralKit) - send to channel instead
                logger.debug("Original message deleted, posting to channel instead")
                await message.channel.send(
                    "ℹ️ No metadata found in that image. Would you like to add details manually?",
                    view=view
                )
    except discord.HTTPException as e:
        if e.code == 50035:  # Invalid Form Body - message deleted
            logger.debug("Message deleted by PluralKit proxy, skipping reply")
        else:
            logger.error("Discord error in on_message: %s", e)
    except Exception as e:
        logger.error("Error in on_message: %s", e)


@bot.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
    """Post public metadata reply when user clicks magnifying glass."""
    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and payload.channel_id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[payload.channel.id]:
        return

    # Only respond to magnifying glass emoji
    if payload.emoji.name != EMOJI_FOUND:
        return

    # Only in monitored channels (empty set = monitor all channels)
    if MONITORED_CHANNEL_IDS and payload.channel_id not in MONITORED_CHANNEL_IDS:
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
    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

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


@bot.tree.command(name="ask", description="Ask a question to the bot.")
async def ask_command(interaction: discord.Interaction, question: str):
    """Slash command to ask a question to the bot."""
    # Check if ask feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "ask" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    # Check prompt length
    if len(question) > 2000:
        await interaction.response.send_message("❌ Your question is too long! Please keep it under 2000 characters.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    response = await ask_gemini(interaction.user, question)
    await interaction.followup.send(response, ephemeral=True)


conversation_history = {}

async def ask_gemini(user: discord.User, question: str) -> str:
    """Asks a question to the Gemini API."""
    if not GEMINI_API_KEY:
        return "❌ Gemini API key is not configured."

    try:
        model = genai.GenerativeModel('gemini-pro')

        # Get conversation history for the user
        if user.id not in conversation_history:
            conversation_history[user.id] = []

        # Add the new question to the history
        conversation_history[user.id].append({"role": "user", "parts": [question]})

        # Prepend a guiding prompt
        guiding_prompt = "You are a helpful assistant. Your goal is to provide accurate and concise answers."
        prompt_parts = [guiding_prompt] + conversation_history[user.id]

        response = await model.generate_content_async(prompt_parts)

        # Add the response to the history
        conversation_history[user.id].append(response.candidates[0].content)

        # Limit history size to avoid excessive token usage
        if len(conversation_history[user.id]) > 10:
            conversation_history[user.id] = conversation_history[user.id][-10:]

        return response.text

    except Exception as e:
        logger.error("Error calling Gemini API: %s", e)
        return f"❌ Error generating response: {e}"

@bot.tree.command(name="dream", description="Generate an image with a specific style.")
@app_commands.choices(style=[
    app_commands.Choice(name="Photorealistic", value="photorealistic"),
    app_commands.Choice(name="Anime", value="anime"),
    app_commands.Choice(name="Vaporwave", value="vaporwave"),
    app_commands.Choice(name="Steampunk", value="steampunk"),
])
async def dream_command(interaction: discord.Interaction, prompt: str, style: app_commands.Choice[str]):
    """Slash command to generate an image with a specific style."""
    # Check if dream feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "dream" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    # Check prompt length
    if len(prompt) > 2000:
        await interaction.response.send_message("❌ Your prompt is too long! Please keep it under 2000 characters.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    image_data = await dream_with_gemini(prompt, style.value)
    if isinstance(image_data, str):
        await interaction.followup.send(image_data, ephemeral=True)
    else:
        file = discord.File(io.BytesIO(image_data), filename="dream.png")
        await interaction.followup.send(file=file, ephemeral=True)


style_prompts = {
    "photorealistic": ", photorealistic, 8k, hyper-detailed, cinematic lighting",
    "anime": ", anime style, key visual, vibrant, studio trigger",
    "vaporwave": ", vaporwave aesthetic, neon, retro, 80s, synthwave",
    "steampunk": ", steampunk, gears, cogs, brass, victorian",
}

async def dream_with_gemini(prompt: str, style: str) -> Any:
    """Generates an image using the Gemini API."""
    if not GEMINI_API_KEY:
        return "❌ Gemini API key is not configured."

    try:
        # NOTE: As of October 2025, the image generation model is not yet publicly available.
        # This is a placeholder for the actual model name.
        model = genai.GenerativeModel('gemini-pro-vision') # Placeholder

        # Modify the prompt with the selected style
        style_addition = style_prompts.get(style, "")
        full_prompt = f"{prompt}{style_addition}"

        # This is a placeholder for the actual image generation call
        # The actual API call will likely be different.
        # For now, we will just return a string.
        # response = await model.generate_content_async(full_prompt)
        # return response.image_data

        return f"You dreamed of: {full_prompt}"

    except Exception as e:
        logger.error("Error calling Gemini API: %s", e)
        return f"❌ Error generating image: {e}"



# =============================================================================
# CONTEXT MENU (Right-click)
# =============================================================================

async def view_prompt_context(interaction: discord.Interaction, message: discord.Message):
    """Context menu to view prompts from a message.

    Args:
        interaction: Discord interaction
        message: Target message
    """
    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

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
        # IMPORTANT: Acknowledge interaction FIRST (must respond within 3 seconds!)
        await interaction.response.send_message("✅ Details added!", ephemeral=True)

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

        # Get real author (this might take time with PluralKit API)
        real_author = await get_real_author(self.original_message)

        # Format and post public message
        public_message = format_public_metadata_message(manual_metadata, real_author)
        view = PublicMetadataView(manual_metadata, real_author)

        await self.original_message.reply(public_message, view=view, mention_author=False)

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

    def __init__(self, metadata: Dict[str, Any], original_author: discord.User, original_message: discord.Message = None):
        super().__init__(timeout=3600)  # Buttons work for 1 hour
        self.metadata = metadata
        self.original_author = original_author
        self.original_message = original_message

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

    @discord.ui.button(label="Describe", style=discord.ButtonStyle.secondary)
    async def describe(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Show modal for image description options."""
        modal = DescribeModal(self.original_message)
        await interaction.response.send_modal(modal)


class DescribeModal(discord.ui.Modal, title="Describe Image"):
    """Modal for choosing description style."""

    def __init__(self, original_message: discord.Message):
        super().__init__()
        self.original_message = original_message

    style = discord.ui.Select(
        placeholder="Choose a description style...",
        options=[
            discord.SelectOption(label="Danbooru Tags", value="danbooru"),
            discord.SelectOption(label="Natural Language", value="natural"),
        ]
    )

    async def on_submit(self, interaction: discord.Interaction):
        """Handle modal submission."""
        await interaction.response.send_message("🎨 Generating description...", ephemeral=True)
        # Placeholder for Gemini API call
        description = await describe_image_with_gemini(self.original_message, self.style.values[0])
        await interaction.followup.send(description, ephemeral=True)


async def describe_image_with_gemini(message: discord.Message, style: str) -> str:
    """Describes an image using the Gemini API."""
    if not GEMINI_API_KEY:
        return "❌ Gemini API key is not configured."

    if not message.attachments:
        return "❌ No image found in the message."

    attachment = message.attachments[0]
    if not attachment.content_type.startswith("image/"):
        return "❌ Attachment is not an image."

    try:
        image_data = await attachment.read()
        image_part = {
            "mime_type": attachment.content_type,
            "data": image_data
        }

        if style == "danbooru":
            prompt = "Describe this image using Danbooru-style tags. Focus on descriptive tags about the character, clothing, and scene. Exclude metadata tags like 'masterpiece' or 'high quality'."
        else:
            prompt = "Describe this image in a natural, descriptive language."

        model = genai.GenerativeModel('gemini-pro-vision')
        response = await model.generate_content_async([prompt, image_part])

        return response.text

    except Exception as e:
        logger.error("Error calling Gemini API: %s", e)
        return f"❌ Error generating description: {e}"


class FullMetadataView(discord.ui.View):
    """View with button to show full metadata with JSON pretty-printing."""

    def __init__(self, metadata: Dict[str, Any]):
        super().__init__(timeout=3600)
        self.metadata = metadata

    @discord.ui.button(label="Full Parameters", style=discord.ButtonStyle.green)
    async def full_params(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Show full metadata as text file with JSON pretty-printing."""
        button.disabled = True
        await interaction.edit_original_response(view=self)

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
async def on_guild_join(guild: discord.Guild):
    """Handle bot being added to a new server - check whitelist."""
    # If whitelist is empty, allow all servers (public mode)
    if not ALLOWED_GUILD_IDS:
        logger.info("✅ Joined server: %s (ID: %s) - Public mode, all servers allowed", guild.name, guild.id)
        return

    # Check if server is whitelisted
    if guild.id not in ALLOWED_GUILD_IDS:
        logger.warning("⛔ UNAUTHORIZED server join: %s (ID: %s) - Auto-leaving!", guild.name, guild.id)

        # Try to notify the server owner
        try:
            owner = guild.owner
            if owner:
                await owner.send(
                    f"👋 Hello! Thanks for trying to add **{bot.user.name}** to **{guild.name}**!\n\n"
                    f"However, this is a **private bot instance** and only available in authorized servers.\n\n"
                    f"If you'd like to use this bot, you can:\n"
                    f"• Self-host your own instance: https://github.com/Ktiseos-Nyx/PromptInspectorBot\n"
                    f"• Contact the bot owner to request access\n\n"
                    f"The bot has automatically left your server. Sorry for the inconvenience!"
                )
                logger.info("📬 Sent notification to server owner: %s", owner.name)
        except discord.Forbidden:
            logger.warning("Couldn't DM server owner (DMs disabled)")
        except Exception as e:
            logger.error("Error notifying server owner: %s", e)

        # Leave the server
        await guild.leave()
        logger.info("👋 Left unauthorized server: %s", guild.name)
    else:
        logger.info("✅ Joined whitelisted server: %s (ID: %s)", guild.name, guild.id)


@bot.event
async def on_ready():
    """Bot startup handler."""
    logger.info("✅ Logged in as %s!", bot.user)
    logger.info("📡 Monitoring %s channels", len(MONITORED_CHANNEL_IDS))

    # Log whitelist status
    if ALLOWED_GUILD_IDS:
        logger.info("🔒 Guild whitelist enabled: %s authorized servers", len(ALLOWED_GUILD_IDS))
    else:
        logger.info("🌐 Public mode: All servers allowed")

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
