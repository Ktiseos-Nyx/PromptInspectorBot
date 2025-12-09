#!/usr/bin/env python3
"""PromptInspectorBot-Enhanced - Main Entry Point

A Discord bot for AI image metadata inspection with both classic emoji reactions
and modern slash commands.

Enhanced with Dataset-Tools metadata engine for comprehensive ComfyUI support!
"""
import asyncio

import discord
from discord.ext import commands

from bot.config import BOT_TOKEN, logger, intents
from bot.event_handlers import register_events
from bot.commands import register_commands


def main():
    """Main entry point for the bot."""
    if not BOT_TOKEN:
        logger.error("❌ BOT_TOKEN not found in .env file!")
        return

    logger.info("🚀 Starting PromptInspectorBot-Enhanced...")

    # Create bot instance
    bot = commands.Bot(command_prefix="!", intents=intents)

    # Register event handlers
    register_events(bot)

    # Register commands
    register_commands(bot)

    # Add retry logic with EXPONENTIAL BACKOFF to prevent Cloudflare rate limiting
    max_retries = 5
    retry_count = 0

    while retry_count < max_retries:
        try:
            bot.run(BOT_TOKEN, reconnect=True)
            break  # Exit loop if bot stops gracefully
        except discord.LoginFailure:
            logger.error("❌ INVALID TOKEN - Bot token may be banned or revoked!")
            break  # Don't retry on auth failures
        except discord.HTTPException as e:
            # Check if it's a rate limit error (429 or Cloudflare block)
            if e.status == 429 or "cloudflare" in str(e).lower():
                retry_count += 1
                wait_time = 2 ** retry_count  # Exponential backoff: 2, 4, 8, 16, 32 seconds

                if retry_count < max_retries:
                    logger.warning(
                        f"⚠️ Rate limited by Discord/Cloudflare! Retry {retry_count}/{max_retries} in {wait_time}s..."
                    )
                    asyncio.run(asyncio.sleep(wait_time))
                else:
                    logger.error(
                        f"❌ Failed after {max_retries} retries due to rate limiting. "
                        f"Please wait a few minutes before restarting."
                    )
                    break
            else:
                # Other HTTP errors - log and retry
                retry_count += 1
                if retry_count < max_retries:
                    logger.error(f"⚠️ HTTP Error: {e} - Retrying {retry_count}/{max_retries}...")
                    asyncio.run(asyncio.sleep(5))
                else:
                    logger.error(f"❌ Failed after {max_retries} retries: {e}")
                    break
        except Exception as e:
            # Unexpected errors
            logger.error(f"❌ Unexpected error: {e}")
            retry_count += 1
            if retry_count < max_retries:
                logger.info(f"Retrying in 10 seconds... ({retry_count}/{max_retries})")
                asyncio.run(asyncio.sleep(10))
            else:
                logger.error(f"❌ Failed after {max_retries} retries")
                break


if __name__ == "__main__":
    main()
