import crypto from 'crypto';
import { Message, GuildMember, Guild, TextChannel, EmbedBuilder, Colors } from 'discord.js';
import type { ResolvedModConfig } from './settings-types';

// ── Cross-post tracking ───────────────────────────────────────────────────────

interface TrackedMessage { fingerprint: string; channelId: string; timestamp: number; bytes: number; isMedia: boolean; }
const userMessages = new Map<string, TrackedMessage[]>();
export const CROSS_POST_WINDOW = 300; // seconds; also the max retention, so velocity windows are clamped to it

function fingerprint(message: Message): string {
  let s = message.content.trim();
  for (const a of message.attachments.values()) s += `|${a.name}|${a.size}`;
  return crypto.createHash('md5').update(s).digest('hex');
}

// ── Media detection ───────────────────────────────────────────────────────────
// GIFs are frequently delivered as links from known hosts (Tenor/Giphy/Discord
// picker), not uploads. Scan message content synchronously — link embeds unfurl
// later via a separate MessageUpdate, too late for MessageCreate checks.
export function isGifLink(content: string, domains: string[]): boolean {
  if (!content || domains.length === 0) return false;
  const esc = domains.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`https?://(?:[^\\s/]+\\.)?(?:${esc})\\/\\S+`, 'i');
  return re.test(content);
}

export function isMediaMessage(message: Message, gifDomains: string[]): boolean {
  for (const a of message.attachments.values()) {
    if (a.contentType?.startsWith('image/')) return true;
  }
  return isGifLink(message.content ?? '', gifDomains);
}

export function trackMessage(message: Message, gifDomains: string[] = []): void {
  const uid = message.author.id;
  const now = Date.now() / 1000;
  const fp = fingerprint(message);
  let bytes = 0;
  for (const a of message.attachments.values()) bytes += a.size;
  const isMedia = isMediaMessage(message, gifDomains);
  const prev = (userMessages.get(uid) ?? []).filter(m => now - m.timestamp < CROSS_POST_WINDOW);
  prev.push({ fingerprint: fp, channelId: message.channelId, timestamp: now, bytes, isMedia });
  userMessages.set(uid, prev.slice(-50));
}

export function checkCrossPosting(message: Message): number {
  const uid = message.author.id;
  const fp = fingerprint(message);
  const recent = userMessages.get(uid) ?? [];
  const channels = new Set(recent.filter(m => m.fingerprint === fp).map(m => m.channelId));
  return channels.size;
}

// Two-track velocity over the same in-memory tracking, read over a tighter
// (configurable) window than CROSS_POST_WINDOW:
//   sameChannels  — distinct channels with the SAME fingerprint (identical repost)
//   mediaChannels — distinct channels carrying ANY media (catches different GIFs)
// windowSec is clamped by callers to CROSS_POST_WINDOW — entries older than that are pruned by trackMessage, so a larger window would silently undercount.
export function checkMediaVelocity(
  message: Message,
  windowSec: number,
): { sameChannels: number; mediaChannels: number; maxBytes: number } {
  const uid = message.author.id;
  const now = Date.now() / 1000;
  const fp = fingerprint(message);
  const recent = (userMessages.get(uid) ?? []).filter(m => now - m.timestamp < windowSec);
  const sameChannels = new Set(recent.filter(m => m.fingerprint === fp).map(m => m.channelId)).size;
  const mediaMsgs = recent.filter(m => m.isMedia);
  const mediaChannels = new Set(mediaMsgs.map(m => m.channelId)).size;
  const maxBytes = mediaMsgs.reduce((mx, m) => Math.max(mx, m.bytes), 0);
  return { sameChannels, mediaChannels, maxBytes };
}

// ── Gibberish / spam detection ────────────────────────────────────────────────

const COMMON_OK = new Set([
  'hello','hi','thanks','thank','please','welcome','yes','no','okay','ok',
  'sure','nice','good','great','awesome','cool','wow','lol','lmao','rofl',
  'omg','wtf','brb','afk','gg','gn',
]);

export function isGibberish(text: string, userHasRoles: boolean, hasImages: boolean): boolean {
  text = text.trim();
  if (!text) return !hasImages;

  if (userHasRoles) {
    const unique = new Set(text.replace(/\s/g, '').toLowerCase().split(''));
    if (unique.size <= 2) return false;
  }

  if (/^[a-zA-Z]+$/.test(text) && !text.includes(' ') && text.length >= 5 && text.length <= 20) {
    if (COMMON_OK.has(text.toLowerCase())) return false;
    if (userHasRoles) return false;
    return true;
  }

  return false;
}

