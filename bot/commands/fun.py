"""Fun Commands - Community & social commands

Fun and social slash commands:
- /decide - Random decision maker
- /poll - Create polls
- /wildcard - Random art prompt generator
- /interact - Social interactions (hug, poke, etc.)
- /goodnight - Say goodnight with GIFs
"""
import json
import random
from pathlib import Path
from typing import TYPE_CHECKING

import aiohttp
import discord
from discord import app_commands

if TYPE_CHECKING:
    from discord.ext import commands

from ..config import logger
from ..guild_settings import get_guild_setting


# ============================================================================
# GOODNIGHT COMMAND CONSTANTS
# ============================================================================

# Goodnight messages (generic and targeted)
GOODNIGHT_MESSAGES_GENERIC = [
    "Goodnight everyone! Sweet dreams! 💤",
    "Time to sleep! Goodnight all! 🌙",
    "Off to dreamland! Goodnight! ✨",
    "Sleep tight everyone! Don't let the bed bugs bite! 🛏️",
    "Goodnight! May your dreams be filled with adventure! 🌠",
    "Heading to bed! Goodnight all! 😴",
    "Sweet dreams everyone! See you tomorrow! 🌃",
    "Goodnight world! Time to recharge! 🔋",
]

GOODNIGHT_MESSAGES_TARGETED = [
    "{user} wishes {target} a goodnight! Sweet dreams! 💤",
    "{user} says goodnight to {target}! Sleep well! 🌙",
    "{target}, {user} hopes you have the sweetest dreams! ✨",
    "Goodnight {target}! {user} hopes you sleep tight! 🛏️",
    "{user} sends {target} off to dreamland! Goodnight! 🌠",
    "{target}, {user} says it's bedtime! Goodnight! 😴",
    "Sweet dreams {target}! {user} wishes you a restful night! 🌃",
    "{user} bids {target} goodnight! May your sleep be peaceful! 🌌",
]

# Goodnight GIFs (curated collection)
GOODNIGHT_GIFS = [
    "https://media.tenor.com/5dYf85c-I_0AAAAC/goodnight-sleep-well.gif",
    "https://media.tenor.com/eKOYx8x-xdYAAAAC/good-night-sweet-dreams.gif",
    "https://media.tenor.com/m3qV4147lMcAAAAC/good-night.gif",
    "https://media.tenor.com/X3kYPj2SzMcAAAAC/goodnight-moon.gif",
    "https://media.tenor.com/VxQr5oQvJwEAAAAC/goodnight-sleep-tight.gif",
    "https://media.tenor.com/jBZe3k9eL6UAAAAC/good-night-bed-time.gif",
    "https://media.tenor.com/IzYqDM8zlFwAAAAC/goodnight.gif",
    "https://media.tenor.com/fGVGcXLxMusAAAAC/good-night-sweet-dreams.gif",
]


def register_fun_commands(bot: "commands.Bot"):
    """Register fun commands with the bot.

    Args:
        bot: The Discord bot instance
    """

# ============================================================================
# DECIDE COMMAND
# ============================================================================

    @bot.tree.command(name="decide", description="Let the bot make a choice for you")
    async def decide_command(interaction: discord.Interaction, choices: str):
        """Randomly picks one option from a comma-separated list."""
        # Check if fun_commands feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "fun_commands", default=True):
            await interaction.response.send_message("❌ Fun commands are not enabled on this server.", ephemeral=True)
            return

        # Split by comma and clean up whitespace
        options = [opt.strip() for opt in choices.split(",") if opt.strip()]

        if len(options) < 2:
            await interaction.response.send_message(
                "❌ Please provide at least 2 choices separated by commas!\n"
                "Example: `/decide choices:pizza, tacos, sushi`",
                ephemeral=True,
            )
            return

        if len(options) > 20:
            await interaction.response.send_message(
                "❌ Too many choices! Maximum is 20.",
                ephemeral=True,
            )
            return

        chosen = random.choice(options)

        embed = discord.Embed(
            title="🎲 Decision Made!",
            description=f"I choose: **{chosen}**",
            color=discord.Color.green(),
        )

        embed.add_field(
            name="Options",
            value=", ".join(f"`{opt}`" for opt in options),
            inline=False,
        )

        embed.set_footer(text=f"Requested by {interaction.user.display_name}")

        await interaction.response.send_message(embed=embed)

# ============================================================================
    # POLL COMMAND
