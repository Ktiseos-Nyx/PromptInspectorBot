"""AI Commands - Gemini & Claude powered commands

Slash commands powered by Gemini and Claude AI:
- /ask - Ask questions to the bot
- /techsupport - Get IT help with personality
- /coder - Get coding help and solutions
- /describe - Describe images using AI vision
"""
import io
from typing import TYPE_CHECKING

import discord
from discord import app_commands
from google.genai import types

if TYPE_CHECKING:
    from discord.ext import commands

from ..config import (
    logger,
    gemini_rate_limiter,
    gemini_client,
    claude_client,
    SCAN_LIMIT_BYTES,
    AVAILABLE_PROVIDERS,
    LLM_PROVIDER_PRIORITY,
    NSFW_PROVIDER_OVERRIDE,
)
from ..guild_settings import get_guild_setting
from ..ai_providers import (
    call_gemini_with_retry,
    ask_gemini,
    describe_image_with_claude,
)


def register_ai_commands(bot: "commands.Bot"):
    """Register AI commands with the bot.

    Args:
        bot: The Discord bot instance
    """

    # ============================================================================
    # ASK COMMAND
    # ============================================================================

    @bot.tree.command(name="ask", description="Ask a question to the bot.")
    async def ask_command(interaction: discord.Interaction, question: str):
        """Slash command to ask a question to the bot."""
        # Check if ask feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "ask", default=False):
            await interaction.response.send_message(
                "❌ The `/ask` command is not enabled in this server.\n"
                "_Administrators can enable it with `/settings`_",
                ephemeral=True,
            )
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
            file_content = io.BytesIO(response.encode("utf-8"))
            file = discord.File(file_content, filename="response.txt")
            await interaction.followup.send("Response was too long, sent as file:", file=file)
        else:
            await interaction.followup.send(response)

    # ============================================================================
    # TECH SUPPORT COMMAND  
    # ============================================================================

    @bot.tree.command(name="techsupport", description="Get IT help with personality")
    async def techsupport_command(interaction: discord.Interaction, issue: str):
        """Tech support from a seasoned IT professional with opinions."""
        # Check if techsupport feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "techsupport", default=False):
            await interaction.response.send_message("❌ The `/techsupport` command is not enabled on this server.", ephemeral=True)
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
                            temperature=0.8,  # Slightly higher for personality
                        ),
                    )
                return make_call

            response = await call_gemini_with_retry(make_call_factory)

            message_content = f"🛠️ **Tech Support Ticket:**\n\n{response.text}"

            # If response is too long for Discord, send as text file
            if len(message_content) > 2000:
                file_content = io.BytesIO(message_content.encode("utf-8"))
                file = discord.File(file_content, filename="techsupport_response.txt")
                await interaction.followup.send("Tech support response was too long, sent as file:", file=file)
            else:
                await interaction.followup.send(message_content)

            logger.info("✅ /techsupport command success for %s", interaction.user.name)

        except Exception as e:
            logger.error("Error in techsupport_command: %s", e)
            await interaction.followup.send("❌ My troubleshooting brain just crashed. That's ironic. Try again in a sec.")

    # ============================================================================
    # CODER COMMAND
    # ============================================================================

    @bot.tree.command(name="coder", description="Get coding help and solutions")
    async def coder_command(interaction: discord.Interaction, question: str):
        """Get expert programming assistance with working code solutions."""
        # Check if coder feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "coder", default=False):
            await interaction.response.send_message("❌ The `/coder` command is not enabled on this server.", ephemeral=True)
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
                            temperature=0.7,  # Balanced for code accuracy and creativity
                        ),
                    )
                return make_call

            response = await call_gemini_with_retry(make_call_factory)

            message_content = f"💻 **Coding Help:**\n\n{response.text}"

            # If response is too long for Discord, send as text file
            if len(message_content) > 2000:
                file_content = io.BytesIO(message_content.encode("utf-8"))
                file = discord.File(file_content, filename="coder_response.txt")
                await interaction.followup.send("Coding help response was too long, sent as file:", file=file)
            else:
                await interaction.followup.send(message_content)

            logger.info("✅ /coder command success for %s", interaction.user.name)

        except Exception as e:
            logger.error("Error in coder_command: %s", e)
            await interaction.followup.send("❌ Error generating code solution. Please try again.")

    # ============================================================================
    # DESCRIBE COMMAND  
    # ============================================================================

    @bot.tree.command(name="describe", description="Describe an image using AI")
    @app_commands.choices(style=[
        app_commands.Choice(name="Danbooru Tags", value="danbooru"),
        app_commands.Choice(name="Natural Language", value="natural"),
    ])
    async def describe_command(interaction: discord.Interaction, style: app_commands.Choice[str], image: discord.Attachment = None, private: bool = False):
        """Slash command to describe an image using AI vision."""
        # Check if describe feature is enabled for this guild
        if interaction.guild and not get_guild_setting(interaction.guild.id, "describe", default=True):
            await interaction.response.send_message(
                "❌ The `/describe` command is not enabled in this server.\n"
                "_Administrators can enable it with `/settings`_",
                ephemeral=True,
            )
            return

        # STRICT rate limit for Gemini API (1 per 10 seconds)
        if gemini_rate_limiter.is_rate_limited(interaction.user.id):
            await interaction.response.send_message("⏰ **Slow down!** Gemini API limit: 1 request per 10 seconds. Please wait.", ephemeral=True)
            return

        # If no image provided, check if this is a reply to a message with an image
        if not image:
            # Check if command was used as a reply
            if hasattr(interaction, "message") and interaction.message and interaction.message.reference:
                # Fetch the replied-to message
                try:
                    replied_msg = await interaction.channel.fetch_message(interaction.message.reference.message_id)
                    if replied_msg.attachments:
                        # Use the first image attachment from the replied message
                        for att in replied_msg.attachments:
                            if att.content_type and att.content_type.startswith("image/"):
                                image = att
                                break
                except:
                    pass

            if not image:
                await interaction.response.send_message(
                    "❌ No image found! Either:\n"
                    "• Upload an image with the command\n"
                    "• Reply to a message containing an image",
                    ephemeral=True,
                )
                return

        # Validate file type
        if not image.content_type or not image.content_type.startswith("image/"):
            await interaction.response.send_message("❌ Please provide a valid image file.", ephemeral=True)
            return

        # Validate file size (10MB limit)
        if image.size > SCAN_LIMIT_BYTES:
            size_mb = image.size / (1024 * 1024)
            limit_mb = SCAN_LIMIT_BYTES / (1024 * 1024)
            await interaction.response.send_message(f"❌ File too large ({size_mb:.1f}MB). Max: {limit_mb:.1f}MB.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=private)

        try:
            image_data = await image.read()

            if style.value == "danbooru":
                prompt_text = "Describe this image using Danbooru-style tags in comma-separated format, like a prompt. Output ONLY the tags separated by commas, no bullet points or explanations. Focus on descriptive tags about the character, clothing, pose, background, and art style. Exclude metadata tags like 'masterpiece' or 'high quality'. Example format: '1girl, long hair, blue eyes, school uniform, standing, outdoor, cherry blossoms, anime style'"
            else:
                prompt_text = "Describe this image in natural, descriptive language."

            # Try providers in priority order
            description_text = None
            provider_used = None
            last_error = None

            # Check for NSFW override (skip Gemini's strict filters)
            providers_to_try = LLM_PROVIDER_PRIORITY
            if NSFW_PROVIDER_OVERRIDE:
                # Override enabled - use only the specified provider (typically Claude to bypass Gemini filters)
                providers_to_try = [NSFW_PROVIDER_OVERRIDE] if NSFW_PROVIDER_OVERRIDE in AVAILABLE_PROVIDERS else LLM_PROVIDER_PRIORITY
                if NSFW_PROVIDER_OVERRIDE in AVAILABLE_PROVIDERS:
                    logger.info(f"🔞 NSFW mode enabled - using only {NSFW_PROVIDER_OVERRIDE} for /describe")

            for provider in providers_to_try:
                try:
                    if provider == "claude" and claude_client:
                        logger.info("Trying Claude for /describe")
                        description_text = await describe_image_with_claude(
                            image_data=image_data,
                            mime_type=image.content_type,
                            prompt=prompt_text,
                        )
                        provider_used = "Claude"
                        break

                    if provider == "gemini" and gemini_client:
                        logger.info("Trying Gemini for /describe")
                        # Create image part for Gemini
                        image_part = types.Part.from_bytes(
                            data=image_data,
                            mime_type=image.content_type,
                        )

                        # Use Gemini with retry logic
                        def make_call_factory(model_name):
                            async def make_call():
                                return await gemini_client.aio.models.generate_content(
                                    model=model_name,
                                    contents=[prompt_text, image_part],
                                    config=types.GenerateContentConfig(
                                        safety_settings=[
                                            types.SafetySetting(
                                                category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
                                                threshold="BLOCK_ONLY_HIGH",
                                            ),
                                            types.SafetySetting(
                                                category="HARM_CATEGORY_HATE_SPEECH",
                                                threshold="BLOCK_ONLY_HIGH",
                                            ),
                                            types.SafetySetting(
                                                category="HARM_CATEGORY_HARASSMENT",
                                                threshold="BLOCK_ONLY_HIGH",
                                            ),
                                            types.SafetySetting(
                                                category="HARM_CATEGORY_DANGEROUS_CONTENT",
                                                threshold="BLOCK_ONLY_HIGH",
                                            ),
                                        ],
                                    ),
                                )
                            return make_call

                        response = await call_gemini_with_retry(make_call_factory)
                        if response and response.text:
                            description_text = response.text
                            provider_used = "Gemini"
                            break

                except Exception as e:
                    logger.warning(f"{provider} failed: {e}")
                    last_error = e
                    continue  # Try next provider

            # Check if we got a description
            if not description_text:
                logger.error("All providers failed for /describe")
                await interaction.followup.send(
                    "❌ All AI providers failed. This might be due to:\n"
                    "• Content safety filters\n"
                    "• API quota limits\n"
                    "• Temporary service issue\n\n"
                    f"Last error: {last_error}\n\n"
                    "Try again in a moment or try a different image.",
                )
                return

            # Create an embed for the response
            embed = discord.Embed(
                title=f"🎨 Image Description ({style.name})",
                description=f"_via {provider_used}_\n\n{description_text}",
                color=discord.Color.blurple(),
            )
            embed.set_image(url=image.url)  # Use the original image URL for a clean embed
            embed.set_footer(text=f"Requested by {interaction.user.display_name}", icon_url=interaction.user.display_avatar.url)

            # The embed description has a 4096 character limit.
            if len(embed.description) > 4096:
                # Fallback for very long descriptions
                text_file_content = f"🎨 Image Description ({style.name}):\n_via {provider_used}_\n\n{description_text}"
                text_file = discord.File(io.BytesIO(text_file_content.encode("utf-8")), filename="description.txt")

                # Since we're not using an embed, attach the image file manually
                image_file = discord.File(io.BytesIO(image_data), filename=image.filename)

                await interaction.followup.send(
                    "📝 The generated description was too long, so I've sent it as a file.",
                    files=[image_file, text_file],
                )
            else:
                # Send the response with the embed
                await interaction.followup.send(embed=embed)

            logger.info("✅ /describe command success for %s", interaction.user.name)

        except Exception as e:
            logger.error("Error in describe_command: %s", e)
            await interaction.followup.send(f"❌ Error generating description: {e!s}")
