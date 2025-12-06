"""PromptInspectorBot-Enhanced - Discord bot for AI image metadata inspection

Supports BOTH interaction styles:
- 🔎 Emoji reactions (classic UX)
- ⚡ Slash commands (modern UX)

Enhanced with Dataset-Tools metadata engine for comprehensive ComfyUI support!

ARCHITECTURE NOTE: Uses subprocess to call dataset-tools-parse CLI
This keeps the bot lightweight (<100MB RAM) instead of loading PyQt6 and heavy GUI deps
"""
import asyncio
import io
import json
import logging
import os
import warnings
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp
import boto3
import botocore
import discord
import toml
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image

# Suppress aiohttp unclosed client session warnings on shutdown
warnings.filterwarnings("ignore", message="Unclosed client session", category=ResourceWarning)

from dataset_tools.metadata_parser import parse_metadata

# Local utilities
from utils.discord_formatter import create_full_metadata_text, format_metadata_embed

# Load environment variables
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Initialize Gemini client (new SDK)
gemini_client = None
if GEMINI_API_KEY:
    gemini_client = genai.Client(
        api_key=GEMINI_API_KEY,
    )

# Initialize Claude client (Anthropic SDK)
claude_client = None
if ANTHROPIC_API_KEY:
    from anthropic import AsyncAnthropic
    claude_client = AsyncAnthropic(
        api_key=ANTHROPIC_API_KEY,
    )


# Load config from toml file
config = toml.load("config.toml") if Path("config.toml").exists() else {}

# Check environment variables first, fall back to config.toml
# This allows Railway/production to override settings without changing the repo
def parse_id_list(env_var_name: str, config_key: str) -> set:
    """Parse comma-separated ID list from env var or config file."""
    env_value = os.getenv(env_var_name)
    if env_value is not None:
        # Parse env var: "123,456,789" or "[]" for empty
        env_value = env_value.strip()
        if env_value == "[]" or env_value == "":
            return set()
        return set(int(x.strip()) for x in env_value.split(",") if x.strip())
    # Fall back to config.toml
    return set(config.get(config_key, []))

def parse_channel_features(env_var_name: str, config_key: str) -> Dict[int, set]:
    """Parse channel features from env var or config file."""
    features = {}
    env_value = os.getenv(env_var_name)
    if env_value is not None:
        # Parse env var: "channel_id:feature1,feature2;channel_id:feature1..."
        for item in env_value.split(";"):
            if ":" in item:
                channel_id_str, features_str = item.split(":", 1)
                if channel_id_str.isdigit():
                    channel_id = int(channel_id_str)
                    features[channel_id] = {f.strip() for f in features_str.split(",")}
    # Fall back to config.toml
    elif config and config_key in config:
        config_features = config[config_key]
        for channel_id, feature_list in config_features.items():
            if isinstance(feature_list, list):
                features[int(channel_id)] = set(feature_list)
    return features


ALLOWED_GUILD_IDS = parse_id_list("ALLOWED_GUILD_IDS", "ALLOWED_GUILD_IDS")
MONITORED_CHANNEL_IDS = parse_id_list("MONITORED_CHANNEL_IDS", "MONITORED_CHANNEL_IDS")
CHANNEL_FEATURES = parse_channel_features("CHANNEL_FEATURES", "channel_features")
EMOJI_FOUND = config.get("EMOJI_METADATA_FOUND", "🔎")
EMOJI_NOT_FOUND = config.get("EMOJI_NO_METADATA", "⛔")
REACT_ON_NO_METADATA = config.get("REACT_ON_NO_METADATA", False)
SCAN_LIMIT_BYTES = config.get("SCAN_LIMIT_BYTES", 10 * 1024 * 1024)  # 10MB

# Gemini AI configuration
GEMINI_PRIMARY_MODEL = os.getenv("GEMINI_PRIMARY_MODEL") or config.get("GEMINI_PRIMARY_MODEL", "gemini-2.5-flash")

# Fallback models - support both env var (comma-separated) and config.toml (list)
fallback_env = os.getenv("GEMINI_FALLBACK_MODELS")
if fallback_env:
    # Parse comma-separated env var: "model1,model2,model3"
    GEMINI_FALLBACK_MODELS = [m.strip() for m in fallback_env.split(",")]
else:
    GEMINI_FALLBACK_MODELS = config.get("GEMINI_FALLBACK_MODELS", [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest",
        "gemini-2.5-pro",
    ])

GEMINI_MAX_RETRIES = int(os.getenv("GEMINI_MAX_RETRIES", config.get("GEMINI_MAX_RETRIES", 3)))
GEMINI_RETRY_DELAY = float(os.getenv("GEMINI_RETRY_DELAY", config.get("GEMINI_RETRY_DELAY", 1.0)))

# Claude AI configuration
# Default to Haiku for cost-efficiency (works great for image descriptions, 10x cheaper than Sonnet)
CLAUDE_PRIMARY_MODEL = os.getenv("CLAUDE_PRIMARY_MODEL") or config.get("CLAUDE_PRIMARY_MODEL", "claude-3-5-haiku-20241022")
CLAUDE_FALLBACK_MODELS = config.get("CLAUDE_FALLBACK_MODELS", [
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307",
])

# LLM Provider Selection
# Auto-detect available providers based on API keys
AVAILABLE_PROVIDERS = []
if gemini_client:
    AVAILABLE_PROVIDERS.append("gemini")
if claude_client:
    AVAILABLE_PROVIDERS.append("claude")

# Provider priority (which to try first)
provider_priority_env = os.getenv("LLM_PROVIDER_PRIORITY")
if provider_priority_env:
    LLM_PROVIDER_PRIORITY = [p.strip() for p in provider_priority_env.split(",")]
else:
    LLM_PROVIDER_PRIORITY = config.get("LLM_PROVIDER_PRIORITY", ["gemini", "claude"])

# Filter to only available providers
LLM_PROVIDER_PRIORITY = [p for p in LLM_PROVIDER_PRIORITY if p in AVAILABLE_PROVIDERS]

# NSFW Mode: Skip Gemini's strict filters for artistic/suggestive content
# Set to "claude" to use only Claude for /describe (bypasses Gemini's overly strict safety filters)
# Useful for artistic nudity, suggestive content, or PG-13/R-rated images that Gemini blocks
NSFW_PROVIDER_OVERRIDE = os.getenv("NSFW_PROVIDER_OVERRIDE", config.get("NSFW_PROVIDER_OVERRIDE", None))

# R2 Configuration (Optional)
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")
UPLOADER_URL = os.getenv("UPLOADER_URL")

R2_ENABLED = all([
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    UPLOADER_URL,
])
R2_UPLOAD_EXPIRATION = config.get("R2_UPLOAD_EXPIRATION", 3600) # Pre-signed URL expiry in seconds

# Setup logging (MUST be before R2 setup so logger exists!)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("PromptInspector")

r2_client = None
if R2_ENABLED:
    try:
        r2_client = boto3.client(
            "s3",
            endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=botocore.client.Config(signature_version="s3v4"),
        )
        logger.info("✅ R2 client initialized. /upload_image command will be enabled.")
    except Exception as e:
        logger.error(f"❌ Failed to initialize R2 client: {e}")
        R2_ENABLED = False
else:
    logger.info("ℹ️ R2 environment variables not set. /upload_image will be disabled.")

# Log available LLM providers
if AVAILABLE_PROVIDERS:
    logger.info("🤖 Available LLM providers: %s", ", ".join(AVAILABLE_PROVIDERS))
    logger.info("📋 Provider priority: %s", " → ".join(LLM_PROVIDER_PRIORITY))
else:
    logger.warning("⚠️ No LLM providers available! Set GEMINI_API_KEY or ANTHROPIC_API_KEY.")

# Initialize bot with all intents needed
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.guilds = True  # Needed for thread events

bot = commands.Bot(command_prefix="!", intents=intents)

# Separate rate limiters for different features
rate_limiter = RateLimiter(max_requests=5, window_seconds=30)        # Metadata (local parsing - keep lenient)
gemini_rate_limiter = RateLimiter(max_requests=1, window_seconds=10)  # Gemini API - STRICT (1 per 10s to prevent quota abuse)

