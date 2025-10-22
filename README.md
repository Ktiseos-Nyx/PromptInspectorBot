# Prompt Inspector 🔎

Inspect prompts 🔎 from images uploaded to Discord. This is a fork of the original [PromptInspectorBot](https://github.com/sALTaccount/PromptInspectorBot), enhanced with more powerful features and a streamlined setup.

## What it does

This Discord bot automatically detects and displays AI image generation metadata from various sources. It can read metadata from PNG files and, with the new **Describe** feature, can even generate descriptions for JPEGs and other images that have had their metadata stripped by Discord.

## Features

*   **Comprehensive Metadata Parsing:** Powered by an enhanced version of the Dataset-Tools metadata engine, the bot supports over 200 ComfyUI node types, including FLUX, PixArt, and more.
*   **Multiple Interaction Styles:** Use emoji reactions (🔎), slash commands (`/metadata`), or right-click context menus ("View Prompt") to inspect images.
*   **PluralKit Support:** Automatically resolves proxied messages to the real user, ensuring a seamless experience for users of PluralKit.
*   **Manual Metadata Entry:** For images like JPEGs or screenshots, you can manually add the prompt and other details.
*   **Lightweight and Server-Friendly:** The bot runs the metadata parser in a separate process, keeping its memory usage low and making it suitable for free-tier hosting services.

### Experimental Features

*   **✨ Describe Feature:** Uses the Gemini API to generate descriptions for images without metadata. You can choose between Danbooru-style tags or a natural language description.
*   **🗣️ Ask/Discuss Feature:** A conversational AI feature that allows you to have a guided conversation with the Gemini API.
*   **🎨 Dream/Imagine/Generate Feature:** An image generation feature that uses different style prompts to guide the Gemini API in creating images.

## How to use

1.  **Post an image** in a monitored channel.
2.  **React with 🔎:** If the bot finds metadata, it will add a 🔎 reaction. Click it to see the metadata.
3.  **Use Slash Commands:**
    *   `/metadata <image>`: Get a private metadata report for an image.
    *   `/ask <question>`: Ask a question to the conversational AI.
    *   `/dream <prompt> <style>`: Generate an image with a specific style.
4.  **Use the Context Menu:** Right-click on a message with an image and select "View Prompt".
5.  **Describe an Image:** After getting a metadata report, click the "Describe" button to generate a description using the Gemini API.

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
*   **Gemini API Key:** To use the experimental "Describe", "Ask", and "Dream" features, you'll need a Gemini API key. You can get one for free from the [Google AI Studio](https://aistudio.google.com/app/apikey).

## Permissions

For the bot to function correctly, it needs the following permissions in your Discord server:

*   **Read Messages/View Channel:** To see messages and images in channels.
*   **Send Messages:** To send metadata replies.
*   **Read Message History:** To fetch the original message when a reaction is added.
*   **Add Reactions:** To add the 🔎 and ⛔ reactions to messages.
*   **Use External Emojis:** If you are using custom emojis for the reactions.
*   **Attach Files:** To send metadata as a file if it's too long.

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
