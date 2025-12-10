"""R2 upload command for PromptInspectorBot

Allows users to upload images to Cloudflare R2 for metadata extraction.
"""
import io
import json
import time
import urllib.parse
import uuid
from typing import TYPE_CHECKING

import botocore
import discord
from utils.discord_formatter import format_metadata_embed

if TYPE_CHECKING:
    from discord.ext import commands

# Global state for rate limiting
user_upload_timestamps = {}  # {user_id: [timestamp1, timestamp2, ...]}

# Rate limit constants
MAX_UPLOADS_PER_MINUTE = 10  # Burst protection (DDoS prevention)
MAX_UPLOADS_PER_DAY_FREE = 100  # Free tier (generous!)
MAX_UPLOADS_PER_DAY_SUPPORTER = 500  # Ko-fi supporters (practically unlimited)

# Time windows
BURST_WINDOW = 60  # 1 minute in seconds
DAILY_WINDOW = 86400  # 24 hours in seconds


def check_upload_rate_limit(user_id: int, user_roles: list, supporter_role_ids: set) -> tuple[bool, int, str]:
    """
    Check if user can upload. Returns (can_upload, remaining_uploads, limit_type).

    Args:
        user_id: Discord user ID
        user_roles: List of role IDs the user has
        supporter_role_ids: Set of role IDs that grant supporter status

    Returns:
        (can_upload, remaining, limit_type) where limit_type is 'burst', 'daily_free', or 'daily_supporter'
    """
    current_time = time.time()

    # Initialize user timestamps if needed
    if user_id not in user_upload_timestamps:
        user_upload_timestamps[user_id] = []

    # Clean old timestamps (remove anything older than 24 hours)
    user_upload_timestamps[user_id] = [
        ts for ts in user_upload_timestamps[user_id]
        if current_time - ts < DAILY_WINDOW
    ]

    # Check if user is a supporter (Ko-fi, Admin, or Mod)
    is_supporter = False
    if user_roles and supporter_role_ids:
        # Check if any of the user's roles are in the supporter set
        is_supporter = bool(set(user_roles) & supporter_role_ids)

    # BURST PROTECTION (applies to everyone, even supporters)
    burst_uploads = [
        ts for ts in user_upload_timestamps[user_id]
        if current_time - ts < BURST_WINDOW
    ]
    if len(burst_uploads) >= MAX_UPLOADS_PER_MINUTE:
        return (False, 0, "burst")

    # DAILY LIMIT (varies by supporter status)
    daily_uploads = len(user_upload_timestamps[user_id])
    max_daily = MAX_UPLOADS_PER_DAY_SUPPORTER if is_supporter else MAX_UPLOADS_PER_DAY_FREE

    if daily_uploads >= max_daily:
        limit_type = "daily_supporter" if is_supporter else "daily_free"
        return (False, 0, limit_type)

    # User can upload! Track this upload
    user_upload_timestamps[user_id].append(current_time)
    remaining = max_daily - daily_uploads - 1
    limit_type = "daily_supporter" if is_supporter else "daily_free"

    return (True, remaining, limit_type)