# ============================================================================

    @bot.tree.command(name="poll", description="Create a quick poll")
    @app_commands.choices(poll_type=[
        app_commands.Choice(name="Yes/No", value="yesno"),
        app_commands.Choice(name="A or B", value="ab"),
    ])
    async def poll_command(interaction: discord.Interaction, question: str, poll_type: app_commands.Choice[str], option_a: str = None, option_b: str = None):
        """Create a quick poll with automatic reactions."""
        # Check if fun_commands feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "fun_commands", default=True):
            await interaction.response.send_message("❌ Fun commands are not enabled on this server.", ephemeral=True)
            return

        if poll_type.value == "ab":
            if not option_a or not option_b:
                await interaction.response.send_message(
                    "❌ For A/B polls, you must provide both option_a and option_b!",
                    ephemeral=True,
                )
                return

        embed = discord.Embed(
            title="📊 Poll",
            description=f"**{question}**",
            color=discord.Color.blue(),
        )

        if poll_type.value == "yesno":
            embed.add_field(name="Options", value="✅ Yes\n❌ No", inline=False)
            reactions = ["✅", "❌"]
        else:  # A/B poll
            embed.add_field(name="Option A", value=f"🇦 {option_a}", inline=True)
            embed.add_field(name="Option B", value=f"🇧 {option_b}", inline=True)
            reactions = ["🇦", "🇧"]

        embed.set_footer(text=f"Poll by {interaction.user.display_name}")

        await interaction.response.send_message(embed=embed)
        message = await interaction.original_response()

        # Add reaction buttons
        for reaction in reactions:
            await message.add_reaction(reaction)

# ============================================================================
    # WILDCARD COMMAND
# ============================================================================

    @bot.tree.command(name="wildcard", description="Generate a random art prompt")
    async def wildcard_command(interaction: discord.Interaction):
        """Generates a random art prompt using wildcards."""
        # Check if fun_commands feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "fun_commands", default=True):
            await interaction.response.send_message("❌ Fun commands are not enabled on this server.", ephemeral=True)
            return

        try:
            # Load wildcards from JSON
            wildcard_path = Path("wildcards.json")
            if not wildcard_path.exists():
                await interaction.response.send_message(
                    "❌ Wildcards file not found! Please contact the bot admin.",
                    ephemeral=True,
                )
                return

            with open(wildcard_path) as f:
                wildcards = json.load(f)

            # Generate random prompt
            subject = random.choice(wildcards["subjects"])
            style = random.choice(wildcards["styles"])
            setting = random.choice(wildcards["settings"])
            lighting = random.choice(wildcards["lighting"])
            mood = random.choice(wildcards["moods"])
            action = random.choice(wildcards["actions"])
            detail = random.choice(wildcards["details"])

            # Construct the prompt
            prompt = f"{subject} {action}, {detail}, {style} style, {setting}, {lighting}, {mood} mood"

            embed = discord.Embed(
                title="🎨 Random Art Prompt",
                description=f"```{prompt}```",
                color=discord.Color.purple(),
            )

            embed.add_field(name="Subject", value=subject, inline=True)
            embed.add_field(name="Action", value=action, inline=True)
            embed.add_field(name="Style", value=style, inline=True)
            embed.add_field(name="Setting", value=setting, inline=True)
            embed.add_field(name="Lighting", value=lighting, inline=True)
            embed.add_field(name="Mood", value=mood, inline=True)

            embed.set_footer(text=f"Generated for {interaction.user.display_name} • Roll again for a new prompt!")

            await interaction.response.send_message(embed=embed)

        except Exception as e:
            logger.error(f"Error in wildcard_command: {e}")
            await interaction.response.send_message(
                "❌ Error generating prompt. Please try again.",
                ephemeral=True,
            )

# ============================================================================
    # INTERACT COMMAND
