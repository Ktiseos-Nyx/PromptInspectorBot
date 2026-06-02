# Privacy Policy for PromptInspectorBot-Enhanced

**Last Updated:** June 2, 2026

## TL;DR (The Actually Useful Version)

- ✅ We process images to extract AI metadata, then delete the image
- ❌ We don't store your images, your prompts, or the extracted metadata
- ❌ We don't track you, build profiles, or sell your data
- ✅ We DO keep some operational data so the bot can do its job: each server's
  settings, and a moderation/safety record (the anti-scam **ban registry**) — full
  details below
- ⚠️ The bot performs **automated anti-spam / anti-scam moderation**, which can
  **delete messages and ban users**, and shares its ban registry across every server
  the same bot instance runs in

## What This Bot Does

PromptInspectorBot-Enhanced is a Discord bot that reads metadata from AI-generated images. Think of it like reading the EXIF data from a photo, but for AI art.

**When you post an image with AI metadata in a monitored channel:**
1. The bot reads the image file
2. The bot extracts metadata (prompts, settings, model info)
3. The bot shows you the results (via clickable emoji reactions or slash commands)
4. The bot immediately deletes the temporary image file — it is **not** stored

**The bot also performs automated moderation (anti-spam / anti-scam).** In a monitored
server it may inspect message senders, content, and attachments for known scam/spam
patterns, and can **automatically delete messages or ban users**. To recognise repeat
offenders it keeps a moderation record — see "What We Store" below. Server admins
control whether this is on and how it's configured via `/settings`.

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

### Discord IDs (Mostly Transient)
- **What:** Your Discord user ID, channel IDs, role IDs
- **Why:** To know who to respond to, which channels to monitor, and to run moderation
- **How long:** Usually only while processing a message
- **Storage:** Not stored — *except* where an ID is part of the persistent data described
  in "What We Store" below (e.g. a banned user's ID, or the trusted-role / channel IDs an
  admin saves in server settings)

### Logs (If Enabled)
- **What:** Basic operational logs (errors, command usage)
- **Why:** Debugging and making sure the bot works
- **What's logged:** Timestamps, general events like "parsed image," error messages
- **What's NOT logged:** Your prompts, your images, your personal info
- **Retention:** Depends on host setup, typically rotated/deleted regularly

## What We Store (The Stuff We DO Keep)

We don't keep your images, prompts, or extracted metadata. But the bot is also a
moderation tool and a per-server configurable bot, and those jobs require remembering a
few things. This data lives in plain JSON files on the bot host — there is no cloud
database.

### Moderation & Safety Record — the "ban registry"
When automated moderation acts (or a moderator uses the `/banregistry` command), the bot
stores:
- **Banned users:** the user's Discord ID, the reason, a timestamp, the server it
  happened in, and — for manual actions — the acting moderator's ID
- **Scam-message fingerprints:** a one-way hash of a flagged message plus a short sample
  (first ~100 characters) of it, so identical scam blasts are caught again
- **Word filters:** patterns an admin chooses to warn/delete/ban on, plus who added them
- **Why:** to recognise repeat offenders and known scam campaigns and protect servers
- **Cross-server:** this registry is shared across every server the same bot instance runs
  in — a user banned for scamming in one server is flagged on sight in the others
- **Retention:** kept until a moderator removes the entry (`/banregistry`) or the bot
  operator resets the registry

### Server Settings
- **What:** each server's feature toggles, and the moderation routing an admin sets via
  `/settings` — the alert channel, monitored channels, trusted roles, and any trusted
  user IDs
- **Why:** so the bot remembers how each server wants it configured
- **Retention:** until changed, or until the bot is removed from the server

### Reminders / Question-of-the-Day (only if used)
- **What:** if you ask the bot to remind you of something, it stores your user ID and the
  reminder text until it's delivered
- **Retention:** until delivered or removed

## What Data We DON'T Collect

- ❌ Your prompts or AI responses (used to answer you, not stored by us)
- ❌ Your images (deleted immediately after metadata extraction)
- ❌ The content of your everyday messages — *except* that automated moderation inspects
  messages for scam/spam patterns and may store a short sample of a **flagged** message
  in the ban registry (see "What We Store")
