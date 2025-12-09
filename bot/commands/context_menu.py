"""Context menu commands for PromptInspectorBot

Right-click menu commands for Discord messages.
"""
from typing import TYPE_CHECKING

import discord
from utils.discord_formatter import format_metadata_embed

if TYPE_CHECKING:
    from discord.ext import commands


def register_context_menus(bot: "commands.Bot"):
    """Register context menu commands with the bot.

    Args:
        bot: The Discord bot instance
    """
    # Import dependencies
    from ..config import (
        logger,
        DM_ALLOWED_USER_IDS,
        CHANNEL_FEATURES,
        SCAN_LIMIT_BYTES,
        rate_limiter,
    )
    from ..guild_settings import get_guild_setting
    from ..metadata_helpers import parse_image_metadata
    from ..ui_components import FullMetadataView

    @bot.tree.context_menu(name="View Prompts")
    async def view_prompt_context(interaction: discord.Interaction, message: discord.Message):
        """Context menu to view prompts from a message.

        Args:
            interaction: Discord interaction
            message: Target message
        """
        # Check if metadata feature is enabled
        if not interaction.guild:
            # DM: Check if user is whitelisted for DMs
            if interaction.user.id not in DM_ALLOWED_USER_IDS:
                await interaction.response.send_message("L This command cannot be used in DMs. Please use it in a server.", ephemeral=True)
                return
        else:
            # Guild: Check channel-specific features and guild settings
            if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[interaction.channel.id]:
                await interaction.response.send_message("L This command is not enabled in this channel.", ephemeral=True)
                return
            if not get_guild_setting(interaction.guild.id, "metadata", default=True):
                await interaction.response.send_message("L Metadata extraction is not enabled in this server.", ephemeral=True)
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
                "L No PNG, JPEG/WebP images found in this message.",
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
                "L No metadata found in any images.",
                ephemeral=True
            )
