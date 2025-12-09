"""UI Components - Discord Modals and Views

Contains all Discord UI components (modals, buttons, views) for the bot.
"""
import io
import json
import time
from typing import Any, Dict

import discord

from .config import logger, config
from .metadata_helpers import get_real_author, format_public_metadata_message
from .security import reformat_json
from utils.discord_formatter import format_metadata_embed, create_full_metadata_text

# ============================================================================
# MODALS
# ============================================================================

class ManualMetadataModal(discord.ui.Modal, title="Add Image Details"):
    """Modal for manual metadata entry when auto-extraction fails."""

    prompt = discord.ui.TextInput(
        label="Positive Prompt",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the positive prompt used to generate this image",
        required=False,
        max_length=2000,
    )

    negative_prompt = discord.ui.TextInput(
        label="Negative Prompt",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the negative prompt (optional)",
        required=False,
        max_length=1000,
    )

    model = discord.ui.TextInput(
        label="Model Name",
        style=discord.TextStyle.short,
        placeholder="e.g., Pony Diffusion XL",
        required=False,
        max_length=200,
    )

    settings = discord.ui.TextInput(
        label="Settings (Steps, CFG, Sampler, etc.)",
        style=discord.TextStyle.paragraph,
        placeholder="e.g., Steps: 30, CFG: 7, Sampler: DPM++ 2M Karras",
        required=False,
        max_length=500,
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
            "parameters": {},
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

# ============================================================================
# VIEWS
# ============================================================================

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
                None,  # No attachment in DM
            )

            # Create view with full metadata button
            view = FullMetadataView(self.metadata)

            # Send to DM
            dm_channel = await interaction.user.create_dm()
            await dm_channel.send(embed=embed, view=view)

            # Acknowledge the button click
            await interaction.response.send_message(
                "✅ Sent full details to your DMs!",
                ephemeral=True,
            )
            logger.info("📬 Sent full metadata DM to %s", interaction.user.name)

        except discord.Forbidden:
            await interaction.response.send_message(
                "❌ Couldn't send DM! Please enable DMs from server members.",
                ephemeral=True,
            )
        except Exception as e:
            logger.error("Error sending DM: %s", e)
            await interaction.response.send_message(
                "❌ Something went wrong!",
                ephemeral=True,
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
                filename="metadata.json",
            )

            # Send as ephemeral message
            await interaction.response.send_message(
                "💾 Here's your metadata JSON!",
                file=file_obj,
                ephemeral=True,
            )
            logger.info("💾 Sent JSON download to %s", interaction.user.name)

        except Exception as e:
            logger.error("Error creating JSON: %s", e)
            await interaction.response.send_message(
                "❌ Couldn't create JSON file!",
                ephemeral=True,
            )

    @discord.ui.button(label="❤️", style=discord.ButtonStyle.success)
    async def react_love(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Just a fun reaction button!"""
        await interaction.response.send_message(
            "💜 Thanks for the love!",
            ephemeral=True,
        )


class FullMetadataView(discord.ui.View):
    """View with button to show full metadata with JSON pretty-printing."""

    def __init__(self, metadata: Dict[str, Any]):
        super().__init__(timeout=3600)
        self.metadata = metadata

    @discord.ui.button(label="📄 Full Parameters", style=discord.ButtonStyle.green)
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
                filename=filename,
            )
            await interaction.followup.send(file=file_obj, ephemeral=True)
        else:
            # Use appropriate code block syntax
            if json_formatted:
                followup_text = f"```json\n{json_formatted}\n```"
            else:
                followup_text = f"```\n{full_text}\n```"

            await interaction.followup.send(followup_text, ephemeral=True)

# ============================================================================
# R2 UPLOAD RATE LIMITING
# ============================================================================

# Rate limiting for uploads (DDoS protection + fair use)
user_upload_timestamps = {}  # {user_id: [timestamp1, timestamp2, ...]}

# Rate limit tiers
MAX_UPLOADS_PER_MINUTE = 10  # Burst protection (DDoS prevention)
MAX_UPLOADS_PER_DAY_FREE = 100  # Free tier (generous!)
MAX_UPLOADS_PER_DAY_SUPPORTER = 500  # Ko-fi supporters (practically unlimited)

# Time windows
BURST_WINDOW = 60  # 1 minute in seconds
DAILY_WINDOW = 86400  # 24 hours in seconds

# Ko-fi supporter role IDs (Admins + Mods + Supporters get higher limits)
# Get these from: Discord Server Settings → Roles → Right-click role → Copy ID
# Can be comma-separated list in env: SUPPORTER_ROLE_IDS=123,456,789
from .config import parse_id_list
SUPPORTER_ROLE_IDS = parse_id_list("SUPPORTER_ROLE_IDS", "SUPPORTER_ROLE_IDS")
# Backward compatibility: also check old KOFI_SUPPORTER_ROLE_ID config
if not SUPPORTER_ROLE_IDS and "KOFI_SUPPORTER_ROLE_ID" in config:
    kofi_role = config.get("KOFI_SUPPORTER_ROLE_ID", 0)
    if kofi_role:
        SUPPORTER_ROLE_IDS = {kofi_role}

def check_upload_rate_limit(user_id: int, user_roles: list = None) -> tuple[bool, int, str]:
    """
    Check if user can upload. Returns (can_upload, remaining_uploads, limit_type).

    Args:
        user_id: Discord user ID
        user_roles: List of role IDs the user has (optional)

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
    if user_roles and SUPPORTER_ROLE_IDS:
        # Check if any of the user's roles are in the supporter set
        is_supporter = bool(set(user_roles) & SUPPORTER_ROLE_IDS)

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
