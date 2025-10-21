Forked from https://github.com/sALTaccount/PromptInspectorBot → https://github.com/dogarrowtype/PromptInspectorBot

# Prompt Inspector 🔎
Inspect prompts 🔎 from images uploaded to discord

## Two Versions Available

### **`PromptInspector.py`** - Original (Stable)
The original bot with ComfyUI and NovelAI support from dogarrowtype's fork.
- ✅ Proven stable
- ✅ ~20 ComfyUI node types supported
- ✅ A1111, ComfyUI, NovelAI formats

### **`bot_enhanced.py`** - Enhanced with Dataset-Tools (Official Integration)
Enhanced version with Dataset-Tools metadata engine (included as git submodule on `bot-features` branch).
- 🚀 200+ ComfyUI node types (FLUX, PixArt, TIPO, etc.)
- 🚀 Advanced graph traversal for complex workflows
- 🚀 Template detection and randomizer specialist
- 🚀 CivitAI API integration for resource metadata
- ⚡ Slash commands (`/metadata`) in addition to emoji reactions
- 📋 Context menus (right-click → "View Prompt")
- 💾 Lightweight architecture (<100MB RAM via subprocess CLI)
- 🌈 **PluralKit support** - Automatically resolves webhook messages to real users
- 📝 **Manual metadata entry** - Add details to images without embedded metadata (JPEGs, screenshots, etc.)

## Functionality

This Discord bot automatically detects and displays AI image generation metadata from various sources.

**How it works:**
1. Bot scans images posted in monitored channels
2. If metadata is found → Adds 🔎 reaction
3. Click the reaction → Bot posts public reply with collapsible metadata
4. If no metadata → Offers manual entry option for JPEG/screenshot sharing

**Supported interaction styles:**
- 🔎 **Emoji reactions** - Click magnifying glass for public metadata display
- ⚡ **Slash commands** - `/metadata <image>` for direct parsing (enhanced version only)
- 📋 **Context menus** - Right-click message → "View Prompt" (both versions)
- 📝 **Manual entry** - Add details manually for images without embedded metadata (enhanced version only)

**Supported image formats:**
- ✅ **PNG** - Full metadata support (ComfyUI, A1111, NovelAI, InvokeAI, etc.)
- ⚠️ **JPEG** - Discord strips EXIF metadata on upload, but manual entry available
- 💡 **Tip:** For CivitAI images, use manual entry to add prompt/model info from the image page

**PluralKit Integration:**
The enhanced bot automatically detects PluralKit proxied messages and resolves them to the real sender. Metadata displays and DMs are sent to the actual user, not the proxy webhook. Perfect for systems who want to share their AI art! 🌈

## Setup

### For Original Version (`PromptInspector.py`)

1. Clone the repository
2. Enter the directory
3. Create a venv with `python3 -m venv ./venv`
4. Activate venv: `source venv/bin/activate` (Linux/Mac) or `venv\Scripts\activate` (Windows)
5. Install the dependencies with `pip3 install -r requirements.txt`
6. Create a Discord bot and invite it to your server
7. Enable the `Message Content Intent` in the Discord developer portal
8. Enable the `Server Members Intent` in the Discord developer portal
9. Create a file named ".env" in the root directory of the project
10. Set `BOT_TOKEN=<your discord bot token>` in the .env file
11. Copy the `config.example.toml` to `config.toml`
12. Add the channel IDs for channels you want the bot to watch, and set the settings you want in the `config.toml` file
13. Run the bot with `python3 PromptInspector.py`

### For Enhanced Version (`bot_enhanced.py`)

Follow steps 1-12 above, then:

13. Initialize and install Dataset-Tools submodule:
    ```bash
    # Initialize the submodule (bot-features branch)
    git submodule update --init --recursive

    # Install Dataset-Tools in editable mode
    pip install -e ./dataset-tools
    ```

14. **(Optional)** Configure CivitAI API key for enhanced resource metadata:
    ```bash
    # Option 1: Create secrets.json file
    cp dataset-tools/dataset_tools/secrets.json.example dataset-tools/dataset_tools/secrets.json
    # Edit secrets.json and add your CivitAI API key

    # Option 2: Use environment variable
    export CIVITAI_API_KEY="your_api_key_here"
    ```

    **Note:** CivitAI API key is optional but recommended for enhanced metadata extraction. Get your free API key at [CivitAI Settings](https://civitai.com/user/account).

15. Run the enhanced bot with `python3 bot_enhanced.py`

**Architecture Note:** The bot uses the `dataset-tools-parse` CLI command via subprocess to keep memory usage low (<100MB vs 200-300MB with direct imports). This makes it suitable for free-tier hosting!

**Security Note:** Never commit your `secrets.json` file to git! It's already included in `.gitignore` to prevent accidental commits.

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
