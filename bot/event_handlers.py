"""Event handlers for PromptInspectorBot

This module contains all Discord event handlers:
- on_message: Auto-metadata detection and security scanning
- on_raw_reaction_add: Emoji-based metadata display
- on_ready: Bot startup
- on_guild_join: Server whitelist enforcement
- on_close, on_disconnect, on_resumed: Connection lifecycle
"""
import asyncio
import io
import json
from pathlib import Path
from typing import TYPE_CHECKING

import aiohttp
import discord

if TYPE_CHECKING:
    from discord.ext import commands

# Global state (shared across bot)
processed_attachment_urls = set()
message_metadata_cache = {}
conversation_sessions = {}

# Constants
MAX_TRACKED_ATTACHMENTS = 500
MAX_CACHED_MESSAGES = 100


def register_events(bot: "commands.Bot"):
    """Register all event handlers with the bot.

    Args:
        bot: The Discord bot instance
    """
    # Import dependencies here to avoid circular imports
    from .config import (
        logger,
        DM_ALLOWED_USER_IDS,
        DM_RESPONSE_MESSAGE,
        MONITORED_CHANNEL_IDS,
        CHANNEL_FEATURES,
        TRUSTED_USER_IDS,
        SCAN_LIMIT_BYTES,
        REACT_ON_NO_METADATA,
        EMOJI_NOT_FOUND,
        ALLOWED_GUILD_IDS,
        rate_limiter,
        metadata_processing_semaphore,
    )
    from .guild_settings import get_guild_setting
    from .security import (
        track_message,
        check_cross_posting,
        is_gibberish_or_spam,
        calculate_wallet_scam_score,
        verify_image_safety,
        instant_ban,
        alert_admins,
    )
    from .metadata_helpers import (
        parse_image_metadata,
        get_real_author,
        format_public_metadata_message,
    )
    from .ui_components import (
        ManualEntryPromptView,
        PublicMetadataView,
    )

    @bot.event
    async def on_message(message: discord.Message):
        """Auto-detect metadata in monitored channels and post public reply."""
        # Use global state
        global processed_attachment_urls, message_metadata_cache

        # 1. IGNORE BOTS (Unless it's a webhook which might be PluralKit)
        if message.author.bot and not message.webhook_id:
            # Extra check: make sure bot isn't processing its own messages
            if message.author.id == bot.user.id:
                return
            return

        # 2. RELIABLE DM CHECK - Use explicit channel type check
        # Check explicitly if the channel is a DMChannel
        if isinstance(message.channel, discord.DMChannel):
            # This is a DM - handle DM logic
            if message.author.id not in DM_ALLOWED_USER_IDS:
                try:
                    await message.channel.send(DM_RESPONSE_MESSAGE)
                except discord.Forbidden:
                    # User has DMs blocked
                    pass
                return
            # Allow whitelisted DMs to proceed to metadata processing

        # 3. GUILD MESSAGE PROCESSING
        # If code reaches here, it's a message in a guild channel
        # (TextChannel, Thread, Announcement, etc.)

        # 4. CHANNEL/FEATURE CHECKS
        # Check if this channel or category is monitored
        # For threads/forums, check parent
        channel_id = message.channel.parent_id if hasattr(message.channel, "parent_id") and message.channel.parent_id else message.channel.id

        # If MONITORED_CHANNEL_IDS is set, and this channel isn't in it, STOP HERE.
        if MONITORED_CHANNEL_IDS and channel_id not in MONITORED_CHANNEL_IDS:
            return

        # Check if metadata/security is enabled for this server
        if not get_guild_setting(message.guild.id, "metadata", default=True):
            return

        # ============================================================================
        # SECURITY CHECKS - Run BEFORE processing to catch scammers early
        # ============================================================================

        # Check if security is enabled for this guild
        security_enabled = True
        if message.guild:
            security_enabled = get_guild_setting(message.guild.id, "security", default=True)

        if not security_enabled:
            # Security disabled for this guild, skip all checks
            pass
        else:
            # BYPASS CONDITIONS - Skip security checks for trusted users ONLY
            # 1. Server owner (you literally own the server)
            # 2. Manually trusted users (TRUSTED_USER_IDS in config)
            # NOTE: We don't bypass based on account age anymore - real scammers can be years old!
            is_server_owner = message.guild and message.author.id == message.guild.owner_id
            is_trusted_user = message.author.id in TRUSTED_USER_IDS

            # Full bypass for server owner and manually trusted users
            if is_server_owner or is_trusted_user:
                if is_server_owner:
                    logger.debug(f" Security bypass: {message.author} is server owner")
                # Continue processing normally
            else:
                # Track message for cross-posting detection
                await track_message(message)

                # Get user context for security checks
                # Only Members (in guilds) have roles, Users (in DMs) don't
                user_has_roles = isinstance(message.author, discord.Member) and len(message.author.roles) > 1

                # --- UNIFIED IMAGE GATHERING (Attachments & Embeds) ---
                images_to_check = []

                # 1. Gather from attachments
                for attachment in message.attachments:
                    if attachment.content_type and attachment.content_type.startswith("image/"):
                        images_to_check.append({
                            "source": "attachment",
                            "object": attachment,
                            "filename": attachment.filename,
                        })

                # 2. Gather from embeds
                for embed in message.embeds:
                    if embed.image and embed.image.url:
                        # To get a filename, we'll parse it from the URL
                        filename = Path(embed.image.url).name.split("?")[0]
                        images_to_check.append({
                            "source": "embed",
                            "object": embed.image,
                            "filename": filename,
                        })

                image_count = len(images_to_check)
                has_images = image_count > 0

                # === CHECK 1: MAGIC BYTES - Detect malware disguised as images ===
                if has_images:
                    # Use a single session for all downloads
                    async with aiohttp.ClientSession() as session:
                        for image_info in images_to_check:
                            try:
                                file_data = None
                                if image_info["source"] == "attachment":
                                    # Read from attachment
                                    file_data = await image_info["object"].read()
                                elif image_info["source"] == "embed":
                                    # Download from embed URL
                                    async with session.get(image_info["object"].url) as response:
                                        if response.status == 200:
                                            file_data = await response.read()
                                        else:
                                            logger.warning(f"Failed to download embed image: {image_info['object'].url} (Status: {response.status})")
                                            continue

                                if file_data:
                                    is_safe, reason = verify_image_safety(file_data, image_info["filename"])
                                    if not is_safe:
                                        # INSTANT BAN - Malware detected
                                        await instant_ban(message, f"{reason} from {image_info['source']}")
                                        return

                            except Exception as e:
                                logger.warning(f"Error checking file safety for {image_info['filename']}: {e}")

                # === CHECK 2: SCREENSHOT SPAMMER (4+ images + cross-posting) ===
                if image_count >= 4:
                    cross_post_count = await check_cross_posting(message)

                    # 4+ images posted to 2+ channels = INSTANT BAN
                    if cross_post_count >= 2:
                        await instant_ban(
                            message,
                            f"Screenshot spam ({image_count} images, {cross_post_count} channels)",
                            [f"{image_count} images", f"{cross_post_count} channels", "Cross-posting"],
                        )
                        return

                    # 4+ images + no roles + gibberish = ALSO INSTANT BAN
                    if not user_has_roles:
                        # The `has_images` flag is passed here to prevent false positives on image-only posts
                        if is_gibberish_or_spam(message.content, user_has_roles=False, has_images=has_images):
                            await instant_ban(
                                message,
                                f"Screenshot spam ({image_count} images + gibberish)",
                                [f"{image_count} images", "No roles", "Gibberish text"],
                            )
                            return

                # === CHECK 3: WALLET SCAMMER (crypto keywords, caps spam, etc.) ===
                scam_score, reasons = calculate_wallet_scam_score(message)

                if scam_score >= 100:
                    # High confidence scam - INSTANT BAN (regardless of account age)
                    await instant_ban(message, f"Wallet scam (Score: {scam_score})", reasons)
                    return

                if scam_score >= 75:
                    # Medium confidence - Delete message and alert admins
                    logger.warning(f"� Suspicious message from {message.author} (Score: {scam_score})")
                    try:
                        await message.delete()
                        await alert_admins(message.guild, message.author, f"Suspicious (Score: {scam_score})", reasons, action="DELETED")
                    except discord.Forbidden:
                        logger.warning("Missing permissions to delete suspicious message")
                    return

                if scam_score >= 50:
                    # Low confidence - Just log for monitoring
                    logger.info(f"=� Watchlist: {message.author} (Score: {scam_score}) - {', '.join(reasons[:3])}")

        # ============================================================================
        # END SECURITY CHECKS
        # ============================================================================

        # Only process in monitored channels (empty set = monitor all channels)
        # For threads/forums, check the parent channel ID
        channel_to_check = message.channel.parent_id if hasattr(message.channel, "parent_id") and message.channel.parent_id else message.channel.id
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
            if a.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and a.size < SCAN_LIMIT_BYTES
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
            # IMPORTANT: Discord strips JPEG/WebP metadata during processing!
            # If we scan too fast, we'll see metadata that gets deleted moments later.
            # Wait for Discord to finish processing before scanning.
            has_jpeg_or_webp = any(
                a.filename.lower().endswith((".jpg", ".jpeg", ".webp"))
                for a in attachments
            )
            if has_jpeg_or_webp:
                # Give Discord time to strip metadata from JPEGs/WebP
                await asyncio.sleep(2.0)
                logger.debug("Waited for Discord to process JPEG/WebP files")

            # Scan ALL images for metadata
            # Use semaphore to process one image at a time (prevents CPU spikes & RAM overflow)
            images_with_metadata = []
            for attachment in attachments:
                # Semaphore ensures only 1 image processes at a time
                async with metadata_processing_semaphore:
                    image_data = await attachment.read()
                    metadata = await parse_image_metadata(image_data, attachment.filename)
                    if metadata:
                        # Log what type of metadata was found
                        metadata_type = metadata.get("tool", "Unknown")
                        logger.info(" Found metadata in %s - Type: %s", attachment.filename, metadata_type)
                        images_with_metadata.append({
                            "attachment": attachment,
                            "metadata": metadata,
                        })
                    else:
                        logger.info("L No metadata found in %s", attachment.filename)

            if not images_with_metadata:
                # No metadata in any image
                # Check if images are JPG/WebP (Discord strips metadata from these)
                first_image = attachments[0]
                is_jpg_or_webp = first_image.filename.lower().endswith((".jpg", ".jpeg", ".webp"))

                # Only react with � for PNG files with no metadata
                # JPEG/WebP never have metadata anyway, so don't spam reactions
                if REACT_ON_NO_METADATA and not is_jpg_or_webp:
                    await message.add_reaction(EMOJI_NOT_FOUND)
                    logger.info("L No metadata in PNG image")

                # Customize message based on file type
                if is_jpg_or_webp:
                    no_metadata_msg = (
                        "=� **JPEG/WebP detected!**\n"
                        "Discord strips metadata from these formats when uploaded.\n\n"
                        "=� **Options:**\n"
                        "• Use `/describe` to generate AI tags\n"
                        "• Re-upload as PNG to preserve metadata\n"
                        "• Add details manually below"
                    )
                else:
                    no_metadata_msg = "9 No metadata found in these images. Would you like to add details manually?"

                # Offer manual entry for first image
                view = ManualEntryPromptView(message, first_image)
                try:
                    await message.reply(
                        no_metadata_msg,
                        view=view,
                        mention_author=False,
                    )
                except discord.NotFound:
                    logger.debug("Original message deleted, posting to channel instead")
                    await message.channel.send(
                        no_metadata_msg,
                        view=view,
                    )
                return

            # Found metadata! Store in cache for later retrieval
            message_metadata_cache[message.id] = images_with_metadata

            # Limit cache size
            if len(message_metadata_cache) > MAX_CACHED_MESSAGES:
                # Remove oldest entries (first 20)
                oldest_keys = list(message_metadata_cache.keys())[:20]
                for key in oldest_keys:
                    del message_metadata_cache[key]

            # Check if all images are JPEG/WebP (likely false positives due to Discord race condition)
            all_stripped_formats = all(
                img["attachment"].filename.lower().endswith((".jpg", ".jpeg", ".webp"))
                for img in images_with_metadata
            )

            if all_stripped_formats:
                # Don't add emoji reactions for JPEG/WebP - Discord strips metadata anyway
                # Any "metadata" found is likely a race condition before Discord finishes processing
                logger.info("� Skipping emoji reactions for JPEG/WebP (Discord strips metadata)")
                # Show helpful message instead
                await message.reply(
                    "=� **JPEG/WebP detected!**\n"
                    "These formats lose metadata on Discord.\n\n"
                    "=� Use `/describe` to generate AI tags for these images!",
                    mention_author=False,
                )
                return

            # Decide reaction strategy based on count (PNG files only at this point)
            num_images = len(images_with_metadata)

            if num_images <= 5:
                # 1-5 images: Add numbered reactions
                number_emojis = ["1�", "2�", "3�", "4�", "5�"]
                for i in range(num_images):
                    await message.add_reaction(number_emojis[i])
                logger.info(" Added %d numbered reactions for individual inspection", num_images)
            else:
                # 6+ images: Add single reaction for batch download
                await message.add_reaction("=�")
                logger.info(" Added batch reaction for %d images", num_images)

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
        # Use global state
        global message_metadata_cache

        # Reactions only work in guilds, not DMs
        if not payload.guild_id:
            return

        # For threads/forums, check parent channel ID
        channel = bot.get_channel(payload.channel_id)
        channel_id_to_check = channel.parent_id if hasattr(channel, "parent_id") and channel.parent_id else payload.channel_id

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
        number_emojis = ["1�", "2�", "3�", "4�", "5�"]

        # Only respond to our special emojis
        if emoji_name not in number_emojis and emoji_name != "=�":
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

            if emoji_name == "=�":
                # Batch download - create JSON with all metadata
                batch_data = {
                    "batch_size": len(images_with_metadata),
                    "images": [],
                }

                for item in images_with_metadata:
                    batch_data["images"].append({
                        "filename": item["attachment"].filename,
                        "url": item["attachment"].url,
                        "metadata": item["metadata"],
                    })

                # Create JSON file
                json_str = json.dumps(batch_data, indent=2)
                file_obj = discord.File(
                    io.StringIO(json_str),
                    filename=f"batch_metadata_{len(images_with_metadata)}_images.json",
                )

                # Send to user
                await message.reply(
                    f"=� **Batch Metadata** ({len(images_with_metadata)} images with metadata)\n"
                    f"Downloaded by {payload.member.mention}",
                    file=file_obj,
                    mention_author=False,
                )
                logger.info(" Sent batch metadata for %d images (clicked by %s)",
                           len(images_with_metadata), payload.member.name)

            elif emoji_name in number_emojis:
                # Individual image - find which number
                image_index = number_emojis.index(emoji_name)

                if image_index >= len(images_with_metadata):
                    logger.warning("Image index %d out of range for message %s", image_index, payload.message_id)
                    return

                # Get the specific image's metadata
                item = images_with_metadata[image_index]
                metadata = item["metadata"]

                # Format public message
                public_message = format_public_metadata_message(metadata, real_author)
                public_message = f"**Image {image_index + 1}/{len(images_with_metadata)}**\n\n{public_message}"

                # Create view with buttons
                view = PublicMetadataView(metadata, real_author)

                # Reply to the original message
                await message.reply(public_message, view=view, mention_author=False)

                logger.info(" Posted metadata for image %d/%d (clicked by %s)",
                            image_index + 1, len(images_with_metadata), payload.member.name)

        except Exception as e:
            logger.error("Error in on_raw_reaction_add: %s", e)

    @bot.event
    async def on_close():
        """Cleanup handler for graceful shutdown."""
        global conversation_sessions
        logger.info("=K Bot shutting down gracefully...")
        # Close all aiohttp sessions
        try:
            # Clear conversation sessions to prevent memory leaks
            conversation_sessions.clear()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
        # Give aiohttp time to cleanup sessions
        await asyncio.sleep(0.1)

    @bot.event
    async def on_disconnect():
        """Handle disconnection from Discord."""
        logger.warning("� Bot disconnected from Discord! Will attempt to reconnect...")

    @bot.event
    async def on_resumed():
        """Handle reconnection to Discord."""
        logger.info(" Bot reconnected to Discord successfully!")

    @bot.event
    async def on_guild_join(guild: discord.Guild):
        """Handle bot being added to a new server - check whitelist."""
        # If whitelist is empty, allow all servers (public mode)
        if not ALLOWED_GUILD_IDS:
            logger.info(" Joined server: %s (ID: %s) - Public mode, all servers allowed", guild.name, guild.id)
            return

        # Check if server is whitelisted
        if guild.id not in ALLOWED_GUILD_IDS:
            logger.warning("� UNAUTHORIZED server join: %s (ID: %s) - Auto-leaving!", guild.name, guild.id)

            # Try to notify the server owner
            try:
                owner = guild.owner
                if owner:
                    await owner.send(
                        f"=K Hello! Thanks for trying to add **{bot.user.name}** to **{guild.name}**!\n\n"
                        f"However, this is a **private bot instance** and only available in authorized servers.\n\n"
                        f"If you'd like to use this bot, you can:\n"
                        f"• Self-host your own instance: https://github.com/Ktiseos-Nyx/PromptInspectorBot\n"
                        f"• Contact the bot owner to request access\n\n"
                        f"The bot has automatically left your server. Sorry for the inconvenience!"
                    )
                    logger.info("=� Sent notification to server owner: %s", owner.name)
            except discord.Forbidden:
                logger.warning("Couldn't DM server owner (DMs disabled)")
            except Exception as e:
                logger.error("Error notifying server owner: %s", e)

            # Leave the server
            await guild.leave()
            logger.info("=K Left unauthorized server: %s", guild.name)
        else:
            logger.info(" Joined whitelisted server: %s (ID: %s)", guild.name, guild.id)

    @bot.event
    async def on_ready():
        """Bot startup handler."""
        logger.info(" Logged in as %s!", bot.user)
        logger.info("=� Monitoring %s channels", len(MONITORED_CHANNEL_IDS))

        # Log whitelist status
        if ALLOWED_GUILD_IDS:
            logger.info("= Guild whitelist enabled: %s authorized servers", len(ALLOWED_GUILD_IDS))
        else:
            logger.info("< Public mode: All servers allowed")

        # Sync slash commands
        try:
            synced = await bot.tree.sync()
            logger.info("� Synced %s slash commands", len(synced))
        except Exception as e:
            logger.error("Failed to sync commands: %s", e)
