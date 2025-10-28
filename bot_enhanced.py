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
import warnings
from pathlib import Path
from typing import Optional, Dict, Any

import discord
from discord.ext import commands
from discord import app_commands
from dotenv import load_dotenv
import toml
from PIL import Image
import aiohttp

# Suppress aiohttp unclosed client session warnings on shutdown
warnings.filterwarnings("ignore", message="Unclosed client session", category=ResourceWarning)

import google.genai as genai
from google.genai import types

# Local utilities
from utils.security import RateLimiter, sanitize_text
from utils.discord_formatter import format_metadata_embed, create_full_metadata_text
from dataset_tools.metadata_parser import parse_metadata


# Load environment variables
load_dotenv()
BOT_TOKEN = os.getenv('BOT_TOKEN')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

# Initialize Gemini client (new SDK)
gemini_client = None
if GEMINI_API_KEY:
    gemini_client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=types.HttpOptions(api_version='v1')
    )



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
        if config and config_key in config:
            config_features = config[config_key]
            for channel_id, feature_list in config_features.items():
                if isinstance(feature_list, list):
                    features[int(channel_id)] = set(feature_list)
    return features

ALLOWED_GUILD_IDS = parse_id_list('ALLOWED_GUILD_IDS', 'ALLOWED_GUILD_IDS')
MONITORED_CHANNEL_IDS = parse_id_list('MONITORED_CHANNEL_IDS', 'MONITORED_CHANNEL_IDS')
CHANNEL_FEATURES = parse_channel_features('CHANNEL_FEATURES', 'channel_features')
EMOJI_FOUND = config.get('EMOJI_METADATA_FOUND', '🔎')
EMOJI_NOT_FOUND = config.get('EMOJI_NO_METADATA', '⛔')
REACT_ON_NO_METADATA = config.get('REACT_ON_NO_METADATA', False)
SCAN_LIMIT_BYTES = config.get('SCAN_LIMIT_BYTES', 10 * 1024 * 1024)  # 10MB

# Gemini AI configuration
GEMINI_PRIMARY_MODEL = os.getenv('GEMINI_PRIMARY_MODEL') or config.get('GEMINI_PRIMARY_MODEL', 'gemini-2.5-flash')
GEMINI_FALLBACK_MODELS = config.get('GEMINI_FALLBACK_MODELS', [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
    'gemini-2.5-pro'
])
GEMINI_MAX_RETRIES = int(os.getenv('GEMINI_MAX_RETRIES', config.get('GEMINI_MAX_RETRIES', 3)))
GEMINI_RETRY_DELAY = float(os.getenv('GEMINI_RETRY_DELAY', config.get('GEMINI_RETRY_DELAY', 1.0)))

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
intents.guilds = True  # Needed for thread events

bot = commands.Bot(command_prefix='!', intents=intents)

# Separate rate limiters for different features
rate_limiter = RateLimiter(max_requests=5, window_seconds=30)        # Metadata (local parsing - keep lenient)
gemini_rate_limiter = RateLimiter(max_requests=1, window_seconds=10) # Gemini API - STRICT (1 per 10s to prevent quota abuse)

# Track recently processed attachments to avoid double-processing PluralKit proxies
# Use attachment URL instead of message ID since PluralKit creates new messages
processed_attachment_urls = set()
MAX_TRACKED_ATTACHMENTS = 1000

# Cache metadata for multi-image messages (message_id -> list of {attachment, metadata})
message_metadata_cache = {}
MAX_CACHED_MESSAGES = 100


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


