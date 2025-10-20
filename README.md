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

## Functionality

This Discord bot reacts to any image with generation metadata from Automatic1111's WebUI and ComfyUI.
If generation metadata is detected, a magnifying glass react is added to the image. If the user
clicks the magnifying glass, they are sent a DM with the image generation information.

**Supported interaction styles:**
- 🔎 **Emoji reactions** - Click magnifying glass for DM (both versions)
- ⚡ **Slash commands** - `/metadata <image>` for direct parsing (enhanced version only)
- 📋 **Context menus** - Right-click message → "View Prompt" (both versions)

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

## Examples
![Example 1](images/2023-03-09_00-14.png)
![Example 2](images/2023-03-09_00-14_1.png)
