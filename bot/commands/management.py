"""Management Commands - Server administration

Admin commands for server configuration:
- /settings - Configure bot features (Admin only)
- /qotd - Post question of the day
- /qotd_add - Add question to pool
"""
from typing import TYPE_CHECKING

import discord
from discord import app_commands

if TYPE_CHECKING:
    from discord.ext import commands


def register_management_commands(bot: "commands.Bot"):
    """Register management commands with the bot.

    Args:
        bot: The Discord bot instance
    """
    # Import dependencies
    from ..config import logger
    from ..guild_settings import get_guild_setting, get_all_guild_settings, set_guild_setting
    from ..qotd import get_random_qotd, get_qotd_stats, mark_qotd_used, add_qotd_question

    @bot.tree.command(name="settings", description="Configure bot features for this server (Admin only)")
    @app_commands.default_permissions(administrator=True)
    async def settings_command(interaction: discord.Interaction):
        """Configure which bot features are enabled for this server.

        Only server administrators can use this command.
        """
        logger.info(f"🔧 /settings called by {interaction.user} in guild {interaction.guild.name if interaction.guild else 'DM'}")
        if not interaction.guild:
            await interaction.response.send_message("❌ This command can only be used in a server.", ephemeral=True)
            return

        # Get current settings
        current_settings = get_all_guild_settings(interaction.guild.id)

        # Create embed showing current settings
        embed = discord.Embed(
            title=f"⚙️ Bot Settings for {interaction.guild.name}",
            description="Configure which features are enabled in this server:",
            color=discord.Color.blue(),
        )

        # Feature descriptions
        features = {
            "security": ("🛡️ Security System", "Anti-scam detection and auto-moderation"),
            "metadata": ("🔎 Metadata Extraction", "Emoji reactions, /metadata command, context menu"),
            "describe": ("🎨 /describe", "AI image descriptions (Danbooru tags or natural language)"),
            "ask": ("💬 /ask", "Conversational AI with context memory"),
            "techsupport": ("🛠️ /techsupport", "IT support with personality"),
            "coder": ("💻 /coder", "Coding help and solutions"),
            "fun_commands": ("🎲 Fun Commands", "/decide, /poll, /wildcard"),
            "qotd": ("❓ QOTD", "Question of the Day system"),
            "interact": ("🤗 /interact", "Hug/Poke/Taunt interactions"),
        }

        # Add fields for each feature
        for feature, (name, desc) in features.items():
            enabled = current_settings.get(feature, False)
            status = "✅ Enabled" if enabled else "❌ Disabled"
            embed.add_field(
                name=f"{name}",
                value=f"{desc}\n**Status:** {status}",
                inline=False,
            )

        embed.set_footer(text="Use the buttons below to toggle features")

        # Create toggle buttons
        class SettingsView(discord.ui.View):
            def __init__(self):
                super().__init__(timeout=300)  # 5 minute timeout

        def create_updated_embed():
            """Create updated embed with current settings."""
            current = get_all_guild_settings(interaction.guild.id)
            new_embed = discord.Embed(
                title=f"⚙️ Bot Settings for {interaction.guild.name}",
                description="Configure which features are enabled in this server:",
                color=discord.Color.blue(),
            )

            for feature, (name, desc) in features.items():
                enabled = current.get(feature, False)
                status = "✅ Enabled" if enabled else "❌ Disabled"
                new_embed.add_field(
                    name=f"{name}",
                    value=f"{desc}\n**Status:** {status}",
                    inline=False,
                )

            new_embed.set_footer(text="Use the buttons below to toggle features")
            return new_embed

        def create_updated_view():
            """Create updated view with current button states."""
            current = get_all_guild_settings(interaction.guild.id)
            new_view = SettingsView()

            # Add buttons in rows (max 5 per row)
            row = 0
            col = 0

            for feature, (name, _) in features.items():
                enabled = current.get(feature, False)
                button = discord.ui.Button(
                    label=f"{'Disable' if enabled else 'Enable'} {name.split()[0]}",  # Shortened label
                    style=discord.ButtonStyle.red if enabled else discord.ButtonStyle.green,
                    custom_id=f"toggle_{feature}",
                    row=row,
                )

                def make_callback(f=feature, n=name):
                    async def callback(bi: discord.Interaction):
                        if not bi.user.guild_permissions.administrator:
                            await bi.response.send_message("❌ Only administrators can change settings.", ephemeral=True)
                            return

                        current_val = get_guild_setting(interaction.guild.id, f)
                        set_guild_setting(interaction.guild.id, f, not current_val)

                        await bi.response.send_message(
                            f"✅ {n.split()[0]} {'disabled' if current_val else 'enabled'}!",
                            ephemeral=True,
                        )

                        await interaction.edit_original_response(
                            embed=create_updated_embed(),
                            view=create_updated_view(),
                        )

                    return callback

                button.callback = make_callback()
                new_view.add_item(button)

                col += 1
                if col >= 4:  # 4 buttons per row
                    col = 0
                    row += 1

            return new_view

        view = create_updated_view()
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @bot.tree.command(name="qotd", description="Post the Question of the Day")
    async def qotd_command(interaction: discord.Interaction):
        """Post a random Question of the Day and create a discussion thread."""
        # Check if QOTD feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "qotd", default=False):
            await interaction.response.send_message(
                "❌ The QOTD system is not enabled in this server.\n"
                "_Administrators can enable it with `/settings`_",
                ephemeral=True,
            )
            return

        await interaction.response.defer()

        try:
            # Get random question
            question, idx = get_random_qotd()

            if not question:
                await interaction.followup.send(
                    "❌ No questions available in the QOTD pool!\n"
                    "Add questions with `/qotd_add`",
                    ephemeral=True,
                )
                return

            # Get stats for footer
            stats = get_qotd_stats()

            # Create embed
            embed = discord.Embed(
                title="❓ Question of the Day",
                description=f"**{question}**",
                color=discord.Color.purple(),
            )

            embed.set_footer(
                text=f"Question #{idx + 1} • {stats['remaining']} questions remaining in pool",
            )

            # Post the question
            message = await interaction.followup.send(embed=embed)

            # Create a thread for discussion
            try:
                thread = await message.create_thread(
                    name=f"QOTD: {question[:80]}{'...' if len(question) > 80 else ''}",
                    auto_archive_duration=1440,  # 24 hours
                )

                # Send a starter message in the thread
                await thread.send(
                    "💬 **Discuss your answers here!** Share your thoughts and read what others have to say.",
                )

                logger.info(f"QOTD posted in {interaction.guild.name}: {question[:50]}...")

            except Exception as e:
                logger.error(f"Error creating QOTD thread: {e}")
                # Thread creation failed, but question was posted successfully

            # Mark question as used
            mark_qotd_used(question)

        except Exception as e:
            logger.error(f"Error in qotd_command: {e}")
            await interaction.followup.send(
                "❌ An error occurred while posting QOTD. Please try again.",
                ephemeral=True,
            )

    @bot.tree.command(name="qotd_add", description="Add a question to the QOTD pool")
    async def qotd_add_command(interaction: discord.Interaction, question: str):
        """Add a new question to the Question of the Day pool.

        Args:
            question: The question to add
        """
        # Check if QOTD feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "qotd", default=False):
            await interaction.response.send_message(
                "❌ The QOTD system is not enabled in this server.\n"
                "_Administrators can enable it with `/settings`_",
                ephemeral=True,
            )
            return

        # Validate question length
        if len(question) < 10:
            await interaction.response.send_message(
                "❌ Question too short! Please provide a meaningful question (at least 10 characters).",
                ephemeral=True,
            )
            return

        if len(question) > 500:
            await interaction.response.send_message(
                "❌ Question too long! Please keep it under 500 characters.",
                ephemeral=True,
            )
            return

        # Add question to pool
        added = add_qotd_question(question)

        if not added:
            await interaction.response.send_message(
                "❌ This question already exists in the pool!",
                ephemeral=True,
            )
            return

        # Get updated stats
        stats = get_qotd_stats()

        # Success message
        embed = discord.Embed(
            title="✅ Question Added!",
            description=f"Your question has been added to the QOTD pool:\n\n**{question}**",
            color=discord.Color.green(),
        )

        embed.set_footer(
            text=f"Total questions in pool: {stats['total']} • {stats['remaining']} unused",
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)
        logger.info(f"User {interaction.user.name} added QOTD: {question[:50]}...")