// ── Wallet scam scoring ───────────────────────────────────────────────────────

const SCAM_PATTERNS: [RegExp, number][] = [
  [/\bWALL?LET\b/i, 50],
  [/\b\d+\s*SOL\b/i, 50],
  [/\bDEAD\s+TOKENS?\b/i, 50],
  [/\bPAY\s+HIM\b/i, 50],
  [/\bPLENTY\s+TRANSACTIONS?\b/i, 40],
  [/\bEMPTY\s+WALLET\b/i, 40],
  [/\bCRYPTO\b/i, 20],
  [/\bDM\s+ME\b/i, 30],
  [/\bBUY\b.*\bWALLET\b/i, 40],
];

export function calculateScamScore(message: Message, cfg: ResolvedModConfig): [number, string[]] {
  let score = 0;
  const reasons: string[] = [];
  const name = (message.member?.displayName ?? message.author.username);

  if (/[£€¥₿$₹₽]/.test(name)) { score += 20; reasons.push('Currency symbols in username'); }
  if (name && /^[!=@#._\-~]/.test(name)) { score += 20; reasons.push('Hoisting character in username'); }
  if (/[a-z]+\.[a-z]+\d{2,4}_\d{4,}/.test(name.toLowerCase())) { score += 15; reasons.push('Auto-generated username pattern'); }

  if (message.content.length > 20) {
    const caps = [...message.content].filter(c => c >= 'A' && c <= 'Z').length;
    const ratio = caps / message.content.length;
    if (ratio > 0.7) { score += 30; reasons.push(`Caps spam (${Math.round(ratio * 100)}%)`); }
  }

  for (const [pattern, pts] of SCAM_PATTERNS) {
    if (pattern.test(message.content)) { score += pts; reasons.push(`Keyword match: ${pattern.source}`); }
  }

  const member = message.member;
  if (member) {
    const roles = member.roles.cache;
    if (cfg.catcherRoleId && roles.size === 2 && roles.has(cfg.catcherRoleId)) {
      score += 30; reasons.push('Only has CATCHER role');
    } else if (roles.size === 1) {
      score += 20; reasons.push('No roles (only @everyone)');
    }
  }

  if (!message.author.avatar) { score += 15; reasons.push('No profile picture'); }

  return [score, reasons];
}

// ── Magic bytes check ─────────────────────────────────────────────────────────

export function verifyImageSafety(data: Buffer, filename: string): [boolean, string] {
  if (data.length < 4) return [false, 'File too small'];
  const magic = data.subarray(0, 4);
  if (magic[0] === 0x4D && magic[1] === 0x5A) return [false, 'Windows executable disguised as image'];
  if (magic[0] === 0x7F && magic[1] === 0x45) return [false, 'Linux ELF binary disguised as image'];
  if (magic[0] === 0xFF && magic[1] === 0xD8) return [true, 'JPEG'];
  if (magic.toString('ascii', 1, 4) === 'PNG') return [true, 'PNG'];
  if (data.subarray(0, 4).toString('ascii') === 'RIFF') return [true, 'WebP'];
  if (magic[0] === 0x42 && magic[1] === 0x4D) return [true, 'BMP'];
  if (data.subarray(0, 3).toString('ascii') === 'GIF') return [true, 'GIF'];
  return [false, `Unknown format (magic: ${magic.toString('hex')})`];
}

// ── Admin alert ───────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, number> = {
  BANNED: Colors.Red,
  FAILED: Colors.Red,
  COMPROMISED: Colors.Yellow,
  DELETED: Colors.Orange,
  ALERT: Colors.Yellow,
};

export async function alertAdmins(
  guild: Guild,
  member: GuildMember | { id: string; displayName: string; avatarURL?: () => string | null },
  reason: string,
  details: string[],
  action: string,
  cfg: ResolvedModConfig,
): Promise<void> {
  if (!cfg.alertChannelIds.size) return;

  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[action] ?? Colors.Orange)
    .setTitle(`🚨 Security ${action}`)
    .setDescription(`**User:** <@${member.id}> (\`${member.id}\`)\n**Server:** ${guild.name}\n**Reason:** ${reason}`)
    .setFooter({ text: String(member.id) });

  if (details.length) embed.addFields({ name: 'Details', value: details.slice(0, 10).map(d => `• ${d}`).join('\n') });

  const avatar = typeof member.avatarURL === 'function' ? member.avatarURL() : null;
  if (avatar) embed.setThumbnail(avatar);

  for (const channelId of cfg.alertChannelIds) {
    const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (channel) await channel.send({ embeds: [embed] }).catch(() => null);
  }
}