# Track recently processed attachments to avoid double-processing PluralKit proxies
# Use attachment URL instead of message ID since PluralKit creates new messages
processed_attachment_urls = set()
MAX_TRACKED_ATTACHMENTS = 1000

# Cache metadata for multi-image messages (message_id -> list of {attachment, metadata})
message_metadata_cache = {}
MAX_CACHED_MESSAGES = 100

# Semaphore to limit concurrent image processing (prevents CPU spikes)
# Process max 1 image at a time to keep CPU usage low and prevent RAM overflow
metadata_processing_semaphore = asyncio.Semaphore(1)


# ============================================================================
# GUILD SETTINGS SYSTEM - Per-Server Configuration
# ============================================================================

GUILD_SETTINGS_FILE = Path("guild_settings.json")

def load_guild_settings() -> dict:
    """Load guild settings from JSON file."""
    if not GUILD_SETTINGS_FILE.exists():
        return {"_defaults": {
            "ask": False,
            "metadata": True,
            "describe": True,
            "techsupport": False,
            "coder": False,
            "fun_commands": True,
            "qotd": False,
            "interact": True,
        }}

    try:
        with open(GUILD_SETTINGS_FILE) as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading guild settings: {e}")
        return {"_defaults": {}}

def save_guild_settings(settings: dict):
    """Save guild settings to JSON file."""
    try:
        with open(GUILD_SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving guild settings: {e}")

def get_guild_setting(guild_id: int, setting: str, default: bool = None) -> bool:
    """Get a specific setting for a guild, falling back to defaults.

    Args:
        guild_id: Discord guild ID
        setting: Setting name (e.g. 'ask', 'metadata', 'describe')
        default: Default value if not found (overrides _defaults)

    Returns:
        Boolean setting value

    """
    settings = load_guild_settings()
    guild_id_str = str(guild_id)

    # Check guild-specific setting
    if guild_id_str in settings and setting in settings[guild_id_str]:
        return settings[guild_id_str][setting]

    # Fall back to defaults
    if "_defaults" in settings and setting in settings["_defaults"]:
        return settings["_defaults"][setting]

    # Final fallback
    return default if default is not None else False

def set_guild_setting(guild_id: int, setting: str, value: bool):
    """Set a specific setting for a guild.

    Args:
        guild_id: Discord guild ID
        setting: Setting name
        value: Boolean value to set

    """
    settings = load_guild_settings()
    guild_id_str = str(guild_id)

    # Initialize guild settings if not exists
    if guild_id_str not in settings:
        settings[guild_id_str] = {}

    settings[guild_id_str][setting] = value
    save_guild_settings(settings)
    logger.info(f"Guild {guild_id}: Set {setting} = {value}")

def get_all_guild_settings(guild_id: int) -> dict:
    """Get all settings for a guild, with defaults filled in.

    Returns:
        Dictionary of all settings for the guild

    """
    settings = load_guild_settings()
    guild_id_str = str(guild_id)
    defaults = settings.get("_defaults", {})
    guild_specific = settings.get(guild_id_str, {})

    # Merge defaults with guild-specific (guild-specific overrides)
    return {**defaults, **guild_specific}


# ============================================================================
# QOTD SYSTEM - Question of the Day Management
# ============================================================================

QOTD_FILE = Path("qotd.json")

def load_qotd_data() -> dict:
    """Load QOTD data from JSON file."""
    if not QOTD_FILE.exists():
        return {
            "questions": [],
            "used_questions": [],
            "last_posted": None,
        }

    try:
        with open(QOTD_FILE) as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading QOTD data: {e}")
        return {"questions": [], "used_questions": [], "last_posted": None}

def save_qotd_data(data: dict):
    """Save QOTD data to JSON file."""
    try:
        with open(QOTD_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving QOTD data: {e}")

def get_random_qotd() -> tuple[str, int]:
    """Get a random unused question from the pool.

    Returns:
        Tuple of (question_text, question_index) or (None, -1) if no questions available

    """
    data = load_qotd_data()

    # Get unused questions
    all_questions = data.get("questions", [])
    used_questions = data.get("used_questions", [])

    # Find unused questions
    unused = [q for q in all_questions if q not in used_questions]

    # If all questions used, reset the pool
    if not unused and all_questions:
        logger.info("All QOTD questions used - resetting pool")
        data["used_questions"] = []
        save_qotd_data(data)
        unused = all_questions

    if not unused:
        return None, -1

    # Pick random question
    import random
    question = random.choice(unused)
    question_index = all_questions.index(question)

    return question, question_index

def mark_qotd_used(question: str):
    """Mark a question as used and update last_posted timestamp."""
    import time
    data = load_qotd_data()

    if question not in data.get("used_questions", []):
        data.setdefault("used_questions", []).append(question)

    data["last_posted"] = time.time()
    save_qotd_data(data)

def add_qotd_question(question: str) -> bool:
    """Add a new question to the pool.

    Returns:
        True if added successfully, False if duplicate

    """
    data = load_qotd_data()

    # Check for duplicates
    if question in data.get("questions", []):
        return False

    data.setdefault("questions", []).append(question)
    save_qotd_data(data)
    logger.info(f"Added new QOTD question: {question[:50]}...")
    return True

def get_qotd_stats() -> dict:
    """Get statistics about the QOTD pool.

    Returns:
        Dictionary with total, used, and remaining counts

    """
    data = load_qotd_data()
    total = len(data.get("questions", []))
    used = len(data.get("used_questions", []))
    remaining = total - used

    return {
        "total": total,
        "used": used,
        "remaining": remaining,
        "last_posted": data.get("last_posted"),
    }


# ============================================================================
# SECURITY SYSTEM - Anti-Scam Detection
# ============================================================================
# This system detects and prevents two main scammer types:
# 1. Wallet Scammers: Crypto wallet spam with currency symbols in name, ALL CAPS
# 2. Screenshot Spammers: 4+ crypto screenshots, cross-posting, gibberish text

# Security configuration
CATCHER_ROLE_ID = int(os.getenv("CATCHER_ROLE_ID", config.get("CATCHER_ROLE_ID", 0)))
TRUSTED_USER_IDS = parse_id_list("TRUSTED_USER_IDS", "TRUSTED_USER_IDS")
# DM whitelist - users allowed to interact with bot via DMs
# Can be comma-separated in env: DM_ALLOWED_USER_IDS=123,456,789
DM_ALLOWED_USER_IDS = parse_id_list("DM_ALLOWED_USER_IDS", "DM_ALLOWED_USER_IDS")
# Admin channel IDs for security alerts (supports multiple channels/servers)
# Can be comma-separated in env: ADMIN_CHANNEL_IDS=123,456,789
ADMIN_CHANNEL_IDS = parse_id_list("ADMIN_CHANNEL_IDS", "ADMIN_CHANNEL_IDS")
# Backward compatibility: also check old ADMIN_CHANNEL_ID config
if not ADMIN_CHANNEL_IDS and "ADMIN_CHANNEL_ID" in config:
    admin_channel = config.get("ADMIN_CHANNEL_ID", 0)
    if admin_channel:
        ADMIN_CHANNEL_IDS = {admin_channel}
# Also check env for single ID
if not ADMIN_CHANNEL_IDS:
    env_admin = os.getenv("ADMIN_CHANNEL_ID")
    if env_admin and env_admin.isdigit():
        ADMIN_CHANNEL_IDS = {int(env_admin)}

# DM Auto-Response Message
DM_RESPONSE_MESSAGE = """👋 **Hi there!** This bot is currently configured for private server use.

🔧 **Developed by:** Ktiseos Nyx

🔗 **All my links:** https://beacons.ai/duskfallcrew

💰 **Support the project & get Early Supporter access:**
Donate $5/month to get DM access + higher upload limits!
• Ko-fi (Angel): https://ko-fi.com/OTNAngel/
• Ko-fi (Duskfall): https://ko-fi.com/duskfallcrew/
• Shop: https://duskfallcrew-shop.fourthwall.com/

✨ **Note:** We're actively developing new features for Early Supporters! Join our Discord to stay updated on upcoming features and get your supporter access configured.

🤖 **Want to run your own instance?**
Self-host this bot using our open-source code:
https://github.com/Ktiseos-Nyx/PromptInspectorBot

❓ **Need help or have questions?**
Join our Discord community: https://discord.gg/HhBSvM9gBY

💖 Thanks for your interest in the PromptInspector Bot!"""

# Message tracking for cross-posting detection
# Structure: {user_id: [{'fingerprint': hash, 'channel_id': int, 'timestamp': float, 'message_id': int}, ...]}
user_recent_messages: Dict[int, list] = {}
MAX_TRACKED_MESSAGES_PER_USER = 50
CROSS_POST_WINDOW_SECONDS = 300  # 5 minutes

# Crypto scam keyword patterns (case-insensitive, with point values)
import re

CRYPTO_SCAM_PATTERNS = {
    r"\bWALL?LET\b": 50,
    r"\b\d+\s*SOL\b": 50,
    r"\bDEAD\s+TOKENS?\b": 50,
    r"\bPAY\s+HIM\b": 50,
    r"\bPLENTY\s+TRANSACTIONS?\b": 40,
    r"\bEMPTY\s+WALLET\b": 40,
    r"\bCRYPTO\b": 20,
    r"\bDM\s+ME\b": 30,
    r"\bBUY\b.*\bWALLET\b": 40,
}


def get_message_fingerprint(message: discord.Message) -> str:
    """Create a hash of message content + attachments for duplicate detection."""
    import hashlib
    fingerprint = message.content.strip()
    for att in message.attachments:
        fingerprint += f"|{att.filename}|{att.size}"
    return hashlib.md5(fingerprint.encode()).hexdigest()


async def track_message(message: discord.Message):
    """Track message for cross-posting detection."""
    user_id = message.author.id
    fingerprint = get_message_fingerprint(message)
    timestamp = message.created_at.timestamp()

    if user_id not in user_recent_messages:
        user_recent_messages[user_id] = []

    user_recent_messages[user_id].append({
        "fingerprint": fingerprint,
        "channel_id": message.channel.id,
        "timestamp": timestamp,
        "message_id": message.id,
    })

    # Clean old messages (older than window)
    current_time = timestamp
    user_recent_messages[user_id] = [
        m for m in user_recent_messages[user_id]
        if current_time - m["timestamp"] < CROSS_POST_WINDOW_SECONDS
    ]

    # Limit tracking per user
    if len(user_recent_messages[user_id]) > MAX_TRACKED_MESSAGES_PER_USER:
        user_recent_messages[user_id] = user_recent_messages[user_id][-MAX_TRACKED_MESSAGES_PER_USER:]


async def check_cross_posting(message: discord.Message) -> int:
    """Check if user posted same content in multiple channels recently.

    Returns:
        Number of different channels where same message was posted

    """
    user_id = message.author.id
    if user_id not in user_recent_messages:
        return 0

    fingerprint = get_message_fingerprint(message)
    recent = user_recent_messages[user_id]

    # Find all messages with same fingerprint
    same_message_posts = [m for m in recent if m["fingerprint"] == fingerprint]

    # Count unique channels
    unique_channels = set(m["channel_id"] for m in same_message_posts)
    return len(unique_channels)


def is_gibberish_or_spam(text: str, user_has_roles: bool = True, has_images: bool = False) -> bool:
    """Detect gibberish, spam, or suspicious text patterns.

    Args:
        text: Message content
        user_has_roles: Does user have roles beyond @everyone?
        has_images: Does message have image attachments?

    Returns:
        True if text appears to be gibberish/spam

    """
    text = text.strip()

    # Empty messages are only suspicious if there are no images
    if len(text) == 0:
        return not has_images

    # === ALLOW EMOTIONAL EXPRESSIONS FOR USERS WITH ROLES ===
    if user_has_roles:
        # "AAAA", "lmao", "omg", etc. are fine if user has roles
        # Pure repeated letter spam (like "AAAAAAaaaaaaaaAAAAA")
        unique_chars = set(text.replace(" ", "").lower())
        if len(unique_chars) <= 2:  # Only 1-2 unique letters
            return False  # Allow emotional spam for users with roles

    # === STRICT CHECKS FOR NO-ROLE USERS ===

    # Random letter string (like "tdnfaagoie")
    if text.isalpha() and " " not in text:
        if 5 <= len(text) <= 20:
            # Common okay words
            common_ok = [
                "hello", "hi", "thanks", "thank", "please", "welcome",
                "yes", "no", "okay", "ok", "sure", "nice", "good",
                "great", "awesome", "cool", "wow", "lol", "lmao",
                "rofl", "omg", "wtf", "brb", "afk", "gg", "gn",
            ]

            if text.lower() in common_ok:
                return False

            # If user has roles, be lenient
            if user_has_roles:
                return False

            # No roles + random string = gibberish
            return True

    return False


def calculate_wallet_scam_score(message: discord.Message) -> tuple[int, list[str]]:
    """Calculate scam likelihood score for wallet/crypto scammers.

    Returns:
        (score, reasons) where higher score = more likely scam
        100+ = instant ban
        75-99 = delete + alert admins
        50-74 = watchlist

    """
    score = 0
    reasons = []

    # Username checks
    name = message.author.display_name

    # Currency symbols in username (hoisting technique)
    if any(c in name for c in ["£", "€", "¥", "₿", "$", "₹", "₽"]):
        score += 20
        reasons.append("Currency symbols in username")

    # Hoisting characters (to appear at top of member list)
    if name and name[0] in ["!", "=", "#", "@", ".", "_", "-", "~"]:
        score += 20
        reasons.append("Hoisting character in username")

    # Check for auto-generated username patterns (e.g., word.word####_#####)
    if re.search(r"[a-z]+\.[a-z]+\d{2,4}_\d{4,}", name.lower()):
        score += 15
        reasons.append("Suspicious username pattern")

    # Caps spam in message
    if len(message.content) > 20:
        caps_count = sum(1 for c in message.content if c.isupper())
        caps_ratio = caps_count / len(message.content)
        if caps_ratio > 0.7:
            score += 30
            reasons.append(f"Caps spam ({caps_ratio*100:.0f}%)")

    # Check for crypto scam keywords
    content = message.content.upper()
    for pattern, points in CRYPTO_SCAM_PATTERNS.items():
        if re.search(pattern, content):
            score += points
            reasons.append(f"Keyword: {pattern}")

    # === ROLE CHECKS (FIXED) ===
    # Check if author is a real Member (with roles) before checking roles!
    if isinstance(message.author, discord.Member):

        # Only has CATCHER role (scammers exploit this to look legit)
        if CATCHER_ROLE_ID and len(message.author.roles) == 2:  # @everyone + CATCHER
            catcher_role = discord.utils.get(message.author.roles, id=CATCHER_ROLE_ID)
            if catcher_role:
                score += 30
                reasons.append("Only has CATCHER role")

        # No roles at all (even worse than just CATCHER)
        elif len(message.author.roles) == 1:  # Only @everyone
            score += 20
            reasons.append("No roles (only @everyone)")

    # If it is NOT a Member (e.g. Webhook/PluralKit/DM), we skip role checks entirely.

    # No profile picture (red flag, but not damning on its own)
    # Scammers often have Member + CATCHER + no profile pic, then post spam
    if message.author.avatar is None:
        score += 15
        reasons.append("No profile picture")

    # Note: We don't check account age - real scammers can be years old!

    return (score, reasons)


def verify_image_safety(file_data: bytes, filename: str) -> tuple[bool, str]:
    """Check if file is actually an image, not malware.

    Returns:
        (is_safe, reason) where is_safe=False triggers instant ban

    """
    if len(file_data) < 4:
        return (False, "File too small")

    magic = file_data[:4]

    # Executables (INSTANT BAN)
    if magic[:2] == b"MZ":  # Windows .exe
        return (False, "Windows executable (.exe) disguised as image")

    if magic == b"\x7fELF":  # Linux binary
        return (False, "Linux binary (ELF) disguised as image")

    # Valid images
    if magic[:2] == b"\xff\xd8":  # JPEG
        return (True, "JPEG")
    if magic == b"\x89PNG":  # PNG
        return (True, "PNG")
    if magic[:4] == b"RIFF":  # WebP
        return (True, "WebP")
    if magic[:2] == b"BM":  # BMP
        return (True, "BMP")
    if magic[:3] == b"GIF":  # GIF
        return (True, "GIF")

    # Unknown format
    return (False, f"Unknown file format (magic: {magic.hex()})")


async def instant_ban(message: discord.Message, reason: str, details: list = None):
    """Ban user and delete all their recent messages."""
    logger.critical(f"🚨 INSTANT BAN: {message.author} ({message.author.id}) - {reason}")

    try:
        # Delete the message first
        await message.delete()

        # Delete all recent messages from this user (last 5 minutes)
        await delete_all_user_messages(message.author, message.channel.guild, minutes=5)

        # Ban the user
        ban_reason = f"Auto-ban: {reason}"
        if details:
            ban_reason += f" | {', '.join(details[:3])}"  # First 3 details

        await message.guild.ban(message.author, reason=ban_reason, delete_message_seconds=300)

        # Alert admins
        await alert_admins(message.guild, message.author, reason, details, action="BANNED")

    except discord.Forbidden:
        logger.error(f"❌ Missing permissions to ban {message.author}")
        await alert_admins(message.guild, message.author, reason, details, action="FAILED - Missing permissions")
    except Exception as e:
        logger.error(f"Error banning user: {e}")


async def delete_all_user_messages(user: discord.User, guild: discord.Guild, minutes: int = 5):
    """Delete all messages from a user in the guild from the last N minutes."""
    import datetime
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)

    for channel in guild.text_channels:
        try:
            async for msg in channel.history(limit=100, after=cutoff):
                if msg.author.id == user.id:
                    await msg.delete()
                    logger.info(f"🗑️ Deleted message from {user} in {channel.name}")
        except discord.Forbidden:
            continue  # Skip channels bot can't access
        except Exception as e:
            logger.warning(f"Error deleting messages in {channel.name}: {e}")


async def alert_admins(guild: discord.Guild, user: discord.User, reason: str, details: list = None, action: str = "ALERT"):
    """Send alert to admin channels about security event (supports multiple channels)."""
    if not ADMIN_CHANNEL_IDS:
        return  # No admin channels configured

    # Choose color based on severity
    color_map = {
        "BANNED": discord.Color.red(),           # Red = instant ban
        "COMPROMISED": discord.Color.gold(),     # Gold = possible hacked account
        "DELETED": discord.Color.orange(),       # Orange = suspicious but not banned
        "ALERT": discord.Color.yellow(),          # Yellow = low priority alert
    }
    embed_color = color_map.get(action, discord.Color.orange())

    embed = discord.Embed(
        title=f"🚨 Security {action}",
        description=f"**User:** {user.mention} (`{user.id}`)\n**Server:** {guild.name}\n**Reason:** {reason}",
        color=embed_color,
    )

    if details:
        embed.add_field(name="Details", value="\n".join(f"• {d}" for d in details[:10]))

    # Add special note for compromised accounts
    if action == "COMPROMISED":
        embed.add_field(
            name="⚠️ Action Required",
            value="This is a veteran account posting scam content. The account may be hacked. Consider:\n"
                  "• DM the user to verify their account security\n"
                  "• Temporarily mute them until they respond\n"
                  "• Do NOT ban unless confirmed malicious",
            inline=False,
        )

    embed.set_footer(text=f"User: {user}")
    if user.avatar:
        embed.set_thumbnail(url=user.avatar.url)

    # Send to all configured admin channels
    for channel_id in ADMIN_CHANNEL_IDS:
        try:
            # Try to get channel from the current guild first
            channel = guild.get_channel(channel_id)
            # If not in current guild, try to get from bot's accessible channels
            if not channel:
                channel = bot.get_channel(channel_id)

            if channel:
                await channel.send(embed=embed)
            else:
                logger.warning(f"Admin channel {channel_id} not found or not accessible")
        except Exception as e:
            logger.error(f"Failed to send admin alert to channel {channel_id}: {e}")


def reformat_json(string: str, indent: int = 2) -> Optional[str]:
    """Reformat JSON string with proper indentation.

    Args:
        string: JSON string to reformat
        indent: Indentation level

    Returns:
        Reformatted JSON or None if invalid

    """
    try:
        data = json.loads(string)
        return json.dumps(data, indent=indent)
    except json.JSONDecodeError:
        return None


def is_valid_image(image_data: bytes) -> bool:
    """Verify this is actually a valid image file."""
    if not image_data or len(image_data) < 100:
        return False

    try:
        with Image.open(io.BytesIO(image_data)) as img:
            width, height = img.size
            return width > 0 and height > 0
    except Exception:
        return False


def transform_ui_dict_to_simple_format(ui_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Transform UI dict format from parse_metadata to simple Discord format.

    Converts from:
        {'prompt_data_section': {...}, 'generation_parameters_section': {...}, ...}
    To:
        {'tool': '...', 'prompt': '...', 'parameters': {...}}
    """
    simple = {}

    # Extract tool name
    metadata_section = ui_dict.get("metadata_info_section", {})
    simple["tool"] = metadata_section.get("Detected Tool", "Unknown")
    simple["format"] = metadata_section.get("format", "")

    # Extract prompts
    prompt_section = ui_dict.get("prompt_data_section", {})
    simple["prompt"] = prompt_section.get("Positive", "")
    simple["negative_prompt"] = prompt_section.get("Negative", "")

    # Extract parameters
    simple["parameters"] = ui_dict.get("generation_parameters_section", {})

    # Include raw metadata for JSON button
    simple["raw_metadata"] = ui_dict.get("raw_tool_specific_data_section", {})

    return simple


async def get_real_author(message: discord.Message) -> discord.User:
    """Get the real author of a message, accounting for PluralKit proxies.

    If the message is from a PluralKit webhook, queries the PluralKit API
    to find the actual user who sent it.

    Args:
        message: Discord message

    Returns:
        Real author (either original author or PluralKit sender)

    """
    # If not a webhook, just return the author
    if not message.webhook_id:
        return message.author

    # Try to query PluralKit API
    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://api.pluralkit.me/v2/messages/{message.id}"
            async with session.get(url, timeout=5) as response:
                if response.status == 200:
                    data = await response.json()
                    # Get the real sender's Discord ID
                    sender_id = data.get("sender")
                    if sender_id:
                        # Fetch the actual Discord user
                        real_user = await bot.fetch_user(int(sender_id))
                        if real_user:
                            logger.info("🔄 PluralKit: Resolved webhook to real user %s", real_user.name)
                            return real_user
                elif response.status == 404:
                    # Not a PluralKit message, just a regular webhook
                    logger.debug("Webhook message but not from PluralKit")
    except asyncio.TimeoutError:
        logger.warning("PluralKit API timeout")
    except Exception as e:
        logger.debug("PluralKit API query failed: %s", e)

    # Fallback: return original author (webhook user)
    return message.author


def format_public_metadata_message(metadata: Dict[str, Any], author: discord.User) -> str:
    """Format metadata as collapsible spoiler message for public channels.

    Args:
        metadata: Metadata dict from parser
        author: Original message author

    Returns:
        Formatted message string with spoilers

    """
    lines = [f"🔎 **Metadata Found!** (Posted by {author.mention})"]

    # Tool info
    tool = metadata.get("tool", "Unknown")
    format_name = metadata.get("format", "")
    if format_name and format_name != tool:
        lines.append(f"*{tool} - {format_name}*\n")
    else:
        lines.append(f"*{tool}*\n")

    # Prompts section (collapsible)
    prompt = metadata.get("prompt")
    negative_prompt = metadata.get("negative_prompt")

    if prompt or negative_prompt:
        prompt_lines = ["**📝 Prompts:**"]
        if prompt:
            # Truncate if too long (Discord has 2000 char limit)
            prompt_text = str(prompt)
            if len(prompt_text) > 500:
                prompt_text = prompt_text[:500] + "... (truncated, click DM button for full)"
            prompt_lines.append(f"||**Positive:** {prompt_text}||")

        if negative_prompt:
            neg_text = str(negative_prompt)
            if len(neg_text) > 300:
                neg_text = neg_text[:300] + "... (truncated)"
            prompt_lines.append(f"||**Negative:** {neg_text}||")

        lines.append("\n".join(prompt_lines))

    # Settings section (collapsible)
    parameters = metadata.get("parameters", {})
    if parameters:
        settings_lines = ["\n**⚙️ Settings:**"]
        settings_text = []

        # Check for manual user_settings field (from manual entry)
        user_settings = parameters.get("user_settings")
        if user_settings:
            # User-provided freeform settings
            settings_lines.append(f"||{user_settings}||")
        else:
            # Priority settings (auto-extracted metadata)
            priority_keys = ["model", "steps", "sampler_name", "cfg_scale", "seed", "width", "height"]
            for key in priority_keys:
                value = parameters.get(key)
                if value is not None:
                    if key == "width" and "height" in parameters:
                        settings_text.append(f"Resolution: {parameters['width']}x{parameters['height']}")
                        break  # Skip height, we showed both
                    if key == "height":
                        continue  # Already showed with width
                    display_key = key.replace("_", " ").title()
                    settings_text.append(f"{display_key}: {value}")

            if settings_text:
                settings_lines.append(f"||{' • '.join(settings_text)}||")

        if len(settings_lines) > 1:  # Has content beyond header
            lines.append("\n".join(settings_lines))

    lines.append("\n*Click buttons below for more details!*")

    return "\n".join(lines)


async def parse_image_metadata(image_data: bytes, filename: str = None) -> Optional[Dict[str, Any]]:
    """Parse metadata from image using Dataset-Tools library.

    Uses direct import of dataset_tools.metadata_parser module.
    Runs in a thread pool to avoid blocking the async event loop.

    Args:
        image_data: Raw image bytes
        filename: Original filename (to preserve extension)

    Returns:
        Metadata dict or None if no metadata found

    """
    if not is_valid_image(image_data):
        return None

    # Save to temp file for Dataset-Tools parser
    # Preserve the file extension for proper format detection
    if filename and "." in filename:
        ext = Path(filename).suffix  # .png, .jpg, etc.
    else:
        ext = ".png"  # Default to PNG
    temp_path = Path(f"/tmp/discord_image_{id(image_data)}{ext}")
    try:
        with open(temp_path, "wb") as f:
            f.write(image_data)

        # Call parse_metadata in a thread to avoid blocking
        ui_dict = await asyncio.to_thread(
            parse_metadata,
            str(temp_path),
        )

        if not ui_dict or not isinstance(ui_dict, dict):
            logger.warning("Parser returned empty or invalid result for %s", temp_path.name)
            return None

        # Transform UI dict to simple format for Discord
        metadata_dict = transform_ui_dict_to_simple_format(ui_dict)

        logger.debug("Successfully parsed metadata for %s - found %s", temp_path.name, metadata_dict.get("tool", "Unknown"))
        return metadata_dict

    except Exception as e:
        logger.error("Error parsing metadata: %s", e)
        return None
    finally:
        # Cleanup temp file
        if temp_path.exists():
            temp_path.unlink()


# =============================================================================
# EMOJI REACTION MODE (Classic UX)
# =============================================================================

@bot.event
async def on_message(message: discord.Message):
    """Auto-detect metadata in monitored channels and post public reply."""
    global processed_attachment_urls

    # 1. IGNORE BOTS (Unless it's a webhook which might be PluralKit)
    if message.author.bot and not message.webhook_id:
        return

    # 2. DM Handling
    if not message.guild:
        if message.author.id not in DM_ALLOWED_USER_IDS:
            try:
                await message.channel.send(DM_RESPONSE_MESSAGE)
            except discord.Forbidden:
                pass
            return
        # Allow whitelisted DMs to proceed

    # 3. CHANNEL/FEATURE CHECKS (Move this UP!)
    # Determine which feature flags to check.
    # If it's a DM, we generally allow basic features if whitelisted.
    if message.guild:
        # Check if this channel or category is monitored
        # For threads/forums, check parent
        channel_id = message.channel.parent_id if hasattr(message.channel, "parent_id") and message.channel.parent_id else message.channel.id

        # If MONITORED_CHANNEL_IDS is set, and this channel isn't in it, STOP HERE.
        if MONITORED_CHANNEL_IDS and channel_id not in MONITORED_CHANNEL_IDS:
            return

        # Check if metadata/security is enabled for this server
        # You can add a specific "security" flag in settings later if you want
        if not get_guild_setting(message.guild.id, "metadata", default=True):
            return

    # ============================================================================
    # SECURITY CHECKS - Run BEFORE processing to catch scammers early
    # ============================================================================

    # BYPASS CONDITIONS - Skip security checks for trusted users ONLY
    # 1. Server owner (you literally own the server)
    # 2. Manually trusted users (TRUSTED_USER_IDS in config)
    # NOTE: We don't bypass based on account age anymore - real scammers can be years old!
    is_server_owner = message.author.id == message.guild.owner_id
    is_trusted_user = message.author.id in TRUSTED_USER_IDS

    # Full bypass for server owner and manually trusted users
    if is_server_owner or is_trusted_user:
        if is_server_owner:
            logger.debug(f"✅ Security bypass: {message.author} is server owner")
        # Continue processing normally
    else:
        # Track message for cross-posting detection
        await track_message(message)

        # Get user context for security checks
        # Only Members (in guilds) have roles, Users (in DMs) don't
        user_has_roles = isinstance(message.author, discord.Member) and len(message.author.roles) > 1

        # --- UNIFIED IMAGE GATHERING (Attachments & Embeds) ---
        images_to_check = []

        # 1. Gather from attachments
        for attachment in message.attachments:
            if attachment.content_type and attachment.content_type.startswith("image/"):
                images_to_check.append({
                    "source": "attachment",
                    "object": attachment,
                    "filename": attachment.filename,
                })

        # 2. Gather from embeds
        for embed in message.embeds:
            if embed.image and embed.image.url:
                # To get a filename, we'll parse it from the URL
                filename = Path(embed.image.url).name.split("?")[0]
                images_to_check.append({
                    "source": "embed",
                    "object": embed.image,
                    "filename": filename,
                })

        image_count = len(images_to_check)
        has_images = image_count > 0

        # === CHECK 1: MAGIC BYTES - Detect malware disguised as images ===
        if has_images:
            # Use a single session for all downloads
            async with aiohttp.ClientSession() as session:
                for image_info in images_to_check:
                    try:
                        file_data = None
                        if image_info["source"] == "attachment":
                            # Read from attachment
                            file_data = await image_info["object"].read()
                        elif image_info["source"] == "embed":
                            # Download from embed URL
                            async with session.get(image_info["object"].url) as response:
                                if response.status == 200:
                                    file_data = await response.read()
                                else:
                                    logger.warning(f"Failed to download embed image: {image_info['object'].url} (Status: {response.status})")
                                    continue

                        if file_data:
                            is_safe, reason = verify_image_safety(file_data, image_info["filename"])
                            if not is_safe:
                                # INSTANT BAN - Malware detected
                                await instant_ban(message, f"{reason} from {image_info['source']}")
                                return

                    except Exception as e:
                        logger.warning(f"Error checking file safety for {image_info['filename']}: {e}")

        # === CHECK 2: SCREENSHOT SPAMMER (4+ images + cross-posting) ===
        if image_count >= 4:
            cross_post_count = await check_cross_posting(message)

            # 4+ images posted to 2+ channels = INSTANT BAN
            if cross_post_count >= 2:
                await instant_ban(
                    message,
                    f"Screenshot spam ({image_count} images, {cross_post_count} channels)",
                    [f"{image_count} images", f"{cross_post_count} channels", "Cross-posting"],
                )
                return

            # 4+ images + no roles + gibberish = ALSO INSTANT BAN
            if not user_has_roles:
                # The `has_images` flag is passed here to prevent false positives on image-only posts
                if is_gibberish_or_spam(message.content, user_has_roles=False, has_images=has_images):
                    await instant_ban(
                        message,
                        f"Screenshot spam ({image_count} images + gibberish)",
                        [f"{image_count} images", "No roles", "Gibberish text"],
                    )
                    return

        # === CHECK 3: WALLET SCAMMER (crypto keywords, caps spam, etc.) ===
        scam_score, reasons = calculate_wallet_scam_score(message)

        if scam_score >= 100:
            # High confidence scam - INSTANT BAN (regardless of account age)
            await instant_ban(message, f"Wallet scam (Score: {scam_score})", reasons)
            return

        if scam_score >= 75:
            # Medium confidence - Delete message and alert admins
            logger.warning(f"⚠️ Suspicious message from {message.author} (Score: {scam_score})")
            try:
                await message.delete()
                await alert_admins(message.guild, message.author, f"Suspicious (Score: {scam_score})", reasons, action="DELETED")
            except discord.Forbidden:
                logger.warning("Missing permissions to delete suspicious message")
            return

        if scam_score >= 50:
            # Low confidence - Just log for monitoring
            logger.info(f"📊 Watchlist: {message.author} (Score: {scam_score}) - {', '.join(reasons[:3])}")

    # ============================================================================
    # END SECURITY CHECKS
    # ============================================================================

    # Only process in monitored channels (empty set = monitor all channels)
    # For threads/forums, check the parent channel ID
    channel_to_check = message.channel.parent_id if hasattr(message.channel, "parent_id") and message.channel.parent_id else message.channel.id
    if MONITORED_CHANNEL_IDS and channel_to_check not in MONITORED_CHANNEL_IDS:
        return

    # PluralKit handling: Wait a moment to see if message gets proxied
    # If it's NOT a webhook, wait briefly to let PluralKit delete original
    # REDUCED from 2s to 0.5s to avoid Discord rate limits and Railway timeouts
    if not message.webhook_id:
        await asyncio.sleep(0.5)  # Reduced wait time
        # Check if message still exists (PluralKit deletes originals)
        try:
            await message.channel.fetch_message(message.id)
            # Message still exists, not proxied by PluralKit - process it
        except discord.NotFound:
            # Message was deleted (PluralKit proxied it) - skip
            logger.debug("Message deleted by PluralKit, skipping original")
            return
        except discord.HTTPException as e:
            # Handle Discord API errors gracefully
            logger.warning(f"Discord API error checking message: {e}")
            return
    # If it IS a webhook, process immediately (it's the proxied version)

    # Only process messages with PNG/JPEG/WebP attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        return

    # Check if we already processed this attachment (avoid PluralKit double-processing)
    # PluralKit creates a NEW message but keeps the same attachment URL!
    attachment = attachments[0]
    if attachment.url in processed_attachment_urls:
        logger.debug("Skipping already-processed attachment %s", attachment.filename)
        return

    # Mark attachment as processed (prevent double-processing for PluralKit)
    processed_attachment_urls.add(attachment.url)
    if len(processed_attachment_urls) > MAX_TRACKED_ATTACHMENTS:
        # Clear old entries when cache gets too big
        processed_attachment_urls.clear()

    logger.info("Scanning message from %s with %s images", message.author, len(attachments))

    try:
        # IMPORTANT: Discord strips JPEG/WebP metadata during processing!
        # If we scan too fast, we'll see metadata that gets deleted moments later.
        # Wait for Discord to finish processing before scanning.
        has_jpeg_or_webp = any(
            a.filename.lower().endswith((".jpg", ".jpeg", ".webp"))
            for a in attachments
        )
        if has_jpeg_or_webp:
            # Give Discord time to strip metadata from JPEGs/WebP
            await asyncio.sleep(2.0)
            logger.debug("Waited for Discord to process JPEG/WebP files")

        # Scan ALL images for metadata
        # Use semaphore to process one image at a time (prevents CPU spikes & RAM overflow)
        images_with_metadata = []
        for attachment in attachments:
            # Semaphore ensures only 1 image processes at a time
            async with metadata_processing_semaphore:
                image_data = await attachment.read()
                metadata = await parse_image_metadata(image_data, attachment.filename)
                if metadata:
                    # Log what type of metadata was found
                    metadata_type = metadata.get("tool", "Unknown")
                    logger.info("✅ Found metadata in %s - Type: %s", attachment.filename, metadata_type)
                    images_with_metadata.append({
                        "attachment": attachment,
                        "metadata": metadata,
                    })
                else:
                    logger.info("❌ No metadata found in %s", attachment.filename)

        if not images_with_metadata:
            # No metadata in any image
            # Check if images are JPG/WebP (Discord strips metadata from these)
            first_image = attachments[0]
            is_jpg_or_webp = first_image.filename.lower().endswith((".jpg", ".jpeg", ".webp"))

            # Only react with ⛔ for PNG files with no metadata
            # JPEG/WebP never have metadata anyway, so don't spam reactions
            if REACT_ON_NO_METADATA and not is_jpg_or_webp:
                await message.add_reaction(EMOJI_NOT_FOUND)
                logger.info("❌ No metadata in PNG image")

            # Customize message based on file type
            if is_jpg_or_webp:
                no_metadata_msg = (
                    "📸 **JPEG/WebP detected!**\n"
                    "Discord strips metadata from these formats when uploaded.\n\n"
                    "💡 **Options:**\n"
                    "• Use `/describe` to generate AI tags\n"
                    "• Re-upload as PNG to preserve metadata\n"
                    "• Add details manually below"
                )
            else:
                no_metadata_msg = "ℹ️ No metadata found in these images. Would you like to add details manually?"

            # Offer manual entry for first image
            view = ManualEntryPromptView(message, first_image)
            try:
                await message.reply(
                    no_metadata_msg,
                    view=view,
                    mention_author=False,
                )
            except discord.NotFound:
                logger.debug("Original message deleted, posting to channel instead")
                await message.channel.send(
                    no_metadata_msg,
                    view=view,
                )
            return

        # Found metadata! Store in cache for later retrieval
        global message_metadata_cache
        message_metadata_cache[message.id] = images_with_metadata

        # Limit cache size
        if len(message_metadata_cache) > MAX_CACHED_MESSAGES:
            # Remove oldest entries (first 20)
            oldest_keys = list(message_metadata_cache.keys())[:20]
            for key in oldest_keys:
                del message_metadata_cache[key]

        # Check if all images are JPEG/WebP (likely false positives due to Discord race condition)
        all_stripped_formats = all(
            img["attachment"].filename.lower().endswith((".jpg", ".jpeg", ".webp"))
            for img in images_with_metadata
        )

        if all_stripped_formats:
            # Don't add emoji reactions for JPEG/WebP - Discord strips metadata anyway
            # Any "metadata" found is likely a race condition before Discord finishes processing
            logger.info("⚠️ Skipping emoji reactions for JPEG/WebP (Discord strips metadata)")
            # Show helpful message instead
            await message.reply(
                "📸 **JPEG/WebP detected!**\n"
                "These formats lose metadata on Discord.\n\n"
                "💡 Use `/describe` to generate AI tags for these images!",
                mention_author=False,
            )
            return

        # Decide reaction strategy based on count (PNG files only at this point)
        num_images = len(images_with_metadata)

        if num_images <= 5:
            # 1-5 images: Add numbered reactions
            number_emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"]
            for i in range(num_images):
                await message.add_reaction(number_emojis[i])
            logger.info("✅ Added %d numbered reactions for individual inspection", num_images)
        else:
            # 6+ images: Add single reaction for batch download
            await message.add_reaction("📦")
            logger.info("✅ Added batch reaction for %d images", num_images)

    except discord.HTTPException as e:
        if e.code == 50035:  # Invalid Form Body - message deleted
            logger.debug("Message deleted by PluralKit proxy, skipping reply")
        else:
            logger.error("Discord error in on_message: %s", e)
    except Exception as e:
        logger.error("Error in on_message: %s", e)


@bot.event
async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
    """Handle emoji reactions for metadata display (numbered or batch)."""
    # For threads/forums, check parent channel ID
    channel = bot.get_channel(payload.channel_id)
    channel_id_to_check = channel.parent_id if hasattr(channel, "parent_id") and channel.parent_id else payload.channel_id

    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and channel_id_to_check in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[channel_id_to_check]:
        return

    # Only in monitored channels (empty set = monitor all channels)
    if MONITORED_CHANNEL_IDS and channel_id_to_check not in MONITORED_CHANNEL_IDS:
        return

    # Ignore bot's own reactions
    if payload.member and payload.member.bot:
        return

    # Rate limit check
    if rate_limiter.is_rate_limited(payload.user_id):
        logger.warning("Rate limit exceeded for user %s", payload.user_id)
        return

    # Check which emoji was clicked
    emoji_name = payload.emoji.name
    number_emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"]

    # Only respond to our special emojis
    if emoji_name not in number_emojis and emoji_name != "📦":
        return

    try:
        # Fetch the message
        channel = bot.get_channel(payload.channel_id)
        message = await channel.fetch_message(payload.message_id)

        # Check if we have cached metadata for this message
        if payload.message_id not in message_metadata_cache:
            logger.warning("No cached metadata for message %s", payload.message_id)
            return

        images_with_metadata = message_metadata_cache[payload.message_id]
        real_author = await get_real_author(message)

        if emoji_name == "📦":
            # Batch download - create JSON with all metadata
            batch_data = {
                "batch_size": len(images_with_metadata),
                "images": [],
            }

            for item in images_with_metadata:
                batch_data["images"].append({
                    "filename": item["attachment"].filename,
                    "url": item["attachment"].url,
                    "metadata": item["metadata"],
                })

            # Create JSON file
            json_str = json.dumps(batch_data, indent=2)
            file_obj = discord.File(
                io.StringIO(json_str),
                filename=f"batch_metadata_{len(images_with_metadata)}_images.json",
            )

            # Send to user
            await message.reply(
                f"📦 **Batch Metadata** ({len(images_with_metadata)} images with metadata)\n"
                f"Downloaded by {payload.member.mention}",
                file=file_obj,
                mention_author=False,
            )
            logger.info("✅ Sent batch metadata for %d images (clicked by %s)",
                       len(images_with_metadata), payload.member.name)

        elif emoji_name in number_emojis:
            # Individual image - find which number
            image_index = number_emojis.index(emoji_name)

            if image_index >= len(images_with_metadata):
                logger.warning("Image index %d out of range for message %s", image_index, payload.message_id)
                return

            # Get the specific image's metadata
            item = images_with_metadata[image_index]
            metadata = item["metadata"]

            # Format public message
            public_message = format_public_metadata_message(metadata, real_author)
            public_message = f"**Image {image_index + 1}/{len(images_with_metadata)}**\n\n{public_message}"

            # Create view with buttons
            view = PublicMetadataView(metadata, real_author)

            # Reply to the original message
            await message.reply(public_message, view=view, mention_author=False)

            logger.info("✅ Posted metadata for image %d/%d (clicked by %s)",
                        image_index + 1, len(images_with_metadata), payload.member.name)

    except Exception as e:
        logger.error("Error in on_raw_reaction_add: %s", e)


# =============================================================================
# SLASH COMMANDS (Modern UX)
# =============================================================================

@bot.tree.command(name="metadata", description="Parse metadata from an image")
async def metadata_command(interaction: discord.Interaction, image: discord.Attachment):
    """Slash command to parse metadata from an uploaded image.

    Args:
        interaction: Discord interaction
        image: Image attachment

    """
    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
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


@bot.tree.command(name="techsupport", description="Get IT help with personality")
async def techsupport_command(interaction: discord.Interaction, issue: str):
    """Tech support from a seasoned IT professional with opinions.

    Args:
        issue: Describe your tech problem

    """
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


@bot.tree.command(name="coder", description="Get coding help and solutions")
async def coder_command(interaction: discord.Interaction, question: str):
    """Get expert programming assistance with working code solutions.

    Args:
        question: Describe your coding problem or question

    """
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


@bot.tree.command(name="describe", description="Describe an image using AI")
@app_commands.choices(style=[
    app_commands.Choice(name="Danbooru Tags", value="danbooru"),
    app_commands.Choice(name="Natural Language", value="natural"),
])
async def describe_command(interaction: discord.Interaction, style: app_commands.Choice[str], image: discord.Attachment = None, private: bool = False):
    """Slash command to describe an image using AI vision.

    Args:
        interaction: Discord interaction
        style: Description style (danbooru tags or natural language)
        image: Image attachment to describe (optional if replying to a message with an image)
        private: If True, response is only visible to you (ephemeral)

    """
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


# =============================================================================
# COMMUNITY COMMANDS (Non-AI)
# =============================================================================

@bot.tree.command(name="decide", description="Let the bot make a choice for you")
async def decide_command(interaction: discord.Interaction, choices: str):
    """Randomly picks one option from a comma-separated list.

    Args:
        choices: Comma-separated list of options (e.g. "pizza, tacos, sushi")

    """
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

    import random
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


@bot.tree.command(name="poll", description="Create a quick poll")
@app_commands.choices(poll_type=[
    app_commands.Choice(name="Yes/No", value="yesno"),
    app_commands.Choice(name="A or B", value="ab"),
])
async def poll_command(interaction: discord.Interaction, question: str, poll_type: app_commands.Choice[str], option_a: str = None, option_b: str = None):
    """Create a quick poll with automatic reactions.

    Args:
        question: The poll question
        poll_type: Type of poll (Yes/No or A/B)
        option_a: Option A text (required for A/B polls)
        option_b: Option B text (required for A/B polls)

    """
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


@bot.tree.command(name="wildcard", description="Generate a random art prompt")
async def wildcard_command(interaction: discord.Interaction):
    """Generates a random art prompt using wildcards."""
    # Check if fun_commands feature is enabled for this guild
    if interaction.guild and not get_guild_setting(interaction.guild.id, "fun_commands", default=True):
        await interaction.response.send_message("❌ Fun commands are not enabled on this server.", ephemeral=True)
        return

    import random

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


@bot.tree.command(name="settings", description="Configure bot features for this server (Admin only)")
@app_commands.default_permissions(administrator=True)
async def settings_command(interaction: discord.Interaction):
    """Configure which bot features are enabled for this server.

    Only server administrators can use this command.
    """
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

            async def make_callback(f=feature, n=name):
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


@bot.tree.command(name="interact", description="Interact with another user (hug, poke, etc.)")
@app_commands.choices(action=[
    app_commands.Choice(name="🤗 Hug", value="hug"),
    app_commands.Choice(name="👉 Poke", value="poke"),
    app_commands.Choice(name="😤 Taunt", value="taunt"),
    app_commands.Choice(name="⭐ Pat", value="pat"),
    app_commands.Choice(name="🙌 High-five", value="highfive"),
])
async def interact_command(interaction: discord.Interaction, action: app_commands.Choice[str], user: discord.User, system_member: str = None):
    """Interact with another user or a specific system member.

    Args:
        action: Type of interaction
        user: The user to interact with
        system_member: Optional - specific system member name (for PluralKit users)

    """
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
        import random

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


# =============================================================================
# AI HELPER FUNCTIONS
# =============================================================================

conversation_sessions = {}

async def get_pluralkit_name(message: discord.Message) -> str:
    """Get the fronting alter's name from PluralKit if the message is proxied.

    Args:
        message: Discord message to check

    Returns:
        Fronting alter's name if message is from PluralKit, otherwise the Discord username

    """
    # PluralKit's webhook messages have a specific pattern
    if message.webhook_id:
        try:
            # Try to fetch the PluralKit API for message info
            async with aiohttp.ClientSession() as session:
                async with session.get(f"https://api.pluralkit.me/v2/messages/{message.id}") as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Return the member's name if found
                        if "member" in data and "name" in data["member"]:
                            return data["member"]["name"]
        except Exception as e:
            logger.debug(f"Error fetching PluralKit info: {e}")

    # Fallback to Discord display name
    return message.author.display_name

def optimize_image_for_api(image_data: bytes, mime_type: str, max_size_mb: float = 3.5) -> tuple[bytes, str]:
    """Optimize image for API consumption by resizing if it exceeds the size limit.

    Args:
        image_data: Raw image bytes
        mime_type: Image MIME type (e.g. 'image/jpeg')
        max_size_mb: Maximum size in MB before optimization (default 3.5MB for Claude)

    Returns:
        Tuple of (optimized_image_bytes, mime_type)

    """
    import io

    from PIL import Image

    # Check current size
    current_size_mb = len(image_data) / (1024 * 1024)

    if current_size_mb <= max_size_mb:
        # Image is already small enough
        return image_data, mime_type

    logger.info(f"🔄 Image too large ({current_size_mb:.2f}MB), optimizing to under {max_size_mb}MB...")

    # Open image
    img = Image.open(io.BytesIO(image_data))

    # Convert RGBA to RGB if needed (for JPEG compatibility)
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background

    # Calculate resize factor to get under max_size_mb
    # Start with 80% of original dimensions
    scale_factor = 0.8

    while current_size_mb > max_size_mb and scale_factor > 0.1:
        new_width = int(img.width * scale_factor)
        new_height = int(img.height * scale_factor)

        # Resize image
        resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # Save to bytes with quality optimization
        output = io.BytesIO()
        resized_img.save(output, format="JPEG", quality=85, optimize=True)
        optimized_data = output.getvalue()
        current_size_mb = len(optimized_data) / (1024 * 1024)

        # Reduce scale factor for next iteration if needed
        scale_factor -= 0.1

    logger.info(f"✅ Image optimized to {current_size_mb:.2f}MB ({new_width}x{new_height})")

    return optimized_data, "image/jpeg"

async def describe_image_with_claude(image_data: bytes, mime_type: str, prompt: str, model: str = None) -> str:
    """Describe an image using Claude's vision API.

    Args:
        image_data: Raw image bytes
        mime_type: Image MIME type (e.g. 'image/jpeg')
        prompt: Description prompt
        model: Claude model to use (defaults to CLAUDE_PRIMARY_MODEL)

    Returns:
        Description text from Claude

    """
    if not claude_client:
        raise Exception("Claude API not initialized - set ANTHROPIC_API_KEY")

    if model is None:
        model = CLAUDE_PRIMARY_MODEL

    # Optimize image if needed (prevents 400 errors from oversized images)
    image_data, mime_type = optimize_image_for_api(image_data, mime_type)

    # Encode image to base64 for Claude
    import base64
    image_base64 = base64.b64encode(image_data).decode("utf-8")

    # Claude vision API call
    response = await claude_client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": image_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            },
        ],
    )

    # Extract text from response
    if response.content and len(response.content) > 0:
        return response.content[0].text
    return None

async def call_gemini_with_retry(api_call_factory, max_retries: int = None, base_delay: float = None, fallback_models: list = None):
    """Call Gemini API with exponential backoff retry for 503 errors and model fallbacks.

    Args:
        api_call_factory: Callable that takes a model name and returns an async callable for the API call
        max_retries: Maximum number of retry attempts per model (defaults to config value)
        base_delay: Base delay in seconds (doubles with each retry, defaults to config value)
        fallback_models: List of model names to try as fallbacks (defaults to config value)

    Returns:
        API response

    Raises:
        Exception: If all retries and fallbacks fail

    """
    if max_retries is None:
        max_retries = GEMINI_MAX_RETRIES
    if base_delay is None:
        base_delay = GEMINI_RETRY_DELAY
    if fallback_models is None:
        fallback_models = GEMINI_FALLBACK_MODELS

    last_error = None

    # Try each model in the fallback chain
    for model_idx, model_name in enumerate(fallback_models):
        if model_idx > 0:
            logger.info(f"Trying fallback model: {model_name}")

        # Try the current model with retries
        for attempt in range(max_retries):
            try:
                api_call = api_call_factory(model_name)
                return await api_call()
            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check if it's a 503 error or rate limit
                is_service_error = any(keyword in error_str for keyword in [
                    "503", "service unavailable", "overloaded", "rate limit", "429",
                ])

                if is_service_error:
                    if attempt < max_retries - 1:
                        # Retry with exponential backoff
                        delay = base_delay * (2 ** attempt)
                        logger.warning(f"Gemini error with {model_name} (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                        await asyncio.sleep(delay)
                        continue
                    if model_idx < len(fallback_models) - 1:
                        # Try next fallback model
                        logger.warning(f"Model {model_name} failed after {max_retries} attempts, trying fallback...")
                        break
                    # All models exhausted
                    logger.error("All Gemini models failed after retries")
                else:
                    # Not a service error, don't retry
                    raise

    # All retries and fallbacks failed
    raise last_error

async def ask_gemini(user: discord.User, question: str, user_display_name: str = None) -> str:
    """Asks a question to the Gemini API using the new SDK with retry and fallback support.

    Args:
        user: Discord user object
        question: Question to ask
        user_display_name: Optional display name to use (for PluralKit integration)

    """
    if not gemini_client:
        return "❌ Gemini API key is not configured."

    try:
        # Use provided display name or fall back to Discord name
        display_name = user_display_name or user.display_name

        # Get or create chat session for the user
        if user.id not in conversation_sessions:
            # Create new chat session with system instruction (using primary model)
            conversation_sessions[user.id] = gemini_client.aio.chats.create(
                model=GEMINI_PRIMARY_MODEL,
                config=types.GenerateContentConfig(
                    system_instruction=f"You are a helpful assistant talking to {display_name}. Address them by name when appropriate. Your goal is to provide accurate and concise answers.",
                ),
            )

        chat = conversation_sessions[user.id]

        # Send message with retry logic
        def make_call_factory(model_name):
            async def make_call():
                # For chat sessions, we need to recreate the session if switching models
                nonlocal chat
                if model_name != GEMINI_PRIMARY_MODEL:
                    logger.info(f"Recreating chat session with fallback model: {model_name}")
                    chat = gemini_client.aio.chats.create(
                        model=model_name,
                        config=types.GenerateContentConfig(
                            system_instruction="You are a helpful assistant. Your goal is to provide accurate and concise answers.",
                        ),
                    )
                    conversation_sessions[user.id] = chat

                return await chat.send_message(question)
            return make_call

        response = await call_gemini_with_retry(make_call_factory)
        return response.text

    except Exception as e:
        logger.error("Error calling Gemini API: %s", e)
        return f"❌ Error generating response: {e}"


# =============================================================================
# CONTEXT MENU (Right-click)
# =============================================================================

async def view_prompt_context(interaction: discord.Interaction, message: discord.Message):
    """Context menu to view prompts from a message.

    Args:
        interaction: Discord interaction
        message: Target message

    """
    # Check if metadata feature is enabled for this channel
    if CHANNEL_FEATURES and interaction.channel.id in CHANNEL_FEATURES and "metadata" not in CHANNEL_FEATURES[interaction.channel.id]:
        await interaction.response.send_message("❌ This command is not enabled in this channel.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)

    # Rate limit check
    if rate_limiter.is_rate_limited(interaction.user.id):
        await interaction.followup.send(
            "⏰ You're making requests too quickly. Please wait a minute.",
            ephemeral=True,
        )
        return

    # Get PNG/JPEG/WebP attachments
    attachments = [
        a for a in message.attachments
        if a.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and a.size < SCAN_LIMIT_BYTES
    ]

    if not attachments:
        await interaction.followup.send(
            "❌ No PNG, JPEG, or WebP images found in this message.",
            ephemeral=True,
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
                ephemeral=True,
            )
            sent_count += 1

    if sent_count == 0:
        await interaction.followup.send(
            "❌ No metadata found in any images.",
            ephemeral=True,
        )


# =============================================================================
# UI COMPONENTS
# =============================================================================

class ManualMetadataModal(discord.ui.Modal, title="Add Image Details"):

    """Modal for manually entering image metadata."""

    prompt = discord.ui.TextInput(
        label="Prompt",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the positive prompt (optional)",
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

    @discord.ui.button(label="Full Parameters", style=discord.ButtonStyle.green)
    async def full_params(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Show full metadata as text file with JSON pretty-printing."""
        button.disabled = True
        await interaction.edit_original_response(view=self)

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
