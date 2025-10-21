"""Convert Dataset-Tools metadata to Discord embeds"""
import discord
from typing import Dict, Any, Optional


def format_metadata_embed(
    metadata_dict: Dict[str, Any],
    message_author: discord.User,
    attachment: Optional[discord.Attachment] = None,
    max_fields: int = 25
) -> discord.Embed:
    """Convert Dataset-Tools metadata to Discord embed.

    Args:
        metadata_dict: Metadata from Dataset-Tools metadata engine
        message_author: Discord user who posted the image
        attachment: Optional attachment for image display
        max_fields: Maximum fields to show (Discord limit)

    Returns:
        Discord Embed object

    Note:
        Expects new metadata engine format:
        {
            "tool": "Tool Name",
            "format": "Format description",
            "prompt": "positive prompt text",
            "negative_prompt": "negative prompt text",
            "parameters": {
                "steps": 30,
                "sampler_name": "euler",
                "cfg_scale": 7.0,
                "seed": 12345,
                ...
            }
        }
    """
    # Extract tool name from new format
    tool_name = metadata_dict.get('tool', 'Unknown')
    format_name = metadata_dict.get('format', '')

    # Create embed with tool name
    title = f"{tool_name} Parameters"
    if format_name and format_name != tool_name:
        title = f"{tool_name} - {format_name}"

    embed = discord.Embed(
        title=title,
        color=message_author.color
    )

    field_count = 0

    # Add prompts first (most important!)
    prompt = metadata_dict.get('prompt')
    if prompt and field_count < max_fields:
        prompt_str = str(prompt)
        if len(prompt_str) > 1024:
            prompt_str = prompt_str[:1021] + "..."
        embed.add_field(
            name="Positive Prompt",
            value=prompt_str,
            inline=False
        )
        field_count += 1

    negative_prompt = metadata_dict.get('negative_prompt')
    if negative_prompt and field_count < max_fields:
        neg_str = str(negative_prompt)
        if len(neg_str) > 1024:
            neg_str = neg_str[:1021] + "..."
        embed.add_field(
            name="Negative Prompt",
            value=neg_str,
            inline=False
        )
        field_count += 1

    # Get parameters dict
    parameters = metadata_dict.get('parameters', {})

    # Handle manual user_settings field (from manual entry)
    user_settings = parameters.get('user_settings')
    if user_settings and field_count < max_fields:
        embed.add_field(
            name="Settings",
            value=user_settings,
            inline=False
        )
        field_count += 1

    # Priority parameter fields to show
    priority_params = [
        ('model', 'Model'),
        ('steps', 'Steps'),
        ('sampler_name', 'Sampler'),
        ('cfg_scale', 'CFG Scale'),
        ('seed', 'Seed'),
        ('width', 'Width'),
        ('height', 'Height'),
    ]

    # Add priority parameters
    for param_key, display_name in priority_params:
        if field_count >= max_fields:
            break

        value = parameters.get(param_key)
        if value is not None:
            # Format resolution nicely if we have both width and height
            if param_key == 'width' and 'height' in parameters:
                width = parameters.get('width')
                height = parameters.get('height')
                if width and height:
                    embed.add_field(
                        name="Resolution",
                        value=f"{width}x{height}",
                        inline=True
                    )
                    field_count += 1
                    # Skip height since we already showed both
                    continue
            elif param_key == 'height':
                # Skip if we already showed it with width
                continue

            value_str = str(value)
            if len(value_str) > 1024:
                value_str = value_str[:1021] + "..."

            embed.add_field(
                name=display_name,
                value=value_str,
                inline=len(value_str) < 32
            )
            field_count += 1

    # Add other parameters not in priority list
    for key, value in parameters.items():
        if field_count >= max_fields:
            break

        # Skip if already shown
        if key in [p[0] for p in priority_params]:
            continue

        # Skip internal/metadata fields
        if key.startswith('_') or key in ['civitai_airs', 'civitai_api_info', 'civitai_metadata']:
            continue

        value_str = str(value)
        if len(value_str) > 1024:
            value_str = value_str[:1021] + "..."

        # Format key nicely (snake_case to Title Case)
        display_key = key.replace('_', ' ').title()

        embed.add_field(
            name=display_key,
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