// ── Instant ban ───────────────────────────────────────────────────────────────

export async function instantBan(message: Message, reason: string, cfg: ResolvedModConfig, details: string[] = []): Promise<void> {
  console.error(`🚨 BAN: ${message.author.tag} (${message.author.id}) — ${reason}`);
  if (!message.guild) return;
  try {
    await message.delete().catch(() => null);
    await message.guild.members.ban(message.author.id, {
      reason: `Auto-ban: ${reason} | ${details.slice(0, 3).join(', ')}`,
      deleteMessageSeconds: 300,
    });
    await alertAdmins(message.guild, message.member ?? message.author as any, reason, details, 'BANNED', cfg);
  } catch (e) {
    console.error('Ban failed:', e);
    if (message.guild) await alertAdmins(message.guild, message.member ?? message.author as any, reason, details, 'FAILED', cfg);
  }
}

// ── Algo speak detection ──────────────────────────────────────────────────────
// Targets the specific obfuscation patterns used by illegal content bots:
// zero-width characters, zalgo stacking, and homoglyph script mixing.
// NOT intended as a general Unicode filter — legitimate multilingual text scores 0.

const ZERO_WIDTH = /[​‌‍﻿⁠­]/g;
const COMBINING  = /[̀-ͯ᷀-᷿⃐-⃿︠-︯]/g;
// Cyrillic/Greek lookalikes for Latin letters (homoglyphs commonly used to evade filters)
const HOMOGLYPH_CYRILLIC = /[аеіорсухц]/g;

export function algoSpeakScore(text: string): number {
  if (!text || text.length < 5) return 0;
  let score = 0;

  // Zero-width / invisible characters — almost never legitimate in Discord chat
  const zwMatches = text.match(ZERO_WIDTH) ?? [];
  if (zwMatches.length >= 1) score += 40;
  if (zwMatches.length >= 3) score += 30; // cumulative — heavily stacked = near-certain evasion

  // Zalgo / combining diacritic stacking
  const combMatches = text.match(COMBINING) ?? [];
  const combRatio = combMatches.length / text.length;
  if (combRatio > 0.1) score += 30;
  if (combRatio > 0.3) score += 30;

  // Cyrillic homoglyphs mixed into otherwise Latin text
  const cyrMatches = text.match(HOMOGLYPH_CYRILLIC) ?? [];
  const latinCount = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (cyrMatches.length > 0 && latinCount > 0) {
    const mixRatio = cyrMatches.length / (cyrMatches.length + latinCount);
    // Low ratio = deliberate substitution of a few chars (classic homoglyph attack)
    if (mixRatio > 0 && mixRatio < 0.3) score += 35;
  }

  return score;
}

// ── Embed URL magic bytes check ───────────────────────────────────────────────

export async function checkEmbedImages(message: Message): Promise<string | null> {
  for (const embed of message.embeds) {
    const url = embed.image?.url ?? embed.thumbnail?.url;
    if (!url) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const [safe, reason] = verifyImageSafety(buf, url.split('/').pop() ?? 'embed');
      if (!safe) return reason;
    } catch { /* network error — skip */ }
  }
  return null;
}

// ── Bypass checks ─────────────────────────────────────────────────────────────

// Honeypot/catcher role: fires on mere presence (even if the member also holds a
// verified role), unlike the score nudge in calculateScamScore which only counts
// it when it is the only role.
export function hasHoneypotRole(message: Message, cfg: ResolvedModConfig): boolean {
  if (!cfg.catcherRoleId) return false;
  return message.member?.roles?.cache?.has(cfg.catcherRoleId) ?? false;
}

export function isTrusted(message: Message, cfg: ResolvedModConfig): boolean {
  if (cfg.trustedUserIds.has(message.author.id)) return true;
  if (message.guild && message.author.id === message.guild.ownerId) return true;
  const roles = message.member?.roles?.cache;
  if (roles && cfg.trustedRoleIds.size) {
    for (const roleId of cfg.trustedRoleIds) if (roles.has(roleId)) return true;
  }
  return false;
}
