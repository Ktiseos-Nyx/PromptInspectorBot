#!/usr/bin/env python3
"""Quick script to check if bot token is valid and bot is banned."""
import os

import discord
from dotenv import load_dotenv

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")

intents = discord.Intents.default()
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"✅ Bot is ALIVE: {client.user}")
    print(f"📊 Connected to {len(client.guilds)} servers:")
    for guild in client.guilds:
        print(f"  - {guild.name} (ID: {guild.id})")
    await client.close()

try:
    print("🔍 Checking bot status...")
    client.run(BOT_TOKEN)
except discord.LoginFailure:
    print("❌ INVALID TOKEN - Bot may be banned or token revoked!")
except Exception as e:
    print(f"❌ Error: {e}")
