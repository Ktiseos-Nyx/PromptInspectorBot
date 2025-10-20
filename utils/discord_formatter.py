"""Convert Dataset-Tools metadata to Discord embeds"""
import discord
from typing import Dict, Any, Optional
from dataset_tools.enums import DownField


def format_metadata_embed(
    metadata_dict: Dict[str, Any],
    message_author: discord.User,
    attachment: Optional[discord.Attachment] = None,
    max_fields: int = 25
) -> discord.Embed:
    """Convert Dataset-Tools metadata to Discord embed.

    Args:
        metadata_dict: Metadata from parse_metadata()
        message_author: Discord user who posted the image
        attachment: Optional attachment for image display
        max_fields: Maximum fields to show (Discord limit)

    Returns:
        Discord Embed object
    """
    # Extract tool name
    gen_data = metadata_dict.get(DownField.GENERATION_DATA.value, {})
    tool_name = gen_data.get('Tool', 'Unknown')

    # Create embed
    embed = discord.Embed(
        title=f"{tool_name} Parameters",
        color=message_author.color
    )

    # Priority fields (show first)
    priority_fields = [
        (DownField.POSITIVE_PROMPT.value, "Positive Prompt"),
        (DownField.NEGATIVE_PROMPT.value, "Negative Prompt"),
        (DownField.STEPS.value, "Steps"),
        (DownField.SAMPLER.value, "Sampler"),
        (DownField.CFG_SCALE.value, "CFG Scale"),
        (DownField.SEED.value, "Seed"),
        (DownField.RESOLUTION.value, "Resolution"),
        (DownField.MODEL.value, "Model"),
    ]

    field_count = 0

    # Add priority fields
    for field_key, field_name in priority_fields:
        if field_count >= max_fields:
            break

        value = metadata_dict.get(field_key)
        if value:
            # Handle prompts specially (never inline)
            is_prompt = "prompt" in field_name.lower()
            value_str = str(value)

            # Truncate if too long (Discord 1024 char limit per field)
            if len(value_str) > 1024:
                value_str = value_str[:1021] + "..."

            embed.add_field(
                name=field_name,
                value=value_str,
                inline=not is_prompt and len(value_str) < 32
            )
            field_count += 1

    # Add other generation data
    for key, value in gen_data.items():
        if field_count >= max_fields:
            break

        if key == 'Tool':
            continue  # Already in title

        # Skip if already added as priority field
        if any(metadata_dict.get(pf[0]) == value for pf in priority_fields):
            continue

        value_str = str(value)
        if len(value_str) > 1024:
            value_str = value_str[:1021] + "..."

        embed.add_field(
            name=key,
            value=value_str,
            inline=len(value_str) < 32
        )
        field_count += 1

    # Set footer
    embed.set_footer(
        text=f"Posted by {message_author}",
        icon_url=message_author.display_avatar.url
    )

    # Set image if attachment provided
    if attachment:
        embed.set_image(url=attachment.url)

    return embed


def create_full_metadata_text(metadata_dict: Dict[str, Any]) -> str:
    """Create full metadata text for file attachment.

    Args:
        metadata_dict: Metadata from parse_metadata()

    Returns:
        Formatted text string
    """
    lines = []

    # Add all metadata fields
    for field, value in metadata_dict.items():
        if isinstance(value, dict):
            lines.append(f"\n=== {field} ===")
            for k, v in value.items():
                lines.append(f"{k}: {v}")
        else:
            lines.append(f"{field}: {value}")

    return "\n".join(lines)
