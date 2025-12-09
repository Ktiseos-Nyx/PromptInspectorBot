"""Security System - Anti-Scam Detection

Detects and prevents two main scammer types:
1. Wallet Scammers: Crypto wallet spam with currency symbols in name, ALL CAPS
2. Screenshot Spammers: 4+ crypto screenshots, cross-posting, gibberish text
"""
import datetime
import hashlib
import io
import json
import re
from typing import Dict, Optional

import discord
from PIL import Image

from .config import (
    logger,
    CATCHER_ROLE_ID,
    TRUSTED_USER_IDS,
    ADMIN_CHANNEL_IDS,
)

# ============================================================================
# MESSAGE TRACKING FOR CROSS-POSTING DETECTION
# ============================================================================

# Message tracking for cross-posting detection
# Structure: {user_id: [{'fingerprint': hash, 'channel_id': int, 'timestamp': float, 'message_id': int}, ...]}
user_recent_messages: Dict[int, list] = {}
MAX_TRACKED_MESSAGES_PER_USER = 50
CROSS_POST_WINDOW_SECONDS = 300  # 5 minutes

# Crypto scam keyword patterns (case-insensitive, with point values)
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

# ============================================================================
# MESSAGE FINGERPRINTING
# ============================================================================

def get_message_fingerprint(message: discord.Message) -> str:
    """Create a hash of message content + attachments for duplicate detection."""
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

# ============================================================================
# SPAM & GIBBERISH DETECTION
# ============================================================================

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

# ============================================================================
# SCAM SCORING
# ============================================================================

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

# ============================================================================
# IMAGE SAFETY VERIFICATION
# ============================================================================

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

# ============================================================================
# BAN & DELETE ACTIONS
# ============================================================================

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

# ============================================================================
# ADMIN ALERTS
# ============================================================================

async def alert_admins(guild: discord.Guild, user: discord.User, reason: str, details: list = None, action: str = "ALERT", bot=None):
    """Send alert to admin channels about security event (supports multiple channels).
    
    Args:
        guild: Discord guild where event occurred
        user: User involved in security event
        reason: Reason for alert
        details: Additional details list
        action: Action type (BANNED, COMPROMISED, DELETED, ALERT)
        bot: Bot instance (needed to access channels in other guilds)
    """
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
            if not channel and bot:
                channel = bot.get_channel(channel_id)

            if channel:
                await channel.send(embed=embed)
            else:
                logger.warning(f"Admin channel {channel_id} not found or not accessible")
        except Exception as e:
            logger.error(f"Failed to send admin alert to channel {channel_id}: {e}")

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

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
