# Prompt Inspector 🔎

Inspect AI image generation metadata from Discord uploads. Enhanced fork with powerful security features and streamlined setup.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/OCA5uC?referralCode=EQxw4P&utm_medium=integration&utm_source=template&utm_campaign=generic)

## 📑 Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [Security System](#security-system)
- [AI Provider Setup](#ai-provider-setup)
- [R2 Upload Feature](#r2-upload-feature-optional)
- [Configuration](#configuration)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)
- [Legal](#legal)

---

## Features

### Core Features
- 🔍 **Comprehensive Metadata Parsing** - Supports 200+ ComfyUI nodes (FLUX, PixArt, Griptape, etc.)
- 1️⃣2️⃣3️⃣ **Multiple Interaction Styles** - Numbered emoji reactions, slash commands, or context menus
- 📦 **Batch Processing** - Handle 6+ images with a single reaction
- 👥 **PluralKit Support** - Automatically resolves proxied messages
- 💾 **Lightweight** - Runs metadata parser in separate process (~100MB RAM)

### AI Features
- ✨ **`/describe`** - Generate AI descriptions (Danbooru tags or natural language)
- 💬 **`/ask`** - Conversational AI with context memory
- 🔄 **Multi-Provider** - Gemini + Claude with automatic fallback

### Security Features
- 🛡️ **Anti-Scam Detection** - Behavior-based crypto/wallet spam detection
- 🚫 **Cross-Posting Protection** - Instant ban for spam across multiple channels
- 🔒 **Malware Prevention** - Magic bytes check on attachments and embeds
- 📊 **Smart Scoring** - Context-aware detection (allows emotional spam from trusted users)

---

## Quick Start

<details>
<summary><b>Local Setup</b></summary>

```bash
# Clone and setup
git clone https://github.com/Ktiseos-Nyx/PromptInspectorBot.git
cd PromptInspectorBot
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure
cp config.example.toml config.toml
# Edit config.toml with your settings

# Run
python3 bot_enhanced.py
```

</details>

<details>
<summary><b>Docker Deployment</b></summary>

```bash
# Build
docker build -t prompt-inspector-bot .

# Run with .env file
docker run -d --env-file .env prompt-inspector-bot
```

</details>

<details>
<summary><b>Environment Variables (Required)</b></summary>

```env
BOT_TOKEN=your_discord_bot_token

# Optional but recommended
GEMINI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=your_claude_key
```

</details>

---

## How to Use

### Metadata Inspection

1. **Post an image** in a monitored channel
2. **Click emoji reactions:**
   - 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ - View individual image metadata (1-5 images)
   - 📦 - Download all metadata as files (6+ images)
3. **Or use commands:**
   - `/metadata <image>` - Parse uploaded image
   - Right-click image → "View Prompt"

### AI Features

- `/ask <question>` - Chat with AI (remembers context per user)
- `/describe <image> <style>` - Generate AI tags/descriptions

---

## Security System

<details>
<summary><b>🛡️ Anti-Scam Features</b></summary>

### What It Detects

**Type 1: Wallet Scammers**
- Currency symbols in username (£, €, ¥, ₿)
- Hoisting characters (=, !, #)
- ALL CAPS crypto spam
- Keywords: WALLET, SOL, PAY, DEAD TOKENS

**Type 2: Screenshot Spammers**
- 4+ images cross-posted to multiple channels
- Gibberish text or empty messages
- Auto-generated usernames (word.word1234_5678)

### How It Works

| Score | Action |
|-------|--------|
| 100+ | **Instant Ban** - User banned, all messages deleted |
| 75-99 | **Delete + Alert** - Message removed, admins notified |
| 50-74 | **Watchlist** - Logged for monitoring |

### Detection Methods

✅ **Magic Bytes Check** - Scans attachments AND embeds for malware
✅ **Cross-Posting** - Same message in 2+ channels = ban
✅ **Gibberish Detection** - Context-aware (allows "AAAA" from users with roles)
✅ **Username Analysis** - Hoisting, currency symbols, auto-generated patterns
✅ **Role Tracking** - CATCHER role exploitation detection

### Configuration

```toml
# config.toml
CATCHER_ROLE_ID = 1336289642789470228  # Self-assignable role scammers exploit
TRUSTED_USER_IDS = [123456789]         # Bypass security (mods, bots)
ADMIN_CHANNEL_ID = 1234567890          # Ban notification channel
```

**Automatic Bypasses:**
- ✅ Server owners
- ✅ Trusted users (configured above)

</details>

---

## AI Provider Setup

<details>
<summary><b>🤖 Multi-Provider System</b></summary>

The bot supports **both Gemini and Claude** with automatic fallback!

### Quick Setup

```env
# Set API keys for providers you want
GEMINI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=your_claude_key

# Provider priority (tries first, falls back to next)
LLM_PROVIDER_PRIORITY=claude,gemini
```

### Gemini Configuration

```env
GEMINI_PRIMARY_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODELS=gemini-flash-latest,gemini-2.5-pro,gemini-2.5-flash
```

**Model Recommendations:**

| Model | Speed | Quality | Free Tier | Best For |
|-------|-------|---------|-----------|----------|
| `gemini-flash-latest` | ⚡⚡⚡ | Good | 15/min | **Recommended** |
| `gemini-2.5-pro` | ⚡ | Excellent | 2/min | Complex tasks |
| `gemini-2.5-flash` | ⚡⚡⚡ | Good | 15/min | ⚠️ Overly strict |

### Claude Configuration

```env
CLAUDE_PRIMARY_MODEL=claude-3-5-haiku-20241022
```

**Model Recommendations:**

| Model | Speed | Cost (per 1M tokens) | Best For |
|-------|-------|---------------------|----------|
| `claude-3-5-haiku-20241022` | ⚡⚡⚡ | $0.25 / $1.25 | **Recommended** |
| `claude-3-5-sonnet-20241022` | ⚡⚡ | $3 / $15 | Higher quality |

**Budget tip:** $5 starter credit = ~1,500 image descriptions with Haiku!

### NSFW/Artistic Content Mode

If Gemini blocks artistic content (PG-13/R-rated, not NC-17):

```env
NSFW_PROVIDER_OVERRIDE=claude
```

This skips Gemini entirely for `/describe` and uses only Claude.

</details>

---

## R2 Upload Feature (Optional)

<details>
<summary><b>📤 Cloudflare R2 Integration</b></summary>

Upload JPEG/WebP files to extract metadata without Discord stripping it.

### Features

- 🔒 **Rate Limited** - 5 uploads per user per day
- 🗑️ **Auto-Delete** - 30-day retention
- 📏 **Size Limited** - 10MB max
- ⚠️ **Security Warnings** - "Not 100% secure" notices

### Setup

1. **Create R2 Bucket** in Cloudflare
2. **Set environment variables:**

```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
UPLOADER_URL=https://your-pages.pages.dev/uploader.html
```

3. **Deploy `uploader.html`** to Cloudflare Pages
4. **Set lifecycle rule** for 30-day auto-deletion:
   - Prefix: `uploads/`
   - Action: Delete object
   - Days: 30

### Security

- ✅ Rate limiting (5/day per user)
- ✅ File validation (10MB, JPEG/WebP only)
- ✅ Presigned URL expiry (1 hour)
- ✅ Auto-deletion (30 days)
- ⚠️ Users warned about security risks

</details>

---

## Configuration

<details>
<summary><b>⚙️ Full Configuration Options</b></summary>

### Server & Channel Configuration

```toml
# Allowed servers (empty = all servers)
ALLOWED_GUILD_IDS = [123456789, 987654321]

# Monitored channels (empty = all channels)
MONITORED_CHANNEL_IDS = []

# Per-channel features
[channel_features]
1234567890 = ["metadata", "describe"]
9876543210 = ["ask"]
```

### Bot Behavior

```toml
REACT_ON_NO_METADATA = false
EMOJI_METADATA_FOUND = "🔎"
EMOJI_NO_METADATA = "⛔"
SCAN_LIMIT_BYTES = 10485760  # 10MB
```

### AI Configuration

```toml
LLM_PROVIDER_PRIORITY = ["claude", "gemini"]
GEMINI_PRIMARY_MODEL = "gemini-flash-latest"
CLAUDE_PRIMARY_MODEL = "claude-3-5-haiku-20241022"
```

### Security Configuration

```toml
CATCHER_ROLE_ID = 1336289642789470228
TRUSTED_USER_IDS = []
ADMIN_CHANNEL_ID = 0
```

</details>

---

## Permissions

### Core Permissions (Required)
- ✅ Read Messages/View Channel
- ✅ Send Messages
- ✅ Read Message History
- ✅ Add Reactions
- ✅ Attach Files

### Security Permissions (Optional)
- 🛡️ **Ban Members** - Auto-ban scammers
- 🛡️ **Manage Messages** - Delete spam

---

## Troubleshooting

<details>
<summary><b>Common Issues</b></summary>

**Bot not responding:**
- Check bot is online
- Verify permissions (see above)
- Check logs for errors

**Describe feature not working:**
- Ensure `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is set
- Check API quotas
- Review logs for API errors

**Images not processed:**
- Check file format (PNG, JPEG, WebP)
- Verify size is under `SCAN_LIMIT_BYTES`
- Ensure channel is in `MONITORED_CHANNEL_IDS` (if configured)

**Security system banning legit users:**
- Add user ID to `TRUSTED_USER_IDS`
- Server owners are automatically trusted
- Users with roles can post emotional spam ("AAAA")

</details>

---

## Legal

- 📄 **[Privacy Policy](PRIVACY.md)** - How we handle data (TL;DR: we don't store it)
- 📜 **[Terms of Service](TERMS_OF_SERVICE.md)** - The rules

**Quick Summary:**
- ✅ Extract metadata, send to you
- ✅ Delete images immediately after processing
- ❌ Don't store images or metadata
- ❌ Don't track or sell data

---

## Examples

![Example 1](images/2023-03-09_00-14.png)
![Example 2](images/2023-03-09_00-14_1.png)

---

**🤖 This bot is a fork of [PromptInspectorBot](https://github.com/sALTaccount/PromptInspectorBot) with significant enhancements.**
