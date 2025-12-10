"""Configuration and initialization for PromptInspectorBot

Loads settings from:
1. Environment variables (.env)
2. config.toml file
3. Default values

This module should be imported first by all other modules.
"""
import asyncio
import logging
import os
import warnings
from pathlib import Path
from typing import Dict

import boto3
import botocore
import toml
from dotenv import load_dotenv
from google import genai
from utils.security import RateLimiter

# Suppress aiohttp unclosed client session warnings on shutdown
warnings.filterwarnings("ignore", message="Unclosed client session", category=ResourceWarning)

# ============================================================================
# ENVIRONMENT & CONFIG LOADING
# ============================================================================

# Load environment variables
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Load config from toml file
config = toml.load("config.toml") if Path("config.toml").exists() else {}

# ============================================================================
# CONFIGURATION PARSING HELPERS
# ============================================================================

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

# ============================================================================
# DISCORD CONFIGURATION
# ============================================================================

ALLOWED_GUILD_IDS = parse_id_list("ALLOWED_GUILD_IDS", "ALLOWED_GUILD_IDS")
MONITORED_CHANNEL_IDS = parse_id_list("MONITORED_CHANNEL_IDS", "MONITORED_CHANNEL_IDS")
CHANNEL_FEATURES = parse_channel_features("CHANNEL_FEATURES", "channel_features")
EMOJI_FOUND = config.get("EMOJI_METADATA_FOUND", "🔎")
EMOJI_NOT_FOUND = config.get("EMOJI_NO_METADATA", "⛔")
REACT_ON_NO_METADATA = config.get("REACT_ON_NO_METADATA", False)
SCAN_LIMIT_BYTES = config.get("SCAN_LIMIT_BYTES", 10 * 1024 * 1024)  # 10MB

# ============================================================================
# GEMINI AI CONFIGURATION
# ============================================================================

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

# Initialize Gemini client (new SDK)
gemini_client = None
if GEMINI_API_KEY:
    gemini_client = genai.Client(
        api_key=GEMINI_API_KEY,
    )

# ============================================================================
# CLAUDE AI CONFIGURATION
# ============================================================================

# Default to Haiku for cost-efficiency (works great for image descriptions, 10x cheaper than Sonnet)
CLAUDE_PRIMARY_MODEL = os.getenv("CLAUDE_PRIMARY_MODEL") or config.get("CLAUDE_PRIMARY_MODEL", "claude-3-5-haiku-20241022")
CLAUDE_FALLBACK_MODELS = config.get("CLAUDE_FALLBACK_MODELS", [
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307",
])

# Initialize Claude client (Anthropic SDK)
claude_client = None
if ANTHROPIC_API_KEY:
    from anthropic import AsyncAnthropic
    claude_client = AsyncAnthropic(
        api_key=ANTHROPIC_API_KEY,
    )

# ============================================================================
# LLM PROVIDER SELECTION
# ============================================================================

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

# ============================================================================
# R2 CONFIGURATION (Optional - Cloudflare R2 Storage)
# ============================================================================

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
R2_UPLOAD_EXPIRATION = config.get("R2_UPLOAD_EXPIRATION", 3600)  # Pre-signed URL expiry in seconds

# Ko-fi supporter role IDs for increased upload limits
# Can be comma-separated list in env: SUPPORTER_ROLE_IDS=123,456,789
SUPPORTER_ROLE_IDS = parse_id_list("SUPPORTER_ROLE_IDS", "SUPPORTER_ROLE_IDS")

# Backward compatibility: also check old KOFI_SUPPORTER_ROLE_ID config
if not SUPPORTER_ROLE_IDS and "KOFI_SUPPORTER_ROLE_ID" in config:
    kofi_role = config.get("KOFI_SUPPORTER_ROLE_ID", 0)
    if kofi_role:
        SUPPORTER_ROLE_IDS = {kofi_role}

# ============================================================================
# SECURITY CONFIGURATION
# ============================================================================

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

# ============================================================================
# LOGGING SETUP
# ============================================================================

# Setup logging (MUST be before R2 setup so logger exists!)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("PromptInspector")

# ============================================================================
# R2 CLIENT INITIALIZATION
# ============================================================================

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

# ============================================================================
# LOG AVAILABLE LLM PROVIDERS
# ============================================================================

if AVAILABLE_PROVIDERS:
    logger.info("🤖 Available LLM providers: %s", ", ".join(AVAILABLE_PROVIDERS))
    logger.info("📋 Provider priority: %s", " → ".join(LLM_PROVIDER_PRIORITY))
else:
    logger.warning("⚠️ No LLM providers available! Set GEMINI_API_KEY or ANTHROPIC_API_KEY.")

# ============================================================================
# RATE LIMITERS
# ============================================================================

# Separate rate limiters for different features
rate_limiter = RateLimiter(max_requests=5, window_seconds=30)         # Metadata (local parsing - keep lenient)
gemini_rate_limiter = RateLimiter(max_requests=1, window_seconds=10)  # Gemini API - STRICT (1 per 10s to prevent quota abuse)

# ============================================================================
# GLOBAL STATE VARIABLES
# ============================================================================

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
# DISCORD BOT INTENTS
# ============================================================================

import discord

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.guilds = True  # Needed for thread events
