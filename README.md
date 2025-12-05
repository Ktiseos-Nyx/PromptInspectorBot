# Prompt Inspector 🔎

Inspect prompts 🔎 from images uploaded to Discord. This is a fork of the original [PromptInspectorBot](https://github.com/sALTaccount/PromptInspectorBot), enhanced with more powerful features and a streamlined setup.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/OCA5uC?referralCode=EQxw4P&utm_medium=integration&utm_source=template&utm_campaign=generic)

## What it does

This Discord bot automatically detects and displays AI image generation metadata from various sources. It can read metadata from PNG files and, with the new **Describe** feature, can even generate descriptions for JPEGs and other images that have had their metadata stripped by Discord.

## Features

*   **Comprehensive Metadata Parsing:** Powered by an enhanced version of the Dataset-Tools metadata engine, the bot supports over 200 ComfyUI node types, including FLUX, PixArt, and more.
*   **Multiple Interaction Styles:** Use emoji reactions (🔎), slash commands (`/metadata`), or right-click context menus ("View Prompt") to inspect images.
*   **PluralKit Support:** Automatically resolves proxied messages to the real user, ensuring a seamless experience for users of PluralKit.
*   **Manual Metadata Entry:** For images like JPEGs or screenshots, you can manually add the prompt and other details.
*   **Lightweight and Server-Friendly:** The bot runs the metadata parser in a separate process, keeping its memory usage low and making it suitable for free-tier hosting services.

### AI Features (Powered by Gemini)

*   **✨ Describe Feature (`/describe`):** Generate AI descriptions for any image. Choose between Danbooru-style tags or natural language descriptions.
*   **🗣️ Conversational AI (`/ask`):** Have contextual conversations with Gemini. The bot remembers your conversation history per user, making it perfect for follow-up questions and multi-turn discussions.

## How to use

### Metadata Inspection

1.  **Post an image** in a monitored channel.
2.  **React with 🔎:** If the bot finds metadata, it will add a 🔎 reaction. Click it to see the metadata publicly.
3.  **Use Slash Commands:**
    *   `/metadata <image>`: Parse and display metadata from an uploaded image (public).
4.  **Use the Context Menu:** Right-click on a message with an image and select "View Prompt".

### AI Features (Requires Gemini API Key)

*   `/ask <question>`: Have a conversation with AI. The bot remembers context within your conversation!
*   `/describe <image> <style>`: Generate AI descriptions for images. Choose "Danbooru Tags" or "Natural Language" style.
    *   Also available as a "Describe" button on metadata views for convenience.

## Setup

You can run the bot locally or deploy it to a hosting service like Railway.

### Local Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-repo/PromptInspectorBot.git
    cd PromptInspectorBot
    ```
2.  **Create a virtual environment:**
    ```bash
    python3 -m venv venv
    source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
    ```
3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
4.  **Create a Discord Bot:**
    *   Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
    *   Go to the "Bot" tab and add a bot.
    *   Enable the `Message Content Intent` and `Server Members Intent`.
5.  **Configure the bot:** See the **Configuration** section below.
6.  **Run the bot:**
    ```bash
    python3 bot_enhanced.py
    ```

### Deployment with Docker (Recommended)

Using Docker is the recommended way to deploy the bot, as it ensures the environment is consistent and handles all dependencies automatically.

1.  **Build the Docker image:**
    ```bash
    docker build -t prompt-inspector-bot .
    ```
2.  **Run the Docker container:**
    ```bash
    docker run -d --env-file .env prompt-inspector-bot
    ```

#### Deploying to Railway

Railway makes it easy to deploy the bot directly from your GitHub repository.

1.  **Fork this repository** to your own GitHub account.
2.  **Create a new project** on Railway and link it to your forked repository.
3.  **Add your secrets** as environment variables in the Railway project settings (see **Configuration** below).
4.  Railway will automatically build the `Dockerfile` and deploy the bot.

## Configuration

You'll need to configure the bot using environment variables. You can set these directly on your hosting service or create a `.env` file in the project root for local development.

**Important:** It is strongly recommended to use your hosting provider's secrets management system (usually called "Environment Variables" or "Secrets") to store your `BOT_TOKEN` and `GEMINI_API_KEY`. The `.env` file is for local development only and should **never** be committed to your repository.

*   `BOT_TOKEN`: Your Discord bot token. (Required)
*   `GEMINI_API_KEY`: Your Google AI Studio API key for the "Describe" feature. (Required for the describe feature)
*   `ALLOWED_GUILD_IDS`: A comma-separated list of server IDs where the bot is allowed to run. Leave empty to allow all servers.
*   `MONITORED_CHANNEL_IDS`: A comma-separated list of channel IDs where the bot should automatically scan for images. Leave empty to monitor all channels.
*   `CHANNEL_FEATURES`: A semicolon-separated list of channel-specific feature configurations. For example: `123456789012345678:metadata,describe;098765432109876543:ask,dream`

You can also customize the bot's behavior by copying `config.example.toml` to `config.toml` and editing the values.

### API Keys

*   **Civitai API Key:** While optional, a Civitai API key is recommended for fetching detailed metadata about models and LoRAs. You can get a free API key from your [Civitai User Account Settings](https://civitai.com/user/account).
*   **Gemini API Key:** For Google's Gemini AI (free tier available). Get one from [Google AI Studio](https://aistudio.google.com/app/apikey).
*   **Claude API Key:** For Anthropic's Claude AI (pay-as-you-go, $5 starter credit). Get one from [Anthropic Console](https://console.anthropic.com).

**Note:** You can use **either or both** AI providers! The bot will automatically detect which API keys you've set and use them based on your configured priority.

### AI Provider Configuration

The bot supports **multiple LLM providers** with automatic detection and fallback! You can use Gemini, Claude, or both. Configure via **environment variables** (recommended for Railway/cloud hosting) or **config.toml** (for local/advanced setups).

#### Environment Variables (Railway/Cloud Hosting)

```env
# ============ AI Provider Selection ============
# Set API keys for the providers you want to use
GEMINI_API_KEY=your_gemini_key_here
ANTHROPIC_API_KEY=your_claude_key_here

# Provider priority: tries first provider, falls back to next if it fails
# Options: "gemini", "claude"
LLM_PROVIDER_PRIORITY=claude,gemini

# ============ Gemini Configuration ============
GEMINI_PRIMARY_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODELS=gemini-flash-latest,gemini-2.5-pro,gemini-2.5-flash
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_DELAY=1.0

# ============ Claude Configuration ============
CLAUDE_PRIMARY_MODEL=claude-3-5-haiku-20241022

# ============ NSFW/Artistic Content Handling ============
# Skip Gemini's strict filters for artistic/suggestive content
# Set to "claude" to use only Claude for /describe
# NSFW_PROVIDER_OVERRIDE=claude
```

#### Config.toml (Advanced/Per-Server Customization)

For per-server or per-channel model customization, edit `config.toml`:

```toml
# ============ Provider Selection ============
# Which providers to use in order (only enabled if API key is set)
LLM_PROVIDER_PRIORITY = ["claude", "gemini"]

# ============ Gemini Configuration ============
GEMINI_PRIMARY_MODEL = "gemini-flash-latest"
GEMINI_FALLBACK_MODELS = [
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
]

# ============ Claude Configuration ============
CLAUDE_PRIMARY_MODEL = "claude-3-5-haiku-20241022"
CLAUDE_FALLBACK_MODELS = [
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307"
]

# ============ NSFW/Artistic Content ============
# Uncomment to bypass Gemini's strict filters
# NSFW_PROVIDER_OVERRIDE = "claude"
```

#### Gemini Model Recommendations

| Model | Speed | Quality | Sensitivity | Free Tier Limits | Best For |
|-------|-------|---------|-------------|------------------|----------|
| `gemini-flash-latest` | ⚡⚡⚡ | Good | Medium | 15/min, 1500/day | **Recommended** - Best balance |
| `gemini-2.5-pro` | ⚡ | Excellent | Low | 2/min, 50/day | Artistic content, complex tasks |
| `gemini-2.5-flash` | ⚡⚡⚡ | Good | **High** | 15/min, 1500/day | ⚠️ Overly strict filters |
| `gemini-2.5-flash-lite` | ⚡⚡⚡⚡ | Basic | **Very High** | 15/min, 1500/day | ⚠️ Very strict, not recommended |

**Note:** `gemini-2.5-flash` and `flash-lite` are **very sensitive** to artistic nudity and suggestive content, even in PG-13/anime contexts. Use `flash-latest` or `pro` if you encounter frequent content filtering.

#### Claude Model Recommendations & Pricing

| Model | Speed | Quality | Cost (Input/Output per 1M tokens) | Best For |
|-------|-------|---------|-----------------------------------|----------|
| `claude-3-5-haiku-20241022` | ⚡⚡⚡ | Good | $0.25 / $1.25 | **Recommended** - Best cost/performance for images! |
| `claude-3-5-sonnet-20241022` | ⚡⚡ | Excellent | $3 / $15 | Higher quality descriptions |
| `claude-opus-4-20250514` | ⚡ | Best | $15 / $75 | Maximum quality (not yet added) |
| `claude-3-haiku-20240307` | ⚡⚡⚡ | Good | $0.25 / $1.25 | Older Haiku (fallback) |

**Budget tip:** With the $5 starter credit, **Haiku 3.5 can process ~1,500+ image descriptions** (10x cheaper than Sonnet)! Haiku works great for image descriptions and handles artistic content much better than Gemini.

### Multi-Provider LLM System

The bot features a **smart provider fallback system** that automatically switches between AI providers if one fails:

**How it works:**
1. **Automatic Detection:** Bot detects which providers you have API keys for
2. **Priority-Based Selection:** Tries providers in your configured order (`LLM_PROVIDER_PRIORITY`)
3. **Graceful Fallback:** If one provider fails (rate limit, content filter, API error), automatically tries the next
4. **Cost Control:** Configure priority to use cheaper/free providers first

**Example configurations:**

```env
# Prioritize free tier (Gemini) with paid fallback (Claude)
LLM_PROVIDER_PRIORITY=gemini,claude

# Prioritize quality (Claude) with free fallback (Gemini)
LLM_PROVIDER_PRIORITY=claude,gemini

# Use only one provider
LLM_PROVIDER_PRIORITY=claude
# (Just don't set the other API key)
```

**Per-server customization:** Users can configure different providers for different Discord servers by editing `config.toml` directly. This allows server-specific cost optimization and quality preferences.

#### NSFW/Artistic Content Mode

If you're working with artistic content that triggers Gemini's overly strict safety filters (suggestive poses, artistic nudity, PG-13/R-rated content), you can enable **NSFW Provider Override** to skip Gemini entirely:

```env
# Environment variable
NSFW_PROVIDER_OVERRIDE=claude
```

```toml
# Or in config.toml
NSFW_PROVIDER_OVERRIDE = "claude"
```

**When to use this:**
- Artistic nudity (no explicit content, but suggestive)
- Open shirts, swimwear, lingerie
- Suggestive poses or angles
- Anime/manga art with cleavage or midriff
- Any content that's PG-13/R but not NC-17

**How it works:** When enabled, `/describe` will **only** use Claude and skip Gemini completely. Claude is much more lenient with artistic content while still blocking actual explicit material.

### Future LLM Support

The architecture is designed for easy extension to additional providers:

*   **Local LLM Support:** Planned support for Ollama, LM Studio, or similar frameworks
*   **OpenAI/GPT Support:** Could be added with minimal changes
*   **Mistral/Other APIs:** Extensible provider system makes adding new APIs straightforward

**For developers:** To add a new provider, implement a describe function similar to `describe_image_with_claude()` or `describe_image_with_gemini()` in `bot_enhanced.py`, then add it to the provider priority logic in `/describe` command. Pull requests welcome!

## Security System

The bot includes a comprehensive **anti-scam detection system** to protect your server from common attack patterns. This system automatically detects and bans scammers without manual intervention.

### What It Detects

The security system catches two main scammer types:

**1. Wallet Scammers**
- Crypto wallet spam with ALL CAPS messages
- Currency symbols in username (£, €, ¥, ₿)
- Hoisting characters (!, =, #) to appear at top of member list
- Keywords: "WALLET", "SOL", "DEAD TOKENS", "PAY HIM", etc.

Example:
> Username: `=££BOSHGO`
> Message: "ANYONE WHO CAN GET ME A WALLLET THAT HAVE PLENTY TRANSACTIONS I WILL PAY HIM 3SOL..."

**2. Screenshot Spammers**
- 4+ crypto screenshot images
- Cross-posting same message in multiple channels
- Gibberish text or empty messages
- No profile picture, no roles

### How It Works

The system uses a **behavior-based scam score** with automatic actions:

| Score | Action | Description |
|-------|--------|-------------|
| 100+ | **Instant Ban** | High confidence scam - user banned, all messages deleted (last 5 min) |
| 75-99 | **Delete + Alert** | Medium confidence - message deleted, admins notified |
| 50-74 | **Watchlist** | Low confidence - logged for monitoring |

**Why behavior-based?**
- Real scammers can have profile pics and accounts that are years old
- The system focuses on **what they do**, not what they look like:
  - ✅ Cross-posting same content in 5+ channels
  - ✅ Crypto keyword spam patterns
  - ✅ Gibberish text or empty messages
  - ✅ Role exploitation (CATCHER-only)

**Detection Methods:**
- ✅ **Magic Bytes Check:** Prevents malware disguised as images (.exe as .jpg) - checks attachments AND embeds
- ✅ **Cross-Posting Detection:** Same message in 2+ channels = instant ban
- ✅ **Gibberish Detection:** Context-aware (allows "AAAA" from users with roles, allows images without text)
- ✅ **Keyword Scanning:** Crypto scam patterns with weighted scores
- ✅ **Role Tracking:** CATCHER role exploitation, no roles at all
- ✅ **Username Analysis:** Hoisting characters (=, !, #), currency symbols (£, €, ₿), auto-generated names (word.word1234_5678)
- ✅ **Profile Analysis:** No profile picture adds to scam score (but not sole factor)

### Automatic Bypass

The security system **only** bypasses checks for:
- ✅ **Server owners** (you literally own the server)
- ✅ **Trusted users** (manually configured in TRUSTED_USER_IDS)

**Everyone else gets checked** - doesn't matter if they have a profile pic or if their account is years old. The system focuses on **behavior**, not appearance.

### Configuration

Set these in `config.toml` or as environment variables:

```toml
# CATCHER role ID (self-assignable color role that scammers exploit)
CATCHER_ROLE_ID = 1336289642789470228

# Trusted user IDs who bypass all security checks (mods, bots, etc.)
# NOTE: You probably don't need to add yourself if you're the server owner or have a 1+ year account!
TRUSTED_USER_IDS = [123456789, 987654321]

# Admin alert channel ID for ban notifications
ADMIN_CHANNEL_ID = 1234567890
```

Or as environment variables:
```env
CATCHER_ROLE_ID=1336289642789470228
TRUSTED_USER_IDS=123456789,987654321
ADMIN_CHANNEL_ID=1234567890
```

**How to get IDs:**
1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click user/role/channel → Copy ID

### Required Permissions

For the security system to work, the bot needs:
- **Ban Members:** To ban detected scammers
- **Manage Messages:** To delete spam messages
- **Read Message History:** To clean up all messages from banned users

**Note:** The security system is completely optional. If you don't configure it, the bot will still work normally for metadata inspection without any security features.

## R2 Upload Feature (Optional)

The bot can use Cloudflare R2 to handle JPEG/WebP uploads, allowing metadata extraction from formats that Discord normally strips.

### Features
- 📤 **Direct Upload** - Upload JPEG/WebP files without Discord stripping metadata
- 🔒 **Rate Limited** - 5 uploads per user per day (prevents abuse)
- 🗑️ **Auto-Delete** - Files automatically deleted after 30 days
- 📏 **Size Limited** - 10MB maximum file size
- ⚠️ **Security Warnings** - Clear notices that uploads are not 100% secure

### Configuration

Set these environment variables to enable R2 uploads:

```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
UPLOADER_URL=https://your-pages-url.pages.dev/uploader.html
```

### Cloudflare R2 Setup

1. **Create R2 Bucket** in Cloudflare dashboard
2. **Create API Token** with R2 read/write permissions
3. **Set Lifecycle Rule** for 30-day auto-deletion:
   - Prefix: `uploads/`
   - Action: Delete object
   - Days: 30
4. **Deploy uploader.html** to Cloudflare Pages

### Security & Privacy

The upload system includes multiple safeguards:
- ✅ Rate limiting (5 uploads/day per user)
- ✅ File size validation (10MB max)
- ✅ File type validation (JPEG/WebP only)
- ✅ Presigned URL expiry (1 hour)
- ✅ 30-day auto-deletion
- ⚠️ Users warned: "Not 100% secure - only upload images you're comfortable sharing"

**Note:** This feature is completely optional. If R2 is not configured, the bot works normally without it.

## Permissions

For the bot to function correctly, it needs the following permissions in your Discord server:

### Core Permissions (Required)
*   **Read Messages/View Channel:** To see messages and images in channels.
*   **Send Messages:** To send metadata replies.
*   **Read Message History:** To fetch the original message when a reaction is added.
*   **Add Reactions:** To add the 🔎 and ⛔ reactions to messages.
*   **Use External Emojis:** If you are using custom emojis for the reactions.
*   **Attach Files:** To send metadata as a file if it's too long.

### Security Permissions (Optional - Only needed if using the Security System)
*   **Ban Members:** To ban detected scammers automatically.
*   **Manage Messages:** To delete spam messages and clean up banned users' messages.

## Troubleshooting

*   **Bot is not responding:**
    *   Check if the bot is online in your server.
    *   Make sure the bot has the necessary permissions in the channel (see **Permissions** section).
    *   Check the bot's logs for any error messages.
*   **"Describe" feature is not working:**
    *   Ensure you have a valid `GEMINI_API_KEY` in your `.env` file or environment variables.
    *   Check the bot's logs for any API errors from Google.
*   **Images are not being processed:**
    *   Make sure the image is a `.png`, `.jpg`, or `.jpeg` file.
    *   Check if the image size is within the `SCAN_LIMIT_BYTES` limit defined in your `config.toml`.
    *   Ensure the channel is in the `MONITORED_CHANNEL_IDS` list in your `config.toml` (if you are using the emoji reaction feature).

## For Developers (Forking)

This project is a fork of the original [PromptInspectorBot](https://github.com/sALTaccount/PromptInspectorBot) and has been significantly enhanced. If you'd like to contribute or create your own version, feel free to fork this repository. The original forking information is preserved in the commit history.

## Legal Stuff (The Important Bits)

Before using the bot, please review:
- **[Privacy Policy](PRIVACY.md)** - How we handle your data (spoiler: we don't store it)
- **[Terms of Service](TERMS_OF_SERVICE.md)** - The rules (TL;DR: don't be a jerk)

**Quick summary:**
- ✅ We extract metadata and send it to you
- ✅ We delete images immediately after processing
- ❌ We don't store your images or metadata
- ❌ We don't track you or sell your data

## Examples

![Example 1](images/2023-03-09_00-14.png)
![Example 2](images/2023-03-09_00-14_1.png)
