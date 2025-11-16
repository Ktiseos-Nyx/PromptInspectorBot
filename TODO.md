# TODO - Future Features & Improvements

## Security & Rate Limiting (HIGH PRIORITY)

### Rate Limiting
- [ ] Per-user cooldowns (e.g., 5 seconds between `/describe` calls)
- [ ] Daily usage limits per user to prevent API quota abuse
- [ ] Guild-wide rate limiting
- [ ] Usage tracking and alerts when approaching API limits

### Image Validation
- [ ] Validate actual file headers (magic bytes) using existing `filetype` library
- [ ] Scan for potential malicious payloads in metadata
- [ ] Check image dimensions to prevent decompression bombs
- [ ] Add maximum resolution limits

### Metadata Security
- [ ] Sanitize URLs found in metadata before displaying
- [ ] Limit metadata field lengths to prevent spam walls
- [ ] Add XSS protection for future web dashboard integration
- [ ] Validate and escape special characters in metadata fields

### API Key Management
- [ ] Verify `.env` is in `.gitignore`
- [ ] Document API key rotation process
- [ ] Add Gemini API usage monitoring/alerts
- [ ] Consider key usage caps

## AI-Powered Moderation (THE POWER OF GOD AND ANIME)

### Spam Detection
- [ ] **Ultra spam detection at 7 AM when mods are asleep** - use Gemini to detect:
  - Repetitive message patterns
  - Nonsense/gibberish spam
  - Raid attempts (multiple users posting similar content)
  - Copypasta floods