- ❌ Your IP address
- ❌ Tracking cookies (it's a Discord bot, not a website)
- ❌ Analytics/telemetry
- ❌ Usage statistics tied to your identity

## How We Use Your Data

We use data only to run the features you (and your server) use: showing AI metadata,
performing the moderation a server has enabled, and answering optional AI commands.

We do NOT:
- Sell your data
- Share your data with third parties for marketing
- Use your data for advertising
- Use your data for analytics or profiling
- Use your content to train our own AI models

We DO, only as needed to provide a feature:
- Send content to AI providers **when a server has enabled an AI command and you use it**
  (see "AI Features" below) — those providers process it under their own terms
- Keep a moderation record across servers the bot runs in **when moderation is enabled**
  (see "What We Store")

## Third-Party Services

### Dataset-Tools Metadata Engine
The bot uses the Dataset-Tools metadata engine to parse images. This runs **locally** (on
the bot host), not in the cloud. Metadata *parsing* does not send your images anywhere.
(The optional AI features below are the exception — if a server enables them, content is
sent to an AI provider.)

### AI Features (Optional — Not Forced on Any Server)
Some commands (`/describe`, `/ask`, `/coder`, `/techsupport`, prompt help) use large
language models. **These features are opt-in per server**, and several are **off by
default** — a server can run the bot for moderation and metadata only, with no AI at all,
in which case nothing is sent to any AI provider. When a server *has* enabled an AI
feature and you use it:
- The relevant content (for `/describe`, the image; for the others, your text prompt) is
  sent to a third-party AI provider — **Google Gemini**, **Anthropic Claude**, and/or
  **Groq**, depending on how the operator configured the bot — to generate a response
- That content is processed under the provider's own terms:
  - Google Gemini: https://ai.google.dev/gemini-api/terms
  - Anthropic Claude: https://www.anthropic.com/legal/privacy
  - Groq: https://groq.com/privacy-policy/
- We don't store the prompts or responses ourselves beyond delivering the result to you

### CivitAI API (Optional)
If configured, the bot may query CivitAI's public API to fetch additional information about models/LoRAs mentioned in metadata. This is:
- **Optional** (depends on bot configuration)
- **Read-only** (just fetching public model info)
- **Not sending your images** (only model IDs from metadata)
- **Subject to CivitAI's privacy policy** (https://civitai.com/privacy)

### Discord
Obviously, this is a Discord bot. Discord's privacy policy applies to all Discord interactions:
https://discord.com/privacy

### PluralKit (Partial / In Progress)
The bot has support for [PluralKit](https://pluralkit.me) — a service used by plural
systems that re-sends ("proxies") messages through Discord webhooks. Recognition of
PluralKit-proxied messages is a work in progress for some commands following the move to
Node. The bot uses this only to correctly attribute proxied messages; it does not store
PluralKit system or member data. For how PluralKit itself handles your information, please
review their site: https://pluralkit.me

## Your Rights

We store very little about you, but here's how to manage it:

- ✅ **Right to know:** You can see exactly what metadata we extracted (we show it to you!)
- ✅ **Right to delete:** Images/metadata are deleted automatically. A moderation record
  (e.g. a ban-registry entry) can be removed by a server admin (`/banregistry`) or the
  bot operator on request
- ✅ **Right to opt-out:** Don't use the bot in monitored channels, block the bot, or ask server admins to remove it
- ✅ **Right to ask questions:** Contact us (see below)

## Data Security

- 🔒 Images are processed in temporary directories and deleted right after
- 🔒 Persistent data (ban registry, server settings, reminders) is stored in plain JSON
  files on the bot host, protected by the host's filesystem permissions — there is no
  separate cloud database
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
- **Legal basis:** Legitimate interest — providing the service you requested, and
  protecting servers from spam/scam abuse (the basis for the moderation record)
- **Data retention:** Images and metadata, seconds. Moderation records and server
  settings are kept until removed by a moderator/admin or the operator (see "What We
  Store")
- **Right to erasure:** Image/metadata erasure is automatic. To remove a moderation
  record, contact a server admin (they can use `/banregistry`) or the bot operator
- **Data portability:** We'll send you the metadata we extract; we don't hold other
  personal data to port

## Contact

Questions? Concerns? Found a privacy issue?

- **GitHub Issues:** https://github.com/Ktiseos-Nyx/PromptInspectorBot/issues
- **Project Maintainer:** See GitHub repository

**Prefer Discord support?**
- **AI-free space** (if you'd rather not be around AI discussion) — Earth and Dusk:
  https://discord.gg/5t2kYxt7An
- **AI-friendly space** — Ktiseos Nyx AI&ML:
  https://discord.gg/HhBSvM9gBY

## The Legal Stuff (Actually Readable Version)

**Your images, prompts, and metadata are not stored** — we process them, show you the
result, and delete them. The data we *do* keep is operational: a moderation/safety record
(the ban registry) and each server's settings, described above.

**We're not doing anything sketchy.** This is a utility + moderation bot for AI artists
and the servers that host them. We extract metadata, optionally answer AI commands, and
keep servers safe from scam spam.

**If you don't trust us:** The code is open source. Read it. Verify it. Self-host it.

**If something seems wrong:** Tell us. We'll fix it.

---

**Remember:** The best privacy policy is keeping as little as possible — so we keep only
what the bot genuinely needs to work. 💜

*This privacy policy was written by humans (and Claude), for humans. If you need a lawyer-approved version for commercial use, consult an actual lawyer.*
