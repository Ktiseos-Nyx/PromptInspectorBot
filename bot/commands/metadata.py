"""Metadata Command - Image metadata extraction

Slash command for extracting and displaying metadata from images.
"""
from typing import TYPE_CHECKING

import discord
from discord import app_commands

if TYPE_CHECKING:
    from discord.ext import commands

from ..config import (
    logger,
    rate_limiter,
    CHANNEL_FEATURES,
    SCAN_LIMIT_BYTES,
    DM_ALLOWED_USER_IDS,
)
from ..guild_settings import get_guild_setting
from ..metadata_helpers import parse_image_metadata
from ..ui_components import FullMetadataView
from utils.discord_formatter import format_metadata_embed


def register_metadata_commands(bot: "commands.Bot"):
    """Register metadata commands with the bot.

    Args:
        bot: The Discord bot instance
    """

    # ============================================================================
    # METADATA COMMAND
    # ============================================================================

    @bot.tree.command(name="metadata", description="Parse metadata from an image")
    async def metadata_command(interaction: discord.Interaction, image: discord.Attachment):
        """Slash command to parse metadata from an uploaded image.

        Args:
            interaction: Discord interaction
            image: Image attachment

        """
        # Check authorization (DM vs Guild)
        if not interaction.guild:
            # DM: Check if user is whitelisted for DMs
            if interaction.user.id not in DM_ALLOWED_USER_IDS:
                await interaction.response.send_message("❌ This command cannot be used in DMs. Please use it in a server.", ephemeral=True)
                return
        else:
            # Guild: Check channel-specific features and guild settings
            if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[interaction.channel.id]:
                await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
                return
            if not get_guild_setting(interaction.guild.id, "metadata", default=True):
                await interaction.response.send_message("❌ Metadata extraction is not enabled in this server.", ephemeral=True)
                return

        await interaction.response.defer()

        # Rate limit check
        if rate_limiter.is_rate_limited(interaction.user.id):
            await interaction.followup.send(
                "⏰ You're making requests too quickly. Please wait a minute.",
            )
            return

        # Validate file type
        if not image.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            await interaction.followup.send(
                "❌ Only PNG, JPEG, and WebP images are supported.",
            )
            return

        # Validate file size
        if image.size > SCAN_LIMIT_BYTES:
            size_mb = image.size / (1024 * 1024)
            limit_mb = SCAN_LIMIT_BYTES / (1024 * 1024)
            await interaction.followup.send(
                f"❌ File too large ({size_mb:.1f}MB). Max: {limit_mb:.1f}MB.",
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
                    image,
                )

                # Create view with "Full Parameters" button
                view = FullMetadataView(metadata)

                await interaction.followup.send(
                    embed=embed,
                    view=view,
                )
                logger.info("✅ /metadata command success for %s", interaction.user.name)
            else:
                await interaction.followup.send(
                    "❌ No metadata found in this image.",
                )
        except Exception as e:
            logger.error("Error in metadata_command: %s", e)
            await interaction.followup.send(
                f"❌ Error parsing metadata: {e!s}",
            )
