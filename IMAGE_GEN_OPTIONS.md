# Image Generation Options for Discord Bot

This document compares different approaches for adding AI image generation (`/dream` command) to the bot.

## Quick Summary

**TL;DR**: This feature is **SHELVED** until funding exists. Adding image gen = $5-50/month cost increase (100%+ over current $0 bot hosting). Not worth it unless users pay or donate.

**If you DO implement it someday**: Vast.ai for BIG PP SETTINGS™ or Runware for corporate normie quality.

---

## 🚨 REALITY CHECK: Why This Feature Is Shelved 🚨

### The Economics Problem
- **Current bot cost**: $0/month (Railway free tier)
- **With image gen**: $5-50/month depending on usage
- **That's a 100% cost increase for ONE feature**
- **Exchange rate pain**: $5 USD = ~$10 NZD (ouch)

### Why It's (Probably) Not Worth It
- ❌ Users already have free image gen elsewhere:
  - Civitai's onsite generator (free)
  - Bing Image Creator (free DALL-E)
  - Local ComfyUI/A1111 (if they're SD users)
- ❌ Your bot's **unique value** is metadata parsing, not generation
- ❌ Image generation is a **commodity** - everyone does it
- ❌ Your metadata parsing is **special** - nobody does it as well

### When to Revisit This
Only add image gen when:
- [ ] Community **heavily requests** it (not just "would be nice")
- [ ] **Funding model exists**: Patreon, Ko-fi, server boosts, premium Discord roles
- [ ] Users are willing to **pay per image** or donate monthly
- [ ] Bot has grown enough to justify the operational cost
- [ ] You're making BIG PP money and don't care about costs 💰

### Alternative: Civitai API Image Generation? ⚡

**YES, IT EXISTS!** Civitai has a Python SDK for image generation: https://developer.civitai.com/docs/api/python-sdk

**Civitai "Buzz" System**:
- Civitai uses "Buzz" ⚡ as currency (not credits lol)
- **SD 1.5**: 1-2 Buzz per image
- **SDXL**: 4-6 Buzz per image
- **Draft Mode** (SDXL Lightning/LCM): Half price for quick testing

**How to Get Buzz**:
- Free: 100 Buzz when you sign up
- Free: Daily Buzz for logging in and using generator
- Free: Earn Buzz by posting content, reacting to images, getting likes
- **$5/month Supporter**: 5,000 Buzz/month
- **$10/month Premium** (rumored): Unlimited generations?

**Cost Breakdown**:
- 5,000 Buzz = $5/month
- SDXL at 5 Buzz/image = **1,000 images for $5** = **$0.005/image**
- That's competitive with Vast.ai! 🤯

**Pros**:
- ✅ **Full Civitai model catalog** (thousands of models, LoRAs, etc.)
- ✅ **Competitive pricing** ($0.005/image)
- ✅ **Python SDK** (easy integration)
- ✅ **LoRA, VAE, ControlNet support**
- ✅ **No infrastructure management**
- ✅ **Same platform you already use for metadata**
- ✅ **Can earn free Buzz** by being active in community

**Cons**:
- ❌ **Buzz system complexity** (not straightforward pricing)
- ❌ **Need to manage Buzz balance** (could run out mid-generation)
- ❌ **Additional resources cost more** (large LoRAs >10MB add cost)
- ❌ **Unknown quality/settings control** (need to test)
- ❌ **API rate limits** (unknown)

**Code Example**:
```python
import civitai

input = {
    "model": "urn:air:sd1:checkpoint:civitai:4201@130072",  # Any Civitai model!
    "params": {
        "prompt": "a flowering derpy hooves, cute, detailed",
        "negativePrompt": "scat, gross, ugly",
        "width": 1024,
        "height": 1024,
        "steps": 20,  # Can we control this? Need to test
        "cfgScale": 7.5
    },
    "additionalNetworks": {
        "urn:air:sd1:lora:civitai:162141@182559": {  # Add LoRAs!
            "type": "Lora",
            "strength": 0.8
        }
    }
}
response = civitai.image.create(input)
```

**This Could Be THE Option**:
- Same cost as Vast.ai (~$0.005/image)
- BUT no infrastructure management
- AND full Civitai model catalog
- AND you can earn free Buzz by being active

**TODO**:
- [ ] Test Civitai SDK image quality vs local generation
- [ ] Check what settings are controllable (steps, samplers, etc.)
- [ ] Verify Buzz costs don't balloon with LoRAs/resources
- [ ] Test API rate limits
- [ ] See if "BIG PP SETTINGS" are possible or if it's "basic inference" like Runware
- [ ] **Ask Civitai dev team if user-authenticated tokens are allowed** (see section below)

---

## 🔥 FUTURE SCALING IDEA: User-Authenticated Civitai Tokens

### The Concept
Instead of YOU paying for image generation, **users authenticate with their own Civitai API tokens** and spend THEIR Buzz.

### Why This Is Genius
- ✅ **Zero cost to you** (users pay for their own generations)
- ✅ **Zero moral hazard** (can't drain your wallet)
- ✅ **Built-in rate limiting** (Civitai enforces their own limits per token)
- ✅ **Scales infinitely** (more users = zero extra cost)
- ✅ **Users who want it, pay for it** (opt-in feature)
- ✅ **Free users can still use it** (daily free Buzz from Civitai)

### How It Would Work

**User Flow**:
1. User runs `/set-civitai-token <their_api_token>` (ephemeral, private)
2. Bot validates token, stores it encrypted
3. User runs `/dream <prompt>`
4. Bot uses THEIR token to generate image
5. Civitai deducts Buzz from THEIR account
6. Bot returns image to Discord

**Bot Owner Cost**: $0 for image gen, ~$5/month for PostgreSQL (only if feature gets popular)

### Implementation Phases

#### Phase 1: MVP (In-Memory Storage)
**No database needed** - just test the concept:
```python
user_civitai_tokens = {}  # {discord_user_id: token}

@bot.tree.command(name="set-civitai-token")
async def set_token(interaction: discord.Interaction, token: str):
    # Ephemeral so token isn't visible
    await interaction.response.defer(ephemeral=True)

    # Validate token works
    try:
        civitai.auth.set_token(token)
        # Test API call
        test = civitai.image.create({...})

        # Store it
        user_civitai_tokens[interaction.user.id] = token

        await interaction.followup.send(
            "✅ Token authenticated! You can now use `/dream`\n"
            "⚠️ Token stored until bot restarts.",
            ephemeral=True
        )
    except Exception as e:
        await interaction.followup.send(
            f"❌ Invalid token: {e}\n"
            "Get your token from: https://civitai.com/user/account",
            ephemeral=True
        )

@bot.tree.command(name="dream")
async def dream(interaction: discord.Interaction, prompt: str):
    if interaction.user.id not in user_civitai_tokens:
        await interaction.response.send_message(
            "❌ Authenticate first with `/set-civitai-token`",
            ephemeral=True
        )
        return

    # Use THEIR token
    user_token = user_civitai_tokens[interaction.user.id]
    civitai.auth.set_token(user_token)

    response = civitai.image.create({...})
    # Return image
```

**Pros**: Simple, test with real users, zero infrastructure
**Cons**: Tokens lost on bot restart (users re-authenticate, nbd)

#### Phase 2: SQLite Persistence
**Add local database** for persistence:
```python
import sqlite3
from cryptography.fernet import Fernet

# Encrypt tokens before storing
cipher = Fernet(os.getenv('TOKEN_ENCRYPTION_KEY'))

def store_token(discord_id: int, token: str):
    encrypted = cipher.encrypt(token.encode()).decode()
    conn.execute(
        'INSERT OR REPLACE INTO user_tokens VALUES (?, ?)',
        (discord_id, encrypted)
    )
```

**Pros**: Survives bot restarts
**Cons**: Railway has ephemeral filesystem (wiped on redeploy)

#### Phase 3: PostgreSQL (Production)
**Railway PostgreSQL** for proper persistence:
```python
import psycopg2

DATABASE_URL = os.getenv('DATABASE_URL')  # Railway provides this

def store_token(discord_id: int, token: str):
    encrypted = cipher.encrypt(token.encode()).decode()
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO user_tokens (discord_id, encrypted_token)
        VALUES (%s, %s)
        ON CONFLICT (discord_id)
        DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token
    ''', (discord_id, encrypted))
    conn.commit()
```

**Cost**: ~$5/month for Railway PostgreSQL (only if feature gets popular)

### Rate Limiting Strategy

**Civitai handles most of it**:
- Per-token rate limits (their API enforces this)
- Buzz balance limits (can't generate with 0 Buzz)
- Concurrent generation limits

**You just add basic protection**:
```python
from datetime import datetime, timedelta

user_last_generation = {}

@bot.tree.command(name="dream")
async def dream(interaction, prompt):
    # 30 second cooldown per user
    if interaction.user.id in user_last_generation:
        elapsed = datetime.now() - user_last_generation[interaction.user.id]
        if elapsed < timedelta(seconds=30):
            await interaction.response.send_message(
                f"⏰ Cooldown: {30 - elapsed.seconds}s remaining",
                ephemeral=True
            )
            return

    user_last_generation[interaction.user.id] = datetime.now()

    try:
        # Generate with user's token
        response = civitai.image.create({...})
    except civitai.errors.RateLimitError:
        await interaction.followup.send(
            "⏰ Civitai rate limit hit. Wait a minute!",
            ephemeral=True
        )
    except civitai.errors.InsufficientBuzzError:
        await interaction.followup.send(
            "⚡ Not enough Buzz! Get more: https://civitai.com/pricing",
            ephemeral=True
        )
```

### Security Considerations

**1. Token Storage**:
- ✅ Encrypt tokens with `cryptography.fernet`
- ✅ Store encryption key in Railway secrets (never commit)
- ✅ Use PostgreSQL with SSL/TLS
- ❌ NEVER store plaintext tokens

**2. Token Transmission**:
- ✅ ALWAYS use `ephemeral=True` for `/set-civitai-token`
- ✅ Tokens never appear in public chat
- ✅ DM users if token validation fails

**3. Token Revocation**:
```python
@bot.tree.command(name="remove-civitai-token")
async def remove_token(interaction):
    # Delete from storage
    delete_user_token(interaction.user.id)
    await interaction.response.send_message(
        "✅ Token removed",
        ephemeral=True
    )
```

### NSFW Considerations

**Current Civitai Restrictions**:
- ❌ Civitai generator API **does NOT support NSFW generation** (as of 2025)
- ✅ This actually HELPS with Discord TOS compliance
- ✅ No need to implement NSFW filtering (Civitai does it)
- ✅ Avoids age-gating headaches

**Discord's Stance**:
- NSFW must be in age-restricted channels
- Bots can be banned for NSFW in SFW channels
- With Civitai's restrictions, this is a non-issue

**If Civitai ever allows NSFW API generation**:
```python
@bot.tree.command(name="dream")
async def dream(interaction, prompt):
    # Check if channel is age-restricted
    if not interaction.channel.nsfw:
        # Force SFW mode
        input['params']['nsfw'] = False
    else:
        # Allow NSFW in age-restricted channels
        input['params']['nsfw'] = True
```

But honestly, with how Discord's going, SFW-only might be a blessing in disguise lol.

### Critical Questions to Ask Civitai Dev Team

**BEFORE implementing this, verify**:
- [ ] **Is it ToS-compliant for users to share API tokens with a Discord bot?**
  - Some APIs prohibit third-party token usage
  - Need explicit confirmation this is allowed
- [ ] **Are there additional rate limits for bot-like usage?**
  - Automated requests might be treated differently
- [ ] **Is there a webhook/OAuth flow instead of raw tokens?**
  - More secure than storing tokens
  - Users could authorize bot without sharing token
- [ ] **What's the official stance on Discord bot integration?**
  - Do they encourage it, discourage it, or not care?
- [ ] **Are there special API keys for bot developers?**
  - Some platforms offer separate bot API keys

**Where to ask**:
- Civitai Discord (dev channel)
- Civitai GitHub issues
- Email: developer-support@civitai.com (if exists)

### Why This Might Be Better Than Self-Hosted

**User-Authenticated Civitai vs Vast.ai**:

| Feature | User-Auth Civitai | Vast.ai Self-Hosted |
|---------|-------------------|---------------------|
| **Cost to you** | $0-5/month (just DB) | $10-50/month (GPU rental) |
| **Cost to users** | $0-5/month (their Buzz) | $0 (you pay) |
| **Setup complexity** | Medium (DB, encryption) | Hard (Docker, GPU, infra) |
| **Maintenance** | Low (Civitai handles it) | High (you manage GPU) |
| **Model selection** | Full Civitai catalog | Unlimited (any model) |
| **Quality control** | Unknown (need to test) | Full control (BIG PP) |
| **Scalability** | Infinite (zero marginal cost) | Limited by your budget |

**User-Auth Civitai wins IF**:
- Civitai allows it (ToS check)
- Quality is acceptable (BIG PP settings possible)
- Users are willing to manage their own Buzz

### Recommended Path Forward

1. **Ask Civitai dev team** about ToS compliance (CRITICAL)
2. **If allowed**: Test Phase 1 (in-memory) with a few trusted users
3. **Measure**:
   - Do users actually use it?
   - Is quality acceptable?
   - Are settings controllable enough?
4. **If successful**: Add Phase 2 (SQLite) for persistence
5. **If popular**: Upgrade to Phase 3 (PostgreSQL) for production

### The Dream Scenario

If this works:
- Your bot stays at **$0-5/month cost** even with image generation
- Users get **convenient Discord-based generation** with models they love
- Civitai gets **more API usage** (win for them)
- You get **a killer feature** without the wallet pain
- Everyone wins ✨

---

### If You DO Add It: Feature-Gate It

```python
@bot.tree.command(name="dream")
async def dream_command(interaction: discord.Interaction, prompt: str):
    # Only for premium/donor users
    premium_role = discord.utils.get(interaction.guild.roles, name="Premium")

    if premium_role not in interaction.user.roles:
        await interaction.response.send_message(
            "❌ `/dream` is only available to Premium supporters!\n"
            "Support the bot on Ko-fi to get access: https://ko-fi.com/yourbot",
            ephemeral=True
        )
        return

    # Generate image (costs covered by their donation)
```

**This way**:
- Free users: Get your core value (metadata parsing)
- Premium users: Get image gen (they pay for the GPU costs)
- You: Don't eat $50/month in costs

### Reference Implementation
- **Bot example**: https://github.com/AndBobsYourUncle/stable-diffusion-discord-bot
- **Full cost analysis**: See rest of this document

---

## The "Corporate Normie" vs "Guerrilla SD User" Problem

After testing, we discovered services are optimized for different audiences:

### 🏢 Corporate Normie Services (Runware)
**Good for**:
- Stock photo replacements
- "Generic business person smiling" for corporate decks
- Bulk marketing material where quality doesn't matter
- Thumbnail spam
- People who don't know what "steps" means

**Pricing**: ~$0.0019/image (Pony XL basic)

**Quality**: "Basic inference" = low steps, basic samplers, 1024x1024 max
- Test prompt: "a flowering derpy hooves"
- Result: Derpy literally shitting 💩
- Why: Low steps, bad sampler, no refinement

**Who wants this**: Marketing teams, businesses, people who think DALL-E is "AI art"

**Red flags**:
- ❌ "Business email only" for free tier (filtering out indie devs on purpose)
- ❌ Limited control over parameters
- ❌ Quality issues from "basic inference"
- ❌ 1024x1024 max (no hires fix in base price)

### 🏴‍☠️ Guerrilla SD User Services (Vast.ai, Self-Hosted)

**Good for**:
- BIG PP SETTINGS™: 35+ steps, DPM++ 2M Karras, CFG 8.0
- Hires fix, 1536x1536+, refiner passes
- Full control over every parameter
- Custom Civitai models and LoRAs
- People who know the difference between Euler and Euler A
- Quality waifus, not pooping horses 💩

**Pricing**: ~$0.004-0.008/image (with proper settings)

**Quality**: Actually good
- Same prompt: "a flowering derpy hooves"
- Result: Cute pony with flowers, no poop
- Why: 35 steps, proper sampler, hires fix, refinement

**Who wants this**: SD enthusiasts, artists, people who care about quality, Discord communities that know their shit

**Why this costs more**:
- More GPU time (35 steps vs 20)
- Better samplers (slower but higher quality)
- Hires fix (2x the work)
- But worth it because you don't need 3 retries to get a decent image

### Cost Reality Check

**Runware "basic"**:
- $0.0019/image × 3 retries (because quality sucks) = **$0.0057/image**

**Vast.ai BIG PP**:
- $0.005/image × 1 generation (gets it right first time) = **$0.005/image**

**Actual cost is the same if "basic" requires multiple retries!**

---

## Option 1: Runware API ⭐ (Recommended to Test First)

### What It Is
Cloud API service that claims to have Civitai models integrated with fast inference (<2 sec).

### Pricing
- **Pay-as-you-go**: $0.003 per image
- **$10/month**: 5,000 images (~$0.002 per image)
- **$50/month**: 30,000 images (~$0.0017 per image)
- **$200/month**: 150,000 images (~$0.0013 per image)

### Cost Examples
- 100 images/month: $0.30 (pay-as-you-go)
- 1,000 images/month: $2-3
- 5,000 images/month: $10 (best value tier)
- 10,000 images/month: $20-25

### Pros
- ✅ **Cheapest option** for moderate volume (<10k images/month)
- ✅ **Fastest inference** (<2 seconds vs 5-10 sec self-hosted)
- ✅ **No cold starts** (always ready)
- ✅ **Zero infrastructure management** (no GPUs, no Docker, no servers)
- ✅ **Claims to support Civitai models** (HUGE if true)
- ✅ **Simple REST API** (easier than managing endpoints)
- ✅ **Built-in queue system** (handles burst traffic)
- ✅ **Scales automatically** (10 requests or 1000, doesn't matter)

### Cons
- ❌ **Need to verify Civitai model selection** (might not have all models)
- ❌ **Can't use YOUR custom fine-tuned models** (only what they host)
- ❌ **Vendor lock-in** (API-specific, can't easily migrate)
- ❌ **Unknown signup process** (need to test if it's sketchy)
- ❌ **Less control** over exact parameters/schedulers
- ❌ **Costs add up** at very high volume (>30k/month)

### When to Use This
- You want image gen working **quickly** without infrastructure headaches
- Standard Civitai models are good enough (Pony, SDXL, Flux, etc.)
- Generating <10k images/month
- You value speed and simplicity over full control

### Implementation Difficulty
**Easy** (1-2 hours) - Just API calls, no GPU/Docker setup needed.

### Notes to Check
- [ ] **Verify their Civitai model catalog** - do they have models you want?
- [ ] **Test signup process** - is it legit or sketchy?
- [ ] **Check API limits** - rate limits, concurrent requests, etc.
- [ ] **Review TOS** - do they store images? privacy concerns?
- [ ] **Test image quality** - does it match local generation?

---

## Option 2: RunPod Serverless

### What It Is
Rent GPU time only when generating images. Auto-scales workers based on demand. You bring your own models.

### Pricing
- **Active workers**: $0.0004-0.0008 per second of inference
- **SDXL generation** (5-10 sec): ~$0.004-0.008 per image
- **Cold start**: 10-20 seconds (free, but slow for first request)
- **Active worker (no cold start)**: +$0.30/hour to keep 1 worker warm

### Cost Examples
- 100 images/month: $0.40-0.80
- 1,000 images/month: $4-8
- 5,000 images/month: $20-40
- 10,000 images/month: $40-80

Add +$0.30/hr (~$220/month) if you want zero cold starts (probably overkill).

### Pros
- ✅ **Use ANY model** (Civitai, HuggingFace, your own fine-tunes)
- ✅ **Only pay for generation time** (zero cost when idle)
- ✅ **Auto-scales** (handles burst traffic)
- ✅ **Full control** over parameters, schedulers, etc.
- ✅ **FP8 support** (lower VRAM, faster inference)
- ✅ **LoRA support** (load any LoRA you want)

### Cons
- ❌ **Cold starts** (10-20 sec for first image after idle)
- ❌ **More expensive** than Runware at moderate volume
- ❌ **Requires Docker setup** (build image with models)
- ❌ **More complex** to maintain
- ❌ **Slower inference** (5-10 sec vs Runware's <2 sec)

### When to Use This
- You need specific Civitai models Runware doesn't have
- You have custom fine-tuned models
- You want full control over generation pipeline
- Cold starts are acceptable (or you pay for active workers)

### Implementation Difficulty
**Medium** (4-8 hours) - Need to build Docker image, configure endpoint, test auto-scaling.

---

## Option 3: RunPod GPU Pods (Always-On)

### What It Is
Rent a GPU server that runs 24/7 (or manually start/stop). Full VM access.

### Pricing
- **RTX A4000** (16GB VRAM): ~$0.29/hour = $210/month if always-on
- **RTX 4090** (24GB VRAM): ~$0.69/hour = $500/month if always-on
- **Manual start/stop**: Only pay when running ($5-50/month depending on usage)

### Cost Examples (if you manually start/stop)
- Run 20 hours/month (RTX A4000): ~$6/month
- Run 50 hours/month (RTX A4000): ~$15/month
- Run 100 hours/month (RTX A4000): ~$30/month

### Pros
- ✅ **Full control** (SSH access, install anything)
- ✅ **No cold starts** (if kept running)
- ✅ **Use ANY model** (unlimited)
- ✅ **Fast inference** (5-10 sec)
- ✅ **Can run other services** on same pod (not just image gen)

### Cons
- ❌ **Expensive if always-on** ($210-500/month)
- ❌ **Manual management** (start/stop to save money)
- ❌ **Paying when idle** (unless you stop it)
- ❌ **Setup complexity** (SSH, install deps, configure)

### When to Use This
- You want always-on GPU access for multiple projects
- You don't mind manually starting/stopping to save money
- You need full VM control
- Generating images frequently (daily usage)

### Implementation Difficulty
**Medium** (3-6 hours) - SSH setup, install Diffusers, expose API, configure auto-restart.

---

## Option 4: Vast.ai Spot Instances

### What It Is
Like RunPod, but cheaper spot pricing (can get kicked off if outbid).

### Pricing
- **RTX 3090**: ~$0.15-0.30/hour (fluctuates)
- **RTX 4090**: ~$0.30-0.50/hour (fluctuates)
- **Spot market**: Prices change based on demand

### Cost Examples (manual start/stop)
- Run 20 hours/month: ~$4-8/month
- Run 50 hours/month: ~$10-20/month
- Run 100 hours/month: ~$20-40/month

### Pros
- ✅ **Cheaper than RunPod** (spot pricing)
- ✅ **Full control** (use any model)
- ✅ **Good for bursty workloads** (rent when needed)

### Cons
- ❌ **Can get kicked off** (spot instances can be reclaimed)
- ❌ **Inconsistent availability** (popular GPUs sell out)
- ❌ **Manual management** (start/stop)
- ❌ **Less reliable** than RunPod

### When to Use This
- You want cheaper GPU access and can tolerate interruptions
- You're manually managing start/stop anyway
- You're okay with hunting for available GPUs

### Implementation Difficulty
**Medium** (3-6 hours) - Similar to RunPod pods.

---

## Option 5: Modal (Serverless Python)

### What It Is
Serverless platform for Python code. Dead simple GPU functions with a decorator.

### Pricing
- **First $30/month**: FREE (great for testing!)
- **After free credit**: ~$0.0006/sec for A100 GPU
- **SDXL generation** (5-10 sec): ~$0.003-0.006 per image

### Cost Examples
- First 5,000-10,000 images: **FREE** (with $30 credit)
- After that, similar to RunPod Serverless

### Pros
- ✅ **$30/month free credit** (great for testing)
- ✅ **Easiest setup** (just Python decorators, no Docker)
- ✅ **Auto-scales** like RunPod Serverless
- ✅ **Use any model** (load from HuggingFace/Civitai)
- ✅ **Modern platform** (good DX)

### Cons
- ❌ **Newer service** (less community support than RunPod)
- ❌ **Cold starts** (similar to RunPod Serverless)
- ❌ **Costs add up** after free credit

### When to Use This
- You want to **test for free** first ($30 credit)
- You value easy setup (no Docker)
- You're comfortable with newer platforms

### Implementation Difficulty
**Easy-Medium** (2-4 hours) - Easier than RunPod, but still need to configure models.

---

## Option 6: Your Own Hardware

### What It Is
Run Diffusers on your own gaming PC with a GPU. Expose via Cloudflare Tunnel.

### Pricing
- **Hardware cost**: One-time (if you don't have GPU already)
  - RTX 3060 12GB: ~$300 (used)
  - RTX 4060 Ti 16GB: ~$450
  - RTX 4090 24GB: ~$1,600
- **Electricity**: ~$5-15/month depending on usage
- **Internet**: You already pay for this

### Cost Examples
- Monthly cost: **~$5-15** (electricity only)
- One-time cost: $0 if you already have gaming PC, $300-1600 if buying GPU

### Pros
- ✅ **Cheapest long-term** (no per-image costs)
- ✅ **Unlimited generations** (no quotas)
- ✅ **Full privacy** (images never leave your network)
- ✅ **Use ANY model** (including your own fine-tunes)
- ✅ **Fast inference** (3-8 sec depending on GPU)
- ✅ **No vendor lock-in**

### Cons
- ❌ **Upfront hardware cost** (if you don't have GPU)
- ❌ **Your PC must be on** (or run 24/7 server)
- ❌ **Electricity costs** (not free)
- ❌ **GPU wear** (using GPU 24/7 shortens lifespan)
- ❌ **Network setup** (Cloudflare Tunnel, port forwarding, etc.)
- ❌ **You manage everything** (updates, failures, etc.)

### When to Use This
- You already have a gaming PC with decent GPU
- Generating >10k images/month (breaks even vs cloud)
- You want unlimited free generations
- Privacy is important

### Implementation Difficulty
**Medium-Hard** (4-10 hours) - Install Diffusers, configure Cloudflare Tunnel, secure API, test remote access.

---

## Comparison Table

| Option | Cost (1k imgs) | Speed | Setup Time | Control | Best For |
|--------|----------------|-------|------------|---------|----------|
| **Runware** | **$2-3** | <2 sec | 1-2 hrs | Low | Quick start, low volume |
| **RunPod Serverless** | $4-8 | 5-10 sec | 4-8 hrs | High | Custom models, auto-scale |
| **RunPod Pods** | $6-30 | 5-10 sec | 3-6 hrs | High | Frequent usage, manual management |
| **Vast.ai** | $4-20 | 5-10 sec | 3-6 hrs | High | Budget-conscious, can handle interruptions |
| **Modal** | FREE→$3-6 | 5-10 sec | 2-4 hrs | High | Testing first, then scale |
| **Own Hardware** | $5-15 | 3-8 sec | 4-10 hrs | Max | High volume, privacy, own models |

---

## Recommended Path

### Phase 1: Testing (First Month)
**Use Modal** - Get $30 free credit to test the feature with real users. See how much demand there is.

### Phase 2: Low-Medium Volume (<5k images/month)
**Use Runware** - If their Civitai model selection is good and signup isn't sketchy, this is the best value.

### Phase 3: Growing Volume (5k-10k images/month)
**Evaluate**:
- Still Runware if it's working well ($10-20/month)
- Or RunPod Serverless if you need specific models ($20-40/month)

### Phase 4: High Volume (>10k images/month)
**Consider own hardware** - At this scale, a one-time $300-500 GPU investment pays for itself in 6-12 months.

---

## Technical Implementation Notes

### FP8 Models
- **SDXL FP8**: 6GB VRAM instead of 12GB (50% memory savings)
- **FLUX FP8**: 8-10GB VRAM instead of 24GB (60% savings)
- **Quality**: Minimal loss (most users can't tell the difference)
- **Speed**: Slightly faster inference due to less data movement
- **Where to find**: Civitai (filter by "fp8" tag), HuggingFace

### Diffusers Library
All self-hosted options would use `diffusers` library:
```python
from diffusers import DiffusionPipeline
import torch

# Load model (fp16 or fp8)
pipe = DiffusionPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16,
    use_safetensors=True
)

# Load Civitai model
pipe = DiffusionPipeline.from_single_file(
    "/path/to/civitai_model.safetensors",
    torch_dtype=torch.float16
)

# Load LoRAs
pipe.load_lora_weights("lora.safetensors")
pipe.fuse_lora(lora_scale=0.8)

# Generate
image = pipe(
    prompt="cute cat",
    negative_prompt="ugly",
    num_inference_steps=20,
    guidance_scale=7.5
).images[0]
```

### Optimizations
- **xFormers**: 20-30% faster, less VRAM
- **Flash Attention 2**: 40% faster, requires newer GPUs
- **Model CPU Offload**: Reduces VRAM usage (slower)
- **Sequential CPU Offload**: Run on GPUs with <8GB VRAM (very slow)

---

## Security Considerations

### Rate Limiting (CRITICAL)
No matter which option you choose, implement:
- Per-user cooldowns (30-60 sec between generations)
- Daily limits per user (5-20 images/day)
- Guild-wide limits (prevent entire server from draining quota)

### Content Filtering
- NSFW detection (don't generate NSFW in SFW channels)
- Prompt filtering (block harmful/illegal prompts)
- Discord TOS compliance (no NSFW outside age-restricted channels)

### Cost Protection
- Set hard spending caps on cloud providers
- Monitor API usage daily
- Alert when approaching limits
- Kill switch if costs spike unexpectedly

### API Key Security
- Never commit API keys to Git
- Use environment variables (Railway secrets)
- Rotate keys periodically
- Monitor for unauthorized usage

---

## Next Steps

1. **Test Runware signup** - See if it's legit and check their Civitai model catalog
2. **Try Modal's free tier** - $30 credit to test with real users
3. **Measure demand** - Track how many `/dream` requests you'd get
4. **Decide based on volume**:
   - <5k/month → Runware
   - 5k-10k/month → RunPod Serverless or Runware
   - >10k/month → Own hardware

---

## Questions to Answer Before Choosing

- [ ] What Civitai models do you want to support?
- [ ] Does Runware have those models?
- [ ] How many images/month do you estimate?
- [ ] Do you have a gaming PC with GPU?
- [ ] What's your budget? ($10/month, $50/month, $100+/month?)
- [ ] Is cold start time acceptable? (10-20 sec delay)
- [ ] Do you need custom fine-tuned models?
- [ ] Privacy concerns? (cloud vs local)

---

Last updated: 2025-10-22
