# Privacy Policy for PromptInspectorBot-Enhanced

**Last Updated:** October 21, 2025

## TL;DR (The Actually Useful Version)

- ✅ We process images to extract AI metadata
- ✅ We send you DMs with the metadata
- ❌ We don't store your images
- ❌ We don't store your metadata
- ❌ We don't track you
- ❌ We don't sell your data (we don't even HAVE your data)

## What This Bot Does

PromptInspectorBot-Enhanced is a Discord bot that reads metadata from AI-generated images. Think of it like reading the EXIF data from a photo, but for AI art.

**When you interact with the bot:**
1. You post an image with AI metadata in a monitored channel
2. The bot reads the image file
3. The bot extracts metadata (prompts, settings, model info)
4. The bot sends you a DM with the results
5. The bot immediately deletes the temporary image file

That's it. That's the whole thing.

## What Data We Collect

### Image Data (Temporary)
- **What:** Images you post in monitored Discord channels
- **Why:** To extract AI generation metadata
- **How long:** Seconds. Literally. We save it to `/tmp/`, extract metadata, then delete it immediately
- **Storage location:** Your server's temporary directory (if self-hosting) or the bot host's `/tmp/` folder
- **Retention:** Deleted as soon as metadata extraction completes (or fails)

### Metadata Extracted
- **What:** AI generation parameters (prompts, model names, settings, etc.)
- **Why:** To show you what settings were used to create the image
- **How long:** Only long enough to send you the DM
- **Storage:** Not stored. We extract, format, send, and forget

### Discord IDs
- **What:** Your Discord user ID, channel IDs
- **Why:** To know who to send DMs to and which channels to monitor
- **How long:** Only while processing your request
- **Storage:** Not stored in any database

### Logs (If Enabled)
- **What:** Basic operational logs (errors, command usage)
- **Why:** Debugging and making sure the bot works
- **What's logged:** Timestamps, general events like "parsed image," error messages
- **What's NOT logged:** Your prompts, your images, your personal info
- **Retention:** Depends on host setup, typically rotated/deleted regularly

## What Data We DON'T Collect

- ❌ Your prompts (we read them to send to you, but don't store them)
- ❌ Your images (deleted immediately after processing)
- ❌ Your Discord messages (we only read metadata from images)
- ❌ Your IP address
- ❌ Tracking cookies (it's a Discord bot, not a website)
- ❌ Analytics/telemetry
- ❌ Usage statistics tied to your identity

## How We Use Your Data

We use the data for exactly one thing: **Showing you the AI metadata from your images.**

We do NOT:
- Sell your data (we don't have any to sell)
- Share your data with third parties
- Use your data for training AI models
- Use your data for advertising
- Use your data for analytics
- Keep your data after we're done with it

## Third-Party Services

### Dataset-Tools Metadata Engine
The bot uses the Dataset-Tools metadata engine to parse images. This runs **locally** (on the bot host), not in the cloud. Your images are not sent to any external service.

### CivitAI API (Optional)
If configured, the bot may query CivitAI's public API to fetch additional information about models/LoRAs mentioned in metadata. This is:
- **Optional** (depends on bot configuration)
- **Read-only** (just fetching public model info)
- **Not sending your images** (only model IDs from metadata)
- **Subject to CivitAI's privacy policy** (https://civitai.com/privacy)

### Discord
Obviously, this is a Discord bot. Discord's privacy policy applies to all Discord interactions:
https://discord.com/privacy

## Your Rights

Because we don't store your data, there's not much to manage, but:

- ✅ **Right to know:** You can see exactly what metadata we extracted (we send it to you!)
- ✅ **Right to delete:** Your data is already deleted automatically
- ✅ **Right to opt-out:** Don't use the bot in monitored channels, block the bot, or ask server admins to remove it
- ✅ **Right to ask questions:** Contact us (see below)

## Data Security

- 🔒 Images are processed in temporary directories with restrictive permissions
- 🔒 No database = no database to breach
- 🔒 Bot token and API keys stored securely (not in code)
- 🔒 Open source = you can verify everything we're saying

## Self-Hosting

If you self-host this bot:
- **You** are responsible for data handling on your server
- **You** should review this privacy policy and modify if needed
- **You** control what gets logged and where
- **You** should ensure your hosting complies with applicable laws

## Children's Privacy

This bot is not directed at children under 13. We don't knowingly collect data from children. If you're under 13, you shouldn't be on Discord anyway (per Discord's ToS).

## Changes to This Policy

If we update this policy, we'll:
- Update the "Last Updated" date
- Post changes in the GitHub repository
- Notify users through Discord (if we have a way to reach you)

## International Users

This bot may be hosted anywhere. If you're in the EU, GDPR applies. Good news: we already don't store your data, so we're pretty compliant by default.

**GDPR-specific notes:**
- **Legal basis:** Legitimate interest (providing the service you requested)
- **Data retention:** Seconds (see above)
- **Right to erasure:** Already automatic
- **Data portability:** We'll send you your metadata (it's in the DM we already sent you!)

## Contact

Questions? Concerns? Found a privacy issue?

- **GitHub Issues:** https://github.com/Ktiseos-Nyx/PromptInspectorBot/issues
- **Project Maintainer:** See GitHub repository

## The Legal Stuff (Actually Readable Version)

**Your data is not stored.** We process it, send it to you, and delete it. That's the entire data lifecycle.

**We're not doing anything sketchy.** This is a utility bot for AI artists. We extract metadata. That's it.

**If you don't trust us:** The code is open source. Read it. Verify it. Self-host it.

**If something seems wrong:** Tell us. We'll fix it.

---

**Remember:** The best privacy policy is not having your data in the first place. 💜

*This privacy policy was written by humans (and Claude), for humans. If you need a lawyer-approved version for commercial use, consult an actual lawyer.*