def register_upload_command(bot: "commands.Bot"):
    """Register upload command with the bot (only if R2 is enabled).

    Args:
        bot: The Discord bot instance
    """
    # Import dependencies
    from ..config import (
        logger,
        DM_ALLOWED_USER_IDS,
        ALLOWED_GUILD_IDS,
        R2_ENABLED,
        r2_client,
        R2_BUCKET_NAME,
        R2_UPLOAD_EXPIRATION,
        UPLOADER_URL,
        SUPPORTER_ROLE_IDS,
    )
    from ..metadata_helpers import parse_image_metadata
    from ..ui_components import FullMetadataView

    # Only register if R2 is enabled
    if not R2_ENABLED:
        logger.info("R2 not enabled, skipping /upload_image command")
        return

    @bot.tree.command(name="upload_image", description="Upload up to 10 JPEG/WebP images to extract metadata.")
    async def upload_image_command(interaction: discord.Interaction, private: bool = False):
        """Upload images to R2 for metadata extraction.

        Args:
            private: If True, response is only visible to you (ephemeral)
        """
        if not R2_ENABLED or not r2_client:
            await interaction.response.send_message("L R2 upload feature is not configured on the bot.", ephemeral=True)
            return

        # Check if command is used in an authorized guild or by whitelisted DM user
        if not interaction.guild:
            # DM: Check if user is whitelisted for DMs
            if interaction.user.id not in DM_ALLOWED_USER_IDS:
                await interaction.response.send_message("L This command cannot be used in DMs. Please use it in an authorized server.", ephemeral=True)
                return
        elif ALLOWED_GUILD_IDS:
            # Guild: Check if guild is whitelisted (if whitelist is enabled)
            if interaction.guild.id not in ALLOWED_GUILD_IDS:
                await interaction.response.send_message("L This bot is not authorized for use in this server.", ephemeral=True)
                return

        # Check rate limit (with role-based limits)
        user_role_ids = [role.id for role in interaction.user.roles] if hasattr(interaction.user, "roles") else []
        can_upload, remaining, limit_type = check_upload_rate_limit(interaction.user.id, user_role_ids, SUPPORTER_ROLE_IDS)

        if not can_upload:
            # Different messages based on limit type
            if limit_type == "burst":
                await interaction.response.send_message(
                    "⏰ **Whoa there!** You're uploading too fast. Please wait a minute before trying again.\n"
                    "_(DDoS protection: Max 10 uploads per minute)_",
                    ephemeral=True,
                )
            elif limit_type == "daily_supporter":
                await interaction.response.send_message(
                    f" **Ko-fi Supporter limit reached!** You've hit your {MAX_UPLOADS_PER_DAY_SUPPORTER} uploads/day limit. Try again tomorrow!\n"
                    "_(This is to protect R2 storage costs)_",
                    ephemeral=True,
                )
            else:  # daily_free
                await interaction.response.send_message(
                    f"=� **Daily limit reached!** Free users get {MAX_UPLOADS_PER_DAY_FREE} uploads per day.\n\n"
                    f"=� **Want unlimited?** Support us on Ko-fi to get {MAX_UPLOADS_PER_DAY_SUPPORTER} uploads/day!\n"
                    f"= https://ko-fi.com/OTNAngel/",
                    ephemeral=True,
                )
            return

        await interaction.response.defer(ephemeral=private, thinking=True)

        try:
            # Generate unique keys and presigned URLs for up to 10 files
            MAX_FILES = 10
            file_keys = []
            upload_urls = []

            for i in range(MAX_FILES):
                file_key = f"uploads/{uuid.uuid4()}.tmp"
                presigned_url = r2_client.generate_presigned_url(
                    "put_object",
                    Params={"Bucket": R2_BUCKET_NAME, "Key": file_key},
                    ExpiresIn=R2_UPLOAD_EXPIRATION,
                )
                file_keys.append(file_key)
                upload_urls.append(presigned_url)

            # --- Define the View with the Button and its Callback ---
            view = discord.ui.View(timeout=R2_UPLOAD_EXPIRATION)

            async def process_button_callback(button_interaction: discord.Interaction):
                # The callback has access to 'file_keys' from the outer scope
                await button_interaction.response.defer(thinking=True, ephemeral=private)

                try:
                    # Try to download and process each uploaded file
                    processed_count = 0
                    files_to_cleanup = []

                    for idx, file_key in enumerate(file_keys):
                        try:
                            # Check if file exists
                            response = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=file_key)
                            image_data = response["Body"].read()
                            files_to_cleanup.append(file_key)
                            logger.info(f"Downloaded {file_key} from R2 for processing by {button_interaction.user.name}")

                            # Parse metadata
                            metadata = await parse_image_metadata(image_data, file_key)

                            if metadata:
                                embed = format_metadata_embed(metadata, button_interaction.user)
                                view = FullMetadataView(metadata)

                                # Save the image to a Discord file so it displays in the embed
                                # Convert .tmp to .png for better Discord compatibility
                                image_file = discord.File(
                                    io.BytesIO(image_data),
                                    filename=f"{button_interaction.user.name}_upload_{idx+1}.png",
                                )

                                # Attach the image to the embed
                                embed.set_image(url=f"attachment://{button_interaction.user.name}_upload_{idx+1}.png")

                                # Send to channel or ephemeral based on private setting
                                if private:
                                    await button_interaction.followup.send(
                                        f"( Metadata from image {idx+1}:",
                                        embed=embed,
                                        file=image_file,
                                        view=view,
                                        ephemeral=True,
                                    )
                                else:
                                    await interaction.channel.send(
                                        f"( Metadata processed for {button_interaction.user.mention} (image {idx+1}):",
                                        embed=embed,
                                        file=image_file,
                                        view=view,
                                    )
                                processed_count += 1

                        except botocore.exceptions.ClientError as e:
                            if e.response["Error"]["Code"] == "NoSuchKey":
                                # File doesn't exist, skip it (user didn't upload this slot)
                                continue
                            else:
                                logger.error(f"R2 error for {file_key}: {e}")

                    # Clean up all uploaded files
                    for file_key in files_to_cleanup:
                        try:
                            r2_client.delete_object(Bucket=R2_BUCKET_NAME, Key=file_key)
                            logger.info(f"Cleaned up {file_key} from R2 bucket.")
                        except Exception as e:
                            logger.error(f"Failed to delete {file_key} from R2: {e}")

                    # Send summary
                    if processed_count > 0:
                        await button_interaction.followup.send(
                            f" Successfully processed {processed_count} image(s)!",
                            ephemeral=True,
                        )
                    else:
                        await button_interaction.followup.send(
                            "L No images found or no metadata in uploaded images.",
                            ephemeral=True,
                        )

                except Exception as e:
                    logger.error(f"Error processing R2 uploads: {e}")
                    await button_interaction.followup.send(f"L An unexpected error occurred: {e}", ephemeral=True)

                # Disable the button after it's been used
                button.disabled = True
                await interaction.edit_original_response(view=view)


            process_button = discord.ui.Button(
                label="Process Uploaded Images",
                style=discord.ButtonStyle.green,
            )
            process_button.callback = process_button_callback
            view.add_item(process_button)

            # --- Create and send the initial response ---
            uploader_base_url = UPLOADER_URL
            # Pass multiple upload URLs as JSON array
            params = {"upload_urls": json.dumps(upload_urls)}
            uploader_link = f"{uploader_base_url}?{urllib.parse.urlencode(params)}"

            # Add upload link as a button (presigned URLs are too long for embed fields)
            upload_button = discord.ui.Button(
                label="📤 Open Uploader",
                url=uploader_link,
                style=discord.ButtonStyle.link,
            )
            view.add_item(upload_button)

            # Determine user tier for display
            is_supporter = bool(set(user_role_ids) & SUPPORTER_ROLE_IDS) if SUPPORTER_ROLE_IDS else False
            tier_name = "Ko-fi Supporter" if is_supporter else "Free"
            max_daily = MAX_UPLOADS_PER_DAY_SUPPORTER if is_supporter else MAX_UPLOADS_PER_DAY_FREE

            embed = discord.Embed(
                title="=� Upload Images for Metadata Extraction",
                description=(
                    "Upload up to 10 JPEG or WebP files to extract metadata:\n\n"
                    "1. **Click the link below** to open the uploader\n"
                    "2. **Select up to 10 images** (Max 10MB each)\n"
                    "3. **Click Upload** for each file\n"
                    "4. Come back and click **Process Uploaded Images** when done"
                ),
                color=discord.Color.blue(),
            )
            # Upload link moved to button below (presigned URLs too long for embed fields)
            embed.add_field(
                name="9 Info",
                value=(
                    f"• **{tier_name}** - {remaining}/{max_daily} uploads remaining today\n"
                    f"• **Auto-cleanup** - Files deleted after processing\n"
                    f"• **JPEG/WebP only** - For ComfyUI/A1111/Forge metadata\n"
                    f"• **Max 10MB** per file"
                ),
                inline=False,
            )
            if not is_supporter:
                embed.add_field(
                    name="=� Want More Uploads?",
                    value=f"[Support on Ko-fi](https://ko-fi.com/OTNAngel/) to get {MAX_UPLOADS_PER_DAY_SUPPORTER} uploads/day!",
                    inline=False,
                )
            embed.set_footer(text=f"Link valid for {R2_UPLOAD_EXPIRATION // 60} min • Need help? discord.gg/HhBSvM9gBY")

            await interaction.followup.send(embed=embed, view=view)

        except Exception as e:
            logger.error(f"Error generating pre-signed URL: {e}")
            await interaction.followup.send(f"L An error occurred while creating the upload link: {e}", ephemeral=True)