- [ ] Auto-timeout/mute capabilities with configurable thresholds
- [ ] Smart alerts to mods (don't wake them for minor stuff, DO wake them for raids)
- [ ] Configurable "strict mode" hours (e.g., stricter during night/early morning)

### Content Moderation
- [ ] NSFW content detection in images (Gemini vision)
- [ ] Toxicity detection in conversations
- [ ] Scam/phishing link detection
- [ ] Suspicious behavior patterns (account age + spam = likely bot)

### Moderation Features
- [ ] `/mod-config` - configure moderation sensitivity levels
- [ ] Whitelist trusted users (system members, regulars)
- [ ] Auto-log suspicious activity for review
- [ ] Integration with Discord's AutoMod (complement, not replace)

## User Interaction Improvements

### Reply-Based Interactions
- [ ] **Reply to images to get metadata/descriptions** - detect when user replies to a message with an image
  - Reply with just "metadata" → show metadata
  - Reply with "describe" or "what is this" → AI description
  - Reply with questions → context-aware answers about the image
- [ ] Support for replying to bot's metadata messages for follow-up questions
- [ ] Thread creation for long discussions about specific images

### Conversation Enhancements
- [ ] Context-aware replies (bot remembers what image you're discussing)
- [ ] Multi-turn conversations about images
- [ ] "Explain this parameter" - AI explains what cfg_scale, steps, etc. mean
- [ ] Prompt improvement suggestions based on detected metadata

## Metadata Features

### Workflow Management
- [ ] Extract and save ComfyUI workflows as `.json` files
- [ ] Download button for complete workflows
- [ ] Workflow library per server
- [ ] Workflow sharing between servers (opt-in)
- [ ] Workflow version tracking

### Comparison Tools
- [ ] `/compare` command for side-by-side parameter comparison
- [ ] Highlight differences between images in a test run
- [ ] A/B testing support for model comparisons
- [ ] Visual diff for workflow nodes

### Batch Operations
- [ ] `/extract-all` - download all metadata from a thread as CSV
- [ ] Thread summarization for model test runs
- [ ] Bulk workflow export
- [ ] Statistical analysis of generation parameters

## Model & Prompt Tools

### Model Database
- [ ] Track most-used models per server
- [ ] Auto-link to Civitai/HuggingFace pages
- [ ] Model update notifications
- [ ] Model recommendation based on detected styles
- [ ] LoRA usage statistics

### Prompt Analysis
- [ ] `/analyze-prompt` - AI suggestions to improve prompts
- [ ] Detect conflicting tags or common mistakes
- [ ] Suggest related tags based on detected style
- [ ] Prompt template library
- [ ] Tag frequency analysis

## Integration & Advanced Features

### PluralKit Integration Enhancement
- [ ] Per-system-member conversation history for `/ask`
- [ ] System-aware preferences (different describe styles per alter)
- [ ] System member usage statistics
- [ ] Member-specific cooldowns (don't penalize whole system for one alter's usage)

### Local LLM Support (Cost $0, Privacy 100%)
- [ ] Ollama integration for `/ask` and `/describe`
- [ ] LM Studio support
- [ ] Provider switching (`/set-provider gemini|ollama|lmstudio`)
- [ ] Hybrid mode: Local for privacy-sensitive, Gemini for complex tasks
- [ ] Model selection per feature (fast model for spam detection, big model for descriptions)

### Webhook & Notifications
- [ ] Alert when specific models are used
- [ ] RSS-style feed of new workflows posted
- [ ] Cross-bot metadata sharing
- [ ] Integration with other community bots

## Quality of Life

### Quick Wins (Easy Implementation)
- [ ] Reaction cleanup - remove 🔎 after user clicks it
- [ ] Edit support - re-scan images when message is edited
- [ ] `/metadata-help` command with examples
- [ ] `/stats` - images processed, most common model, uptime, etc.
- [ ] Favorite prompts - users can "star" metadata for later
- [ ] Better error messages (user-friendly, not stack traces)
- [ ] Loading indicators for slow operations

### UI/UX Improvements
- [ ] Embed formatting improvements
- [ ] Thumbnail previews in metadata embeds
- [ ] Color coding by generation tool (ComfyUI = blue, A1111 = green, etc.)
- [ ] Emoji indicators for model types (📸 checkpoint, 🎨 LoRA, etc.)
- [ ] Pagination for very long metadata

### Configuration
- [ ] Web dashboard for bot configuration (future)
- [ ] Per-channel feature toggles via Discord UI (buttons/modals)
- [ ] Server-specific settings profiles
- [ ] Easy backup/restore of bot configuration

## Performance & Reliability

### Optimization
- [ ] Implement persistent storage (Redis/SQLite) instead of in-memory cache
- [ ] Lazy loading for large metadata
- [ ] Image processing queue to prevent blocking
- [ ] Caching for frequently accessed data

### Monitoring
- [ ] Health check endpoint for Railway
- [ ] Error rate tracking
- [ ] Performance metrics (processing time, API latency)
- [ ] Automatic restart on critical errors

## Documentation

### User Documentation
- [ ] Command reference guide
- [ ] Troubleshooting FAQ
- [ ] Video tutorials for common workflows
- [ ] Best practices guide

### Developer Documentation
- [ ] Architecture documentation
- [ ] API documentation for extending the bot
- [ ] Plugin system for custom features
- [ ] Contributing guidelines

## Community Features

### Social
- [ ] Server leaderboards (most creative prompts, most active contributors)
- [ ] Monthly showcase of best images
- [ ] Community workflow library
- [ ] Collaborative prompt building

### Gamification
- [ ] Achievement system ("Parsed 100 images!", "Workflow Master!")
- [ ] Profile cards showing user's favorite models/styles
- [ ] Contribution tracking
- [ ] Seasonal events

---

## Priority Ranking

### P0 (Do ASAP)
1. Rate limiting (prevent API bill shock)
2. Basic spam detection (the 7 AM problem)
3. Reply-based metadata/describe

### P1 (High Value)
1. Workflow extraction (ComfyUI users will love this)
2. Local LLM support (eliminate API costs)
3. Better error handling and UX

### P2 (Nice to Have)
1. Model database and tracking
2. Prompt analysis tools
3. Enhanced PluralKit integration

### P3 (Future Dreams)
1. Web dashboard
2. Community features
3. Gamification

---

## Notes
- Consider API costs for Gemini features (local LLM reduces this to $0)
- PluralKit integration should respect system privacy
- All moderation features should be configurable and opt-in
- Keep the bot lightweight - Railway free tier is the goal
- Open to community PRs for any of these features!

Last updated: 2025-10-22
