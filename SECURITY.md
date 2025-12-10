# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | :white_check_mark: |
| 1.x.x   | :x:                |

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in PromptInspectorBot, please report it responsibly:

### 🔒 How to Report

1. **Email:** Send details to the maintainer via Discord (preferred) or GitHub
2. **Discord:** Join our community server and DM the bot owner
   - Discord Server: https://discord.gg/HhBSvM9gBY
   - Look for Ktiseos Nyx (Duskfall Crew)
3. **GitHub:** Create a [private security advisory](https://github.com/Ktiseos-Nyx/PromptInspectorBot/security/advisories/new)

### 📋 What to Include

Please include the following information in your report:
- **Type of vulnerability** (e.g., XSS, command injection, API key exposure)
- **Affected component** (e.g., specific command, configuration file)
- **Steps to reproduce** the issue
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up questions

### ⏱️ Response Timeline

- **Initial Response:** Within 48 hours of report
- **Status Update:** Within 7 days with our assessment
- **Fix Timeline:** Varies based on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: 30 days or next release

### 🎁 Recognition

We appreciate responsible disclosure! With your permission, we will:
- Credit you in the security advisory and release notes
- Add you to our CONTRIBUTORS file
- Publicly thank you in our Discord community

## Security Best Practices for Self-Hosting

If you're self-hosting PromptInspectorBot, follow these security guidelines:

### 🔐 Environment Variables
- **NEVER** commit `.env` files to version control
- Use strong, unique API keys for all services
- Rotate API keys regularly (every 90 days recommended)
- Use Railway/Railway secrets manager, not hardcoded values

### 🛡️ Discord Bot Permissions
- Only grant **required** permissions (see README)
- Enable **Server Members Intent** only if needed
- Use role-based access control for admin commands
- Regularly audit bot permissions in servers

### 🌐 Cloudflare R2 / S3 Configuration
- Use presigned URLs with short expiration times (default: 1 hour)
- Enable CORS only for your bot's domain
- Set proper bucket policies (private by default)
- Monitor upload activity for abuse

### 📊 Rate Limiting
- Configure rate limits in `.env` to prevent abuse
- Monitor for unusual API usage patterns
- Implement daily upload limits per user/role
- Use the built-in security system to detect spam

### 🔒 API Key Security
**Gemini API Key:**
- Use API key restrictions (IP allowlists if possible)
- Enable quota limits in Google Cloud Console
- Monitor usage in Google AI Studio

**Anthropic API Key:**
- Set spending limits in Anthropic Console
- Rotate keys if bot is compromised
- Monitor unusual API patterns

**Discord Bot Token:**
- Regenerate token immediately if exposed
- Use token permissions, not full admin access
- Enable 2FA on Discord account

### 🚨 Security Features to Enable

1. **Guild Whitelisting:** Set `ALLOWED_GUILD_IDS` to restrict server access
2. **DM Whitelisting:** Set `DM_ALLOWED_USER_IDS` for authorized DM users
3. **Security System:** Enable anti-scam detection (default: ON)
4. **Trusted Users:** Add yourself to `TRUSTED_USER_IDS` to bypass security
5. **Admin Alerts:** Configure `ADMIN_CHANNEL_IDS` for security notifications

### 📝 Logging & Monitoring

- Review logs regularly for suspicious activity
- Enable Railway/platform logging
- Monitor API usage for unexpected spikes
- Track failed authentication attempts

## Known Security Considerations

### Anti-Scam Detection
The bot includes automatic scam detection that may:
- Delete messages containing cryptocurrency wallet scams
- Ban users posting malware disguised as images
- Flag suspicious cross-posting behavior

**Important:** While helpful, this is NOT a replacement for proper server moderation.

### User Data
The bot processes:
- **Discord User IDs** (for rate limiting, whitelists)
- **Uploaded Images** (temporarily stored in R2, auto-deleted after processing)
- **Message Content** (for scam detection, not stored permanently)
- **Guild Settings** (stored in `guild_settings.json`)

See [PRIVACY.md](PRIVACY.md) for full data handling policy.

## Disclosure Policy

When a security vulnerability is fixed:
1. We will publish a security advisory on GitHub
2. We will credit the reporter (with permission)
3. We will notify users in our Discord community
4. We will update this SECURITY.md with mitigation steps

## Security Hall of Fame

We will recognize security researchers who responsibly disclose vulnerabilities:

*(No vulnerabilities reported yet - be the first!)*

---

## Contact

- **Discord Community:** https://discord.gg/HhBSvM9gBY
- **GitHub Issues:** https://github.com/Ktiseos-Nyx/PromptInspectorBot/issues (for non-security bugs)
- **Developer:** Ktiseos Nyx (Duskfall Crew) - https://beacons.ai/duskfallcrew

**Thank you for helping keep PromptInspectorBot and its users safe!** 🛡️