# ============================================================================

    @bot.tree.command(name="interact", description="Interact with another user (hug, poke, etc.)")
    @app_commands.choices(action=[
        app_commands.Choice(name="🤗 Hug", value="hug"),
        app_commands.Choice(name="👉 Poke", value="poke"),
        app_commands.Choice(name="😤 Taunt", value="taunt"),
        app_commands.Choice(name="⭐ Pat", value="pat"),
        app_commands.Choice(name="🙌 High-five", value="highfive"),
    ])
    async def interact_command(interaction: discord.Interaction, action: app_commands.Choice[str], user: discord.User, system_member: str = None):
        """Interact with another user or a specific system member."""
        # Check if interact feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "interact", default=True):
            await interaction.response.send_message(
                "❌ The `/interact` command is not enabled in this server.\n"
                "_Administrators can enable it with `/settings`_",
                ephemeral=True,
            )
            return

        try:
            # Load interaction templates
            interactions_file = Path("interactions.json")
            if not interactions_file.exists():
                await interaction.response.send_message(
                    "❌ Interactions configuration not found. Please contact the bot admin.",
                    ephemeral=True,
                )
                return

            with open(interactions_file) as f:
                interactions_data = json.load(f)

            action_data = interactions_data.get(action.value, {})

            if not action_data:
                await interaction.response.send_message(
                    "❌ Invalid interaction type.",
                    ephemeral=True,
                )
                return

            # Determine the message
            if user.id == interaction.user.id:
                # Self-interaction
                message = action_data.get("self", f"{interaction.user.mention} {action.value}s themselves!")
                message = message.format(user=interaction.user.mention)
                target_name = "themselves"
                avatar_url = interaction.user.display_avatar.url

            elif system_member:
                # System member interaction
                message = action_data.get("system_member", f"{interaction.user.mention} {action.value}s {system_member} from {user.mention}'s system!")
                taunt_text = random.choice(action_data.get("messages", [""])) if action.value == "taunt" else ""
                message = message.format(
                    user=interaction.user.mention,
                    target=user.mention,
                    system_member=system_member,
                    taunt_text=taunt_text,
                )
                target_name = f"{system_member} ({user.name})"

                # Try to get system member avatar from PluralKit
                avatar_url = user.display_avatar.url  # Fallback to user avatar
                try:
                    async with aiohttp.ClientSession() as session:
                        # Search for system members
                        async with session.get(f"https://api.pluralkit.me/v2/systems/@{user.id}/members") as resp:
                            if resp.status == 200:
                                members = await resp.json()
                                # Find matching member
                                for member in members:
                                    if member.get("name", "").lower() == system_member.lower():
                                        if member.get("avatar_url"):
                                            avatar_url = member["avatar_url"]
                                        break
                except Exception as e:
                    logger.debug(f"Error fetching PluralKit avatar: {e}")

            else:
                # Regular user interaction
                message = action_data.get("target", f"{interaction.user.mention} {action.value}s {user.mention}!")
                taunt_text = random.choice(action_data.get("messages", [""])) if action.value == "taunt" else ""
                message = message.format(
                    user=interaction.user.mention,
                    target=user.mention,
                    taunt_text=taunt_text,
                )
                target_name = user.display_name
                avatar_url = user.display_avatar.url

            # Create embed
            embed = discord.Embed(
                description=message,
                color=discord.Color.pink(),
            )

            # Add GIF if available
            gifs = action_data.get("gifs", [])
            if gifs:
                embed.set_image(url=random.choice(gifs))

            # Set target's avatar as thumbnail
            embed.set_thumbnail(url=avatar_url)

            embed.set_footer(text=f"From {interaction.user.display_name}")

            await interaction.response.send_message(embed=embed)

            logger.info(f"Interaction: {interaction.user.name} {action.value}ed {target_name}")

        except Exception as e:
            logger.error(f"Error in interact_command: {e}")
            await interaction.response.send_message(
                "❌ An error occurred. Please try again.",
                ephemeral=True,
            )


# ============================================================================
    # GOODNIGHT COMMAND
# ============================================================================

    @bot.tree.command(name="goodnight", description="Say goodnight to everyone or someone special")
    async def goodnight_command(interaction: discord.Interaction, user: discord.User = None, custom_message: str = None):
        """Say goodnight with a cute GIF!

        Args:
            user: Optional user to say goodnight to
            custom_message: Optional custom goodnight message
        """
        # Check if fun_commands feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "fun_commands", default=True):
            await interaction.response.send_message("❌ Fun commands are not enabled on this server.", ephemeral=True)
            return

        try:
            # Determine the message
            if custom_message:
                # Use custom message
                if user:
                    message = f"{interaction.user.mention} says to {user.mention}: {custom_message} 💤"
                else:
                    message = f"{interaction.user.mention} says: {custom_message} 💤"
            elif user:
                # Targeted goodnight
                message = random.choice(GOODNIGHT_MESSAGES_TARGETED).format(
                    user=interaction.user.mention,
                    target=user.mention
                )
            else:
                # Generic goodnight
                message = random.choice(GOODNIGHT_MESSAGES_GENERIC)
                message = f"{interaction.user.mention} says: {message}"

            # Create embed
            embed = discord.Embed(
                description=message,
                color=discord.Color.purple(),
            )

            # Add random goodnight GIF
            embed.set_image(url=random.choice(GOODNIGHT_GIFS))

            # Add footer
            embed.set_footer(text=f"Goodnight from {interaction.user.display_name} 🌙")

            await interaction.response.send_message(embed=embed)

            target_name = user.display_name if user else "everyone"
            logger.info(f"Goodnight: {interaction.user.name} said goodnight to {target_name}")

        except Exception as e:
            logger.error(f"Error in goodnight_command: {e}")
            await interaction.response.send_message(
                "❌ An error occurred. Please try again.",
                ephemeral=True,
            )