def transform_ui_dict_to_simple_format(ui_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Transform UI dict format from parse_metadata to simple Discord format.

    Converts from:
        {'prompt_data_section': {...}, 'generation_parameters_section': {...}, ...}
    To:
        {'tool': '...', 'prompt': '...', 'parameters': {...}}
    """
    simple = {}

    # Extract tool name
    metadata_section = ui_dict.get('metadata_info_section', {})
    simple['tool'] = metadata_section.get('Detected Tool', 'Unknown')
    simple['format'] = metadata_section.get('format', '')

    # Extract prompts
    prompt_section = ui_dict.get('prompt_data_section', {})
    simple['prompt'] = prompt_section.get('Positive', '')
    simple['negative_prompt'] = prompt_section.get('Negative', '')

    # Extract parameters
    simple['parameters'] = ui_dict.get('generation_parameters_section', {})

    # Include raw metadata for JSON button
    simple['raw_metadata'] = ui_dict.get('raw_tool_specific_data_section', {})

    return simple


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
    if filename and '.' in filename:
        ext = Path(filename).suffix  # .png, .jpg, etc.
    else:
        ext = '.png'  # Default to PNG
    temp_path = Path(f"/tmp/discord_image_{id(image_data)}{ext}")
    try:
        with open(temp_path, 'wb') as f:
            f.write(image_data)

        # Call parse_metadata in a thread to avoid blocking
        ui_dict = await asyncio.to_thread(
            parse_metadata,
            str(temp_path)
        )

        if not ui_dict or not isinstance(ui_dict, dict):
            logger.warning("Parser returned empty or invalid result for %s", temp_path.name)
            return None

        # Transform UI dict to simple format for Discord
        metadata_dict = transform_ui_dict_to_simple_format(ui_dict)

        logger.debug("Successfully parsed metadata for %s - found %s", temp_path.name, metadata_dict.get('tool', 'Unknown'))
        return metadata_dict

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
    # For threads/forums, check the parent channel ID
    channel_id_for_features = message.channel.parent_id if hasattr(message.channel, 'parent_id') and message.channel.parent_id else message.channel.id
    if CHANNEL_FEATURES and channel_id_for_features in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[channel_id_for_features]:
        return

    # Ignore bot messages UNLESS it's a webhook (could be PluralKit!)
    if message.author.bot and not message.webhook_id:
        return

    # Only process in monitored channels (empty set = monitor all channels)
    # For threads/forums, check the parent channel ID
    channel_to_check = message.channel.parent_id if hasattr(message.channel, 'parent_id') and message.channel.parent_id else message.channel.id
    if MONITORED_CHANNEL_IDS and channel_to_check not in MONITORED_CHANNEL_IDS:
        return

    # PluralKit handling: Wait a moment to see if message gets proxied
    # If it's NOT a webhook, wait briefly to let PluralKit delete original
    # REDUCED from 2s to 0.5s to avoid Discord rate limits and Railway timeouts
    if not message.webhook_id:
        await asyncio.sleep(0.5)  # Reduced wait time
        # Check if message still exists (PluralKit deletes originals)
        try:
            await message.channel.fetch_message(message.id)
            # Message still exists, not proxied by PluralKit - process it
        except discord.NotFound:
            # Message was deleted (PluralKit proxied it) - skip
            logger.debug("Message deleted by PluralKit, skipping original")
            return
        except discord.HTTPException as e:
            # Handle Discord API errors gracefully
            logger.warning(f"Discord API error checking message: {e}")
            return
    # If it IS a webhook, process immediately (it's the proxied version)

    # Only process messages with PNG/JPEG/WebP attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and a.size < SCAN_LIMIT_BYTES
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

    try:
        # Scan ALL images for metadata
        images_with_metadata = []
        for attachment in attachments:
            image_data = await attachment.read()
            metadata = await parse_image_metadata(image_data, attachment.filename)
            if metadata:
                images_with_metadata.append({
                    'attachment': attachment,
                    'metadata': metadata
                })
                logger.info("✅ Found metadata in %s", attachment.filename)

        if not images_with_metadata:
            # No metadata in any image
            if REACT_ON_NO_METADATA:
                await message.add_reaction(EMOJI_NOT_FOUND)
                logger.info("❌ No metadata in any images")

            # Check if images are JPG/WebP (Discord strips metadata from these)
            first_image = attachments[0]
            is_jpg_or_webp = first_image.filename.lower().endswith(('.jpg', '.jpeg', '.webp'))

            # Customize message based on file type
            if is_jpg_or_webp:
                no_metadata_msg = (
                    "ℹ️ **No metadata found!**\n"
                    "📸 Discord strips metadata from JPG/WebP images when uploaded.\n"
                    "💡 *Tip: PNG files preserve metadata!*\n\n"
                    "Would you like to add details manually?"
                )
            else:
                no_metadata_msg = "ℹ️ No metadata found in these images. Would you like to add details manually?"

            # Offer manual entry for first image
            view = ManualEntryPromptView(message, first_image)
            try:
                await message.reply(
                    no_metadata_msg,
                    view=view,
                    mention_author=False
                )
            except discord.NotFound:
                logger.debug("Original message deleted, posting to channel instead")
                await message.channel.send(
                    no_metadata_msg,
                    view=view
                )
            return

        # Found metadata! Store in cache for later retrieval
        global message_metadata_cache
        message_metadata_cache[message.id] = images_with_metadata

        # Limit cache size
        if len(message_metadata_cache) > MAX_CACHED_MESSAGES:
            # Remove oldest entries (first 20)
            oldest_keys = list(message_metadata_cache.keys())[:20]
            for key in oldest_keys:
                del message_metadata_cache[key]

        # Decide reaction strategy based on count
        num_images = len(images_with_metadata)

        if num_images <= 5:
            # 1-5 images: Add numbered reactions
            number_emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']
            for i in range(num_images):
                await message.add_reaction(number_emojis[i])
            logger.info("✅ Added %d numbered reactions for individual inspection", num_images)
        else:
            # 6+ images: Add single reaction for batch download
            await message.add_reaction('📦')
            logger.info("✅ Added batch reaction for %d images", num_images)

    except discord.HTTPException as e:
        if e.code == 50035:  # Invalid Form Body - message deleted
            logger.debug("Message deleted by PluralKit proxy, skipping reply")
        else:
            logger.error("Discord error in on_message: %s", e)
    except Exception as e:
        logger.error("Error in on_message: %s", e)


@bot.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
    """Handle emoji reactions for metadata display (numbered or batch)."""
    # For threads/forums, check parent channel ID
    channel = bot.get_channel(payload.channel_id)
    channel_id_to_check = channel.parent_id if hasattr(channel, 'parent_id') and channel.parent_id else payload.channel_id

    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and channel_id_to_check in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[channel_id_to_check]:
        return

    # Only in monitored channels (empty set = monitor all channels)
    if MONITORED_CHANNEL_IDS and channel_id_to_check not in MONITORED_CHANNEL_IDS:
        return

    # Ignore bot's own reactions
    if payload.member and payload.member.bot:
        return

    # Rate limit check
    if rate_limiter.is_rate_limited(payload.user_id):
        logger.warning("Rate limit exceeded for user %s", payload.user_id)
        return

    # Check which emoji was clicked
    emoji_name = payload.emoji.name
    number_emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']

    # Only respond to our special emojis
    if emoji_name not in number_emojis and emoji_name != '📦':
        return

    try:
        # Fetch the message
        channel = bot.get_channel(payload.channel_id)
        message = await channel.fetch_message(payload.message_id)

        # Check if we have cached metadata for this message
        if payload.message_id not in message_metadata_cache:
            logger.warning("No cached metadata for message %s", payload.message_id)
            return

        images_with_metadata = message_metadata_cache[payload.message_id]
        real_author = await get_real_author(message)

        if emoji_name == '📦':
            # Batch download - create JSON with all metadata
            batch_data = {
                "batch_size": len(images_with_metadata),
                "images": []
            }

            for item in images_with_metadata:
                batch_data["images"].append({
                    "filename": item['attachment'].filename,
                    "url": item['attachment'].url,
                    "metadata": item['metadata']
                })

            # Create JSON file
            json_str = json.dumps(batch_data, indent=2)
            file_obj = discord.File(
                io.StringIO(json_str),
                filename=f"batch_metadata_{len(images_with_metadata)}_images.json"
            )

            # Send to user
            await message.reply(
                f"📦 **Batch Metadata** ({len(images_with_metadata)} images with metadata)\n"
                f"Downloaded by {payload.member.mention}",
                file=file_obj,
                mention_author=False
            )
            logger.info("✅ Sent batch metadata for %d images (clicked by %s)",
                       len(images_with_metadata), payload.member.name)

        elif emoji_name in number_emojis:
            # Individual image - find which number
            image_index = number_emojis.index(emoji_name)

            if image_index >= len(images_with_metadata):
                logger.warning("Image index %d out of range for message %s", image_index, payload.message_id)
                return

            # Get the specific image's metadata
            item = images_with_metadata[image_index]
            metadata = item['metadata']

            # Format public message
            public_message = format_public_metadata_message(metadata, real_author)
            public_message = f"**Image {image_index + 1}/{len(images_with_metadata)}**\n\n{public_message}"

            # Create view with buttons
            view = PublicMetadataView(metadata, real_author)

            # Reply to the original message
            await message.reply(public_message, view=view, mention_author=False)

            logger.info("✅ Posted metadata for image %d/%d (clicked by %s)",
                       image_index + 1, len(images_with_metadata), payload.member.name)

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

    await interaction.response.defer()

    # Rate limit check
    if rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.followup.send(
            "⏰ You're making requests too quickly. Please wait a minute."
        )
        return

    # Validate file type
    if not image.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
        await interaction.followup.send(
            "❌ Only PNG, JPEG, and WebP images are supported."
        )
        return

    # Validate file size
    if image.size > SCAN_LIMIT_BYTES:
        size_mb = image.size / (1024 * 1024)
        limit_mb = SCAN_LIMIT_BYTES / (1024 * 1024)
        await interaction.followup.send(
            f"❌ File too large ({size_mb:.1f}MB). Max: {limit_mb:.1f}MB."
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
                view=view
            )
            logger.info("✅ /metadata command success for %s", interaction.user.name)
        else:
            await interaction.followup.send(
                "❌ No metadata found in this image."
            )
    except Exception as e:
        logger.error("Error in metadata_command: %s", e)
        await interaction.followup.send(
            f"❌ Error parsing metadata: {str(e)}"
        )


@bot.tree.command(name="ask", description="Ask a question to the bot.")
async def ask_command(interaction: discord.Interaction, question: str):
    """Slash command to ask a question to the bot."""
    # Check if ask feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "ask" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    # STRICT rate limit for Gemini API (1 per 10 seconds)
    if gemini_rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.response.send_message("⏰ **Slow down!** Gemini API limit: 1 request per 10 seconds. Please wait.", ephemeral=True)
        return

    # Check prompt length
    if len(question) > 2000:
        await interaction.response.send_message("❌ Your question is too long! Please keep it under 2000 characters.")
        return

    await interaction.response.defer()
    response = await ask_gemini(interaction.user, question)

    # If response is too long for Discord, send as text file
    if len(response) > 2000:
        file_content = io.BytesIO(response.encode('utf-8'))
        file = discord.File(file_content, filename="response.txt")
        await interaction.followup.send("Response was too long, sent as file:", file=file)
    else:
        await interaction.followup.send(response)


@bot.tree.command(name="techsupport", description="Get IT help with personality")
async def techsupport_command(interaction: discord.Interaction, issue: str):
    """Tech support from a seasoned IT professional with opinions.

    Args:
        issue: Describe your tech problem
    """
    # Check if techsupport feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "techsupport" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    # STRICT rate limit for Gemini API (1 per 10 seconds)
    if gemini_rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.response.send_message("⏰ **Slow down!** Gemini API limit: 1 request per 10 seconds. Please wait.", ephemeral=True)
        return

    # Check issue length
    if len(issue) > 2000:
        await interaction.response.send_message("❌ Your issue description is too long! Please keep it under 2000 characters.")
        return

    await interaction.response.defer()

    try:
        # Tech support personality system instruction
        tech_support_instruction = """You are a seasoned IT professional providing tech support
with personality. You've been doing this since the 90s and you've seen EVERYTHING.

CORE PHILOSOPHY:
- You WILL solve their problem (you're good at your job)
- But you'll ask the "obvious" questions first (because 60% of the time, it IS that simple)
- You're sarcastic but never mean
- You celebrate when people actually tried basic troubleshooting first
- You gently roast when they clearly didn't

THE HOLY CHECKLIST (Always start here):
1. "Is it plugged in? Like, at the wall AND the device?"
2. "Have you tried turning it off and on again? No, really."
3. "When did this start happening? What changed?"
4. "Any error messages? Screenshot them, don't paraphrase."

COMMUNICATION STYLE:
- Acknowledge the problem without being condescending
- Walk through solutions step-by-step
- Use analogies (duct tape, percussive maintenance, talking to it nicely)
- Occasionally reference ancient tech or "the old ways"
- React appropriately to chaos ("Your WHAT is on fire?!")
- Give genuine praise when they provide good diagnostic info

PERSONALITY EXAMPLES:
✅ "Alright, first things first - is it actually plugged in? I'm not being sarcastic,
    I once spent 2 hours on a 'broken' monitor that wasn't connected to power. We've all been there."

✅ "Okay that error message is chef's kiss - super helpful for diagnosing this.
    Let's knock this out."

✅ "So you installed a random .exe from a sketchy website? Bold strategy.
    Let's see if we can unfuck this without a full reinstall."

✅ "Brother in IT, your computer sounds like a jet engine because your fan is
    clogged with dust. When's the last time you cleaned it? 2019? Yeah that'll do it."

THINGS YOU SAY:
- "Did you try turning it off and on? I know, I know, cliché, but it works 70% of the time."
- "Unplug it, count to 10, plug it back in. This is called 'power cycling' but really it's tech voodoo."
- "What antivirus are you running? ...None? Okay. Okay. Deep breath. Let's fix that."
- "Have you considered installing Linux? I'm kidding. Mostly."
- "Your fan sounds like WHAT? Unplug that thing RIGHT NOW."

RULES:
- Stay helpful even when being snarky
- Never be cruel or dismissive
- If it's genuinely complex, acknowledge it ("Yeah this one's a headscratcher")
- Celebrate basic troubleshooting ("You already restarted? You're ahead of 80% of my tickets")
- Keep it PG-13 and ToS-safe
- If you don't know, say so (but offer to research)

You are the IT person everyone WANTS to get assigned to their ticket because
you're funny AND you fix the problem."""

        # Wrap API call with retry logic and fallbacks
        def make_call_factory(model_name):
            async def make_call():
                return await gemini_client.aio.models.generate_content(
                    model=model_name,
                    contents=issue,
                    config=types.GenerateContentConfig(
                        system_instruction=tech_support_instruction,
                        temperature=0.8  # Slightly higher for personality
                    )
                )
            return make_call

        response = await call_gemini_with_retry(make_call_factory)

        message_content = f"🛠️ **Tech Support Ticket:**\n\n{response.text}"

        # If response is too long for Discord, send as text file
        if len(message_content) > 2000:
            file_content = io.BytesIO(message_content.encode('utf-8'))
            file = discord.File(file_content, filename="techsupport_response.txt")
            await interaction.followup.send("Tech support response was too long, sent as file:", file=file)
        else:
            await interaction.followup.send(message_content)

        logger.info("✅ /techsupport command success for %s", interaction.user.name)

    except Exception as e:
        logger.error("Error in techsupport_command: %s", e)
        await interaction.followup.send("❌ My troubleshooting brain just crashed. That's ironic. Try again in a sec.")


@bot.tree.command(name="coder", description="Get coding help and solutions")
async def coder_command(interaction: discord.Interaction, question: str):
    """Get expert programming assistance with working code solutions.

    Args:
        question: Describe your coding problem or question
    """
    # Check if coder feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "coder" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    # STRICT rate limit for Gemini API (1 per 10 seconds)
    if gemini_rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.response.send_message("⏰ **Slow down!** Gemini API limit: 1 request per 10 seconds. Please wait.", ephemeral=True)
        return

    # Check question length
    if len(question) > 2000:
        await interaction.response.send_message("❌ Your question is too long! Please keep it under 2000 characters.")
        return

    await interaction.response.defer()

    try:
        # Coding assistant system instruction
        coder_instruction = """You are an expert programming assistant specializing
in practical, working code solutions.

RESPONSE FORMAT:
1. Acknowledge the problem
2. Provide working code (formatted in Discord markdown code blocks)
3. Explain what the code does
4. Mention edge cases or gotchas
5. Suggest improvements or alternatives

STYLE:
- Focus on WORKING solutions first, elegance second
- Use proper syntax for Discord markdown code blocks (```python, ```javascript, etc.)
- Assume modern best practices (async, type hints, etc.)
- Mention dependencies if needed
- If question is unclear, ask for clarification

LANGUAGES YOU EXCEL AT:
- Python (your specialty)
- JavaScript/TypeScript
- Shell scripting
- SQL
- HTML/CSS
- Any other language they ask about

Example structure:
"Here's how to [solve problem]:

```python
# Working code here with comments
```

This works because [explanation].

⚠️ Watch out for [gotcha].

Alternative approach: [if applicable]"

RULES:
- Always use proper code block formatting for Discord
- Provide complete, runnable code when possible
- Explain WHY something works, not just HOW
- Be concise but thorough
- If showing multiple languages, label each code block
- Include error handling when relevant"""

        # Wrap API call with retry logic and fallbacks
        def make_call_factory(model_name):
            async def make_call():
                return await gemini_client.aio.models.generate_content(
                    model=model_name,
                    contents=question,
                    config=types.GenerateContentConfig(
                        system_instruction=coder_instruction,
                        temperature=0.7  # Balanced for code accuracy and creativity
                    )
                )
            return make_call

        response = await call_gemini_with_retry(make_call_factory)

        message_content = f"💻 **Coding Help:**\n\n{response.text}"

        # If response is too long for Discord, send as text file
        if len(message_content) > 2000:
            file_content = io.BytesIO(message_content.encode('utf-8'))
            file = discord.File(file_content, filename="coder_response.txt")
            await interaction.followup.send("Coding help response was too long, sent as file:", file=file)
        else:
            await interaction.followup.send(message_content)

        logger.info("✅ /coder command success for %s", interaction.user.name)

    except Exception as e:
        logger.error("Error in coder_command: %s", e)
        await interaction.followup.send("❌ Error generating code solution. Please try again.")


@bot.tree.command(name="describe", description="Describe an image using AI")
@app_commands.choices(style=[
    app_commands.Choice(name="Danbooru Tags", value="danbooru"),
    app_commands.Choice(name="Natural Language", value="natural"),
])
async def describe_command(interaction: discord.Interaction, image: discord.Attachment, style: app_commands.Choice[str]):
    """Slash command to describe an image using Gemini vision.

    Args:
        interaction: Discord interaction
        image: Image attachment to describe
        style: Description style (danbooru tags or natural language)
    """
    # Check if describe feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "describe" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    # STRICT rate limit for Gemini API (1 per 10 seconds)
    if gemini_rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.response.send_message("⏰ **Slow down!** Gemini API limit: 1 request per 10 seconds. Please wait.", ephemeral=True)
        return

    # Validate file type
    if not image.content_type or not image.content_type.startswith("image/"):
        await interaction.response.send_message("❌ Please provide a valid image file.")
        return

    # Validate file size (10MB limit)
    if image.size > SCAN_LIMIT_BYTES:
        size_mb = image.size / (1024 * 1024)
        limit_mb = SCAN_LIMIT_BYTES / (1024 * 1024)
        await interaction.response.send_message(f"❌ File too large ({size_mb:.1f}MB). Max: {limit_mb:.1f}MB.")
        return

    await interaction.response.defer()

    try:
        image_data = await image.read()

        # Create image part for Gemini
        image_part = types.Part.from_bytes(
            data=image_data,
            mime_type=image.content_type
        )

        if style.value == "danbooru":
            prompt_text = "Describe this image using Danbooru-style tags in comma-separated format, like a prompt. Output ONLY the tags separated by commas, no bullet points or explanations. Focus on descriptive tags about the character, clothing, pose, background, and art style. Exclude metadata tags like 'masterpiece' or 'high quality'. Example format: '1girl, long hair, blue eyes, school uniform, standing, outdoor, cherry blossoms, anime style'"
        else:
            prompt_text = "Describe this image in natural, descriptive language."

        # Use the new SDK's generate_content method with retry logic and fallbacks
        def make_call_factory(model_name):
            async def make_call():
                return await gemini_client.aio.models.generate_content(
                    model=model_name,
                    contents=[prompt_text, image_part]
                )
            return make_call

        response = await call_gemini_with_retry(make_call_factory)

        message_content = f"🎨 **Image Description ({style.name}):**\n\n{response.text}"

        # If response is too long for Discord, send as text file
        if len(message_content) > 2000:
            file_content = io.BytesIO(message_content.encode('utf-8'))
            file = discord.File(file_content, filename="description.txt")
            await interaction.followup.send("Image description was too long, sent as file:", file=file)
        else:
            await interaction.followup.send(message_content)

        logger.info("✅ /describe command success for %s", interaction.user.name)

    except Exception as e:
        logger.error("Error in describe_command: %s", e)
        await interaction.followup.send(f"❌ Error generating description: {str(e)}")


conversation_sessions = {}

async def call_gemini_with_retry(api_call_factory, max_retries: int = None, base_delay: float = None, fallback_models: list = None):
    """Call Gemini API with exponential backoff retry for 503 errors and model fallbacks.

    Args:
        api_call_factory: Callable that takes a model name and returns an async callable for the API call
        max_retries: Maximum number of retry attempts per model (defaults to config value)
        base_delay: Base delay in seconds (doubles with each retry, defaults to config value)
        fallback_models: List of model names to try as fallbacks (defaults to config value)

    Returns:
        API response

    Raises:
        Exception: If all retries and fallbacks fail
    """
    if max_retries is None:
        max_retries = GEMINI_MAX_RETRIES
    if base_delay is None:
        base_delay = GEMINI_RETRY_DELAY
    if fallback_models is None:
        fallback_models = GEMINI_FALLBACK_MODELS

    last_error = None

    # Try each model in the fallback chain
    for model_idx, model_name in enumerate(fallback_models):
        if model_idx > 0:
            logger.info(f"Trying fallback model: {model_name}")

        # Try the current model with retries
        for attempt in range(max_retries):
            try:
                api_call = api_call_factory(model_name)
                return await api_call()
            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check if it's a 503 error or rate limit
                is_service_error = any(keyword in error_str for keyword in [
                    '503', 'service unavailable', 'overloaded', 'rate limit', '429'
                ])

                if is_service_error:
                    if attempt < max_retries - 1:
                        # Retry with exponential backoff
                        delay = base_delay * (2 ** attempt)
                        logger.warning(f"Gemini error with {model_name} (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                        await asyncio.sleep(delay)
                        continue
                    elif model_idx < len(fallback_models) - 1:
                        # Try next fallback model
                        logger.warning(f"Model {model_name} failed after {max_retries} attempts, trying fallback...")
                        break
                    else:
                        # All models exhausted
                        logger.error(f"All Gemini models failed after retries")
                else:
                    # Not a service error, don't retry
                    raise

    # All retries and fallbacks failed
    raise last_error

async def ask_gemini(user: discord.User, question: str) -> str:
    """Asks a question to the Gemini API using the new SDK with retry and fallback support."""
    if not gemini_client:
        return "❌ Gemini API key is not configured."

    try:
        # Get or create chat session for the user
        if user.id not in conversation_sessions:
            # Create new chat session with system instruction (using primary model)
            conversation_sessions[user.id] = gemini_client.aio.chats.create(
                model=GEMINI_PRIMARY_MODEL,
                config=types.GenerateContentConfig(
                    system_instruction="You are a helpful assistant. Your goal is to provide accurate and concise answers."
                )
            )

        chat = conversation_sessions[user.id]

        # Send message with retry logic
        def make_call_factory(model_name):
            async def make_call():
                # For chat sessions, we need to recreate the session if switching models
                nonlocal chat
                if model_name != GEMINI_PRIMARY_MODEL:
                    logger.info(f"Recreating chat session with fallback model: {model_name}")
                    chat = gemini_client.aio.chats.create(
                        model=model_name,
                        config=types.GenerateContentConfig(
                            system_instruction="You are a helpful assistant. Your goal is to provide accurate and concise answers."
                        )
                    )
                    conversation_sessions[user.id] = chat

                return await chat.send_message(question)
            return make_call

        response = await call_gemini_with_retry(make_call_factory)
        return response.text

    except Exception as e:
        logger.error("Error calling Gemini API: %s", e)
        return f"❌ Error generating response: {e}"




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

    # Get PNG/JPEG/WebP attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        await interaction.followup.send(
            "❌ No PNG, JPEG, or WebP images found in this message.",
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
async def on_close():
    """Cleanup handler for graceful shutdown."""
    logger.info("👋 Bot shutting down gracefully...")
    # Close all aiohttp sessions
    try:
        # Clear conversation sessions to prevent memory leaks
        global conversation_sessions
        conversation_sessions.clear()
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
    # Give aiohttp time to cleanup sessions
    await asyncio.sleep(0.1)

@bot.event
async def on_disconnect():
    """Handle disconnection from Discord."""
    logger.warning("⚠️ Bot disconnected from Discord! Will attempt to reconnect...")

@bot.event
async def on_resumed():
    """Handle reconnection to Discord."""
    logger.info("✅ Bot reconnected to Discord successfully!")

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

    # Add retry logic with EXPONENTIAL BACKOFF to prevent Cloudflare rate limiting
    max_retries = 5
    retry_count = 0

    while retry_count < max_retries:
        try:
            bot.run(BOT_TOKEN, reconnect=True)
            break  # Exit loop if bot stops gracefully
        except discord.LoginFailure:
            logger.error("❌ INVALID TOKEN - Bot token may be banned or revoked!")
            break  # Don't retry on auth failures
        except discord.HTTPException as e:
            # Check if it's a rate limit error (429 or Cloudflare block)
            if '429' in str(e) or 'rate limit' in str(e).lower() or '1015' in str(e):
                retry_count += 1
                # Exponential backoff: 10s, 20s, 40s, 80s, 160s
                wait_time = min(10 * (2 ** retry_count), 300)  # Cap at 5 minutes
                logger.error(f"⚠️ RATE LIMITED by Discord/Cloudflare (attempt {retry_count}/{max_retries})")
                logger.info(f"🕐 Waiting {wait_time}s before retry to avoid IP ban...")
                import time
                time.sleep(wait_time)
            else:
                # Other Discord HTTP errors
                logger.error(f"❌ Discord HTTP error: {e}")
                raise
        except Exception as e:
            retry_count += 1
            logger.error(f"❌ Bot crashed (attempt {retry_count}/{max_retries}): {e}")
            if retry_count < max_retries:
                # Shorter delay for non-rate-limit errors
                wait_time = 5 * retry_count
                logger.info(f"🔄 Restarting in {wait_time} seconds...")
                import time
                time.sleep(wait_time)
            else:
                logger.error("❌ Max retries reached. Bot shutting down.")
                raise


if __name__ == '__main__':
    main()
